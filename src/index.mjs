/**
 * dsh-ration — 配给：自己给自己防沉迷的 token 限额（刻度对标 Kimi）。
 *
 * 两把闸（默认刻度 = Kimi 的比例链 5h : 周 = 1 : 5）：
 *  - 5 小时滚动窗：过去 5 小时烧掉的 token ≤ cap5h（4000 万），随时间回血；
 *  - 周：本周（周一 00:00 起）≤ capWeek（2 亿）。
 *
 * 越线不做：任一所开启的闸越线 → 客户端挂件变红，并在捕获层拦下新的发送
 * （正在跑的回合不动；"/" 开头的命令照常放行，方便就地 /ration off 自救）。
 *
 * 数据来源（零 token、不打扰模型）：
 *  - 启动回填：sessionPersistence.list() → open(sid,'read') 读全部会话日志，
 *    提取每条 assistant/message 的 data.usage；
 *  - 实时增量：ctx.on('session/event') 观察每条已提交事件。
 * 账本（按时间排序的逐 step 记录）持久化在 storages/dsh-ration/state.json，
 * 同 (sid,seq) 幂等（重放/重启不重复计）。
 *
 * @module dsh-ration
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'

export const name = 'dsh-ration'
// webServer 不放进顶层 inject：headless 等没有 web 服务的几何下，
// 强依赖会让插件卡 pending（dsh-bite/dsh-johnny 同款教训）。路由就绪后再挂。
export const inject = ['commands']
export const ROUTE_PREFIX = '/dsh-ration'

const STATE_VERSION = 1
const HOUR = 3600_000
const DAY = 24 * HOUR
export const WIN_5H = 5 * HOUR

export const Config = Schema.object({
  cap5h: Schema.number().default(40_000_000).description('5 小时滚动窗额度（token）——对标 Kimi 周额度的 1/5'),
  capWeek: Schema.number().default(200_000_000).description('每周额度（token）——周一 00:00 重置'),
  enforce: Schema.boolean().default(true).description('越线不做：越线后拦下新指令（进行中的回合不受影响）'),
  gate5h: Schema.boolean().default(true).description('启用 5 小时滚动闸'),
  gateWeek: Schema.boolean().default(true).description('启用周闸'),
  warnPct: Schema.number().default(0.8).description('预警阈值（0-1，仅用于配色/提示）'),
  keepDays: Schema.number().default(35).description('账本保留天数（默认 35 天）'),
  storageDir: Schema.string().default('').description('状态存储目录（默认 $DSH_HOME/storages/dsh-ration）'),
})

export const USAGE = [
  '/ration —— 配给：这台的 5 小时 / 周 token 限额',
  '/ration on | off              越线不做 开 / 关',
  '/ration set 5h|week N         改额度（支持 k / m / b / 万 / 亿：例 /ration set week 1.5亿）',
  '/ration unset 5h|week         撤回运行时改值，回到 profile 配置',
  '/ration gate 5h|week on|off   单独开关某把闸',
].join('\n')

// ---------------------------------------------------------------------------
// 纯函数（导出给仿真测试）
// ---------------------------------------------------------------------------

/** 一条 usage 的总 token（优先取 totalTokens，缺失时自行相加）。 */
export function totalOfUsage(u) {
  if (u === undefined || u === null) return 0
  if (typeof u.totalTokens === 'number') return u.totalTokens
  return (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0)
}

/** 从一条会话事件提取用量账目；不是 assistant/message 或没有 usage 时返回 null。 */
export function extractUsage(sessionId, event) {
  if (event?.type !== 'assistant/message') return null
  const u = event?.data?.usage ?? event?.data?.message?.usage
  const total = totalOfUsage(u)
  if (!(total > 0)) return null
  return {
    t: typeof event.time === 'number' ? event.time : Date.now(),
    sid: String(sessionId ?? '?'),
    seq: typeof event.seq === 'number' ? event.seq : -1,
    total,
    in: u.inputTokens ?? 0,
    out: u.outputTokens ?? 0,
    cr: u.cacheReadTokens ?? 0,
    cw: u.cacheWriteTokens ?? 0,
  }
}

/** 区间求和（records 需按 t 升序；since 闭、until 闭）。 */
export function sumRange(records, since, until = Number.POSITIVE_INFINITY) {
  let total = 0, inTok = 0, outTok = 0, cr = 0, cw = 0, steps = 0
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]
    if (r.t < since) break
    if (r.t > until) continue
    total += r.total; inTok += r.in; outTok += r.out; cr += r.cr; cw += r.cw; steps++
  }
  return { total, in: inTok, out: outTok, cr, cw, steps }
}

/** 5 小时滚动窗用量（(now-win, now]）。 */
export function rollingSum(records, now, win = WIN_5H) {
  return sumRange(records, now - win + 1, now).total
}

/**
 * 5 小时窗回血时刻：窗内用量降到 ≤cap 的那一瞬（按逐条老化估算）。
 * 已 ≤cap 返回 now；否则返回足够多的老记录滚出窗口的时刻。
 */
export function dripAt(records, now, cap, win = WIN_5H) {
  const inWin = records.filter((r) => r.t > now - win && r.t <= now)
  let cum = 0
  for (const r of inWin) cum += r.total
  if (cum <= cap) return now
  for (const r of inWin) {
    cum -= r.total
    if (cum <= cap) return r.t + win
  }
  return (inWin[inWin.length - 1]?.t ?? now) + win
}

/** 本周起点（本地时区周一 00:00）。 */
export function weekStart(now) {
  const d = new Date(now)
  const dow = (d.getDay() + 6) % 7
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow, 0, 0, 0, 0).getTime()
}
export function nextWeekStart(now) {
  return weekStart(weekStart(now) + 8 * DAY)
}

/** 两闸状态：used / pct / over / freeAt（5h=回血时刻；周=重置时刻）。 */
export function buildGates(records, cfg, now) {
  const h5used = rollingSum(records, now)
  const h5 = {
    key: 'h5', label: '5 小时窗',
    on: cfg.gate5h === true, cap: cfg.cap5h, used: h5used,
    pct: cfg.cap5h > 0 ? h5used / cfg.cap5h : 0,
    over: cfg.gate5h === true && h5used >= cfg.cap5h,
    freeAt: dripAt(records, now, cfg.cap5h),
  }
  const ws = weekStart(now)
  const week = {
    key: 'week', label: '本周',
    on: cfg.gateWeek === true, cap: cfg.capWeek, used: sumRange(records, ws).total,
    pct: 0, over: false, resetAt: nextWeekStart(now),
  }
  week.pct = cfg.capWeek > 0 ? week.used / cfg.capWeek : 0
  week.over = cfg.gateWeek === true && week.used >= cfg.capWeek
  week.freeAt = week.resetAt
  return { h5, week }
}

/** 格式化 token 数为中文习惯（亿 / 万）。 */
export function formatTokens(n) {
  if (!Number.isFinite(n)) return '?'
  if (n >= 1e8) return trimZeros((n / 1e8).toFixed(2)) + '亿'
  if (n >= 1e4) return trimZeros((n / 1e4).toFixed(1)) + '万'
  return String(Math.round(n))
}
function trimZeros(s) {
  return s.includes('.') ? s.replace(/\.?0+$/u, '') : s
}

/** 解析额度字符串：纯数字或带 k/m/b/万/亿 后缀。非法返回 null。 */
export function parseCap(raw) {
  const m = String(raw ?? '').trim().toLowerCase().match(/^([0-9]+(?:\.[0-9]+)?)\s*(k|m|b|万|亿)?$/u)
  if (m === null) return null
  const v = Number(m[1])
  if (!Number.isFinite(v) || v <= 0) return null
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : m[2] === '万' ? 1e4 : m[2] === '亿' ? 1e8 : 1
  const out = Math.round(v * mult)
  return out > 0 ? out : null
}

export function fmtDateTime(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtEta(ms) {
  if (!(ms > 0)) return '马上'
  const min = Math.ceil(ms / 60000)
  if (min < 60) return `${min} 分钟`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest === 0 ? `${h} 小时` : `${h} 小时 ${rest} 分`
}

// ---------------------------------------------------------------------------
// 主体
// ---------------------------------------------------------------------------

export function createRation({ ctx, config, deps = {} }) {
  const fsImpl = deps.fs ?? fs
  const env = deps.env ?? process.env
  const homeDir = deps.homeDir ?? os.homedir()
  const nowFn = deps.now ?? (() => Date.now())

  const storageDir = config.storageDir !== '' && config.storageDir !== undefined
    ? config.storageDir
    : path.join(env.DSH_HOME ?? path.join(homeDir, '.dsh'), 'storages', 'dsh-ration')
  const stateFile = path.join(storageDir, 'state.json')

  /** 懒注入的服务：sessionPersistence（回填读日志用）。 */
  let svc = {}

  const state = {
    runtime: {},   // /ration 的运行时改值（覆盖 profile 配置）
    meta: {},      // sid -> { bytes, count } 便宜的变化探测
    maxSeq: {},    // sid -> 已摄入的最大 seq
    records: [],   // 升序账本
  }
  const byKey = new Map() // `${sid}:${seq}` -> 记录（幂等去重）
  let saveTimer = null
  let dirty = false

  function pick(runtimeVal, baseVal) {
    return runtimeVal === undefined ? baseVal : runtimeVal
  }

  function effectiveConfig() {
    const r = state.runtime
    return {
      cap5h: pick(r.cap5h, config.cap5h),
      capWeek: pick(r.capWeek, config.capWeek),
      enforce: pick(r.enforce, config.enforce),
      gate5h: pick(r.gate5h, config.gate5h),
      gateWeek: pick(r.gateWeek, config.gateWeek),
      warnPct: config.warnPct,
      keepDays: config.keepDays,
    }
  }

  // —— 账本持久化 ——

  function loadState() {
    try {
      const parsed = JSON.parse(fsImpl.readFileSync(stateFile, 'utf8'))
      if (parsed?.version === STATE_VERSION) {
        if (parsed.runtime && typeof parsed.runtime === 'object') state.runtime = parsed.runtime
        if (parsed.meta && typeof parsed.meta === 'object') state.meta = parsed.meta
        if (parsed.maxSeq && typeof parsed.maxSeq === 'object') state.maxSeq = parsed.maxSeq
        if (Array.isArray(parsed.records)) state.records = parsed.records
      }
    } catch {
      /* 首次运行或状态损坏：空账本起步 */
    }
    for (const r of state.records) {
      if (typeof r?.t === 'number' && typeof r?.sid === 'string' && typeof r?.seq === 'number') {
        if (r.seq >= 0) byKey.set(`${r.sid}:${r.seq}`, r)
      }
    }
    state.records.sort((a, b) => a.t - b.t)
    prune(false)
  }

  function saveNow() {
    try {
      fsImpl.mkdirSync(storageDir, { recursive: true })
      fsImpl.writeFileSync(stateFile, JSON.stringify({
        version: STATE_VERSION,
        runtime: state.runtime,
        meta: state.meta,
        maxSeq: state.maxSeq,
        records: state.records,
      }))
      dirty = false
    } catch (error) {
      ctx.logger.warn(`[dsh-ration] 账本落盘失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function scheduleSave() {
    dirty = true
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      if (dirty) saveNow()
    }, 4000)
  }

  function prune(markDirty = true) {
    const keepDays = config.keepDays ?? 35
    const cutoff = nowFn() - keepDays * DAY
    let i = 0
    while (i < state.records.length && state.records[i].t < cutoff) i++
    if (i === 0) return 0
    for (const r of state.records.slice(0, i)) byKey.delete(`${r.sid}:${r.seq}`)
    state.records = state.records.slice(i)
    if (markDirty) dirty = true
    return i
  }

  // —— 摄入 ——

  /** 幂等写入一条记录；返回是否新增/更新。 */
  function ingestRecord(rec) {
    const key = `${rec.sid}:${rec.seq}`
    if (rec.seq >= 0) {
      const prev = byKey.get(key)
      if (prev !== undefined) {
        if (prev.total !== rec.total || prev.t !== rec.t || prev.in !== rec.in || prev.out !== rec.out || prev.cr !== rec.cr || prev.cw !== rec.cw) {
          const retime = prev.t !== rec.t
          prev.total = rec.total; prev.t = rec.t
          prev.in = rec.in; prev.out = rec.out; prev.cr = rec.cr; prev.cw = rec.cw
          if (retime) state.records.sort((a, b) => a.t - b.t)
          dirty = true
          return true
        }
        return false
      }
    }
    state.records.push(rec)
    if (rec.seq >= 0) byKey.set(key, rec)
    const n = state.records.length
    if (n >= 2 && state.records[n - 2].t > rec.t) state.records.sort((a, b) => a.t - b.t)
    dirty = true
    return true
  }

  /** 实时观察（session/event 已提交事件流）。 */
  function observeSessionEvent(session, event) {
    try {
      const sid = session?.id
      if (typeof sid !== 'string' || sid === '') return
      const rec = extractUsage(sid, event)
      if (rec === null) return
      ingestRecord(rec)
      if (rec.seq > (state.maxSeq[sid] ?? -1)) state.maxSeq[sid] = rec.seq
      scheduleSave()
    } catch {
      /* 观察失败不影响主流程 */
    }
  }

  /** 启动回填：把历史会话日志里的用量一次吃进来（幂等，可反复跑）。 */
  async function backfill() {
    const persistence = svc.sessionPersistence
    if (persistence === undefined || typeof persistence.list !== 'function') {
      ctx.logger.warn('[dsh-ration] sessionPersistence 不可用，跳过回填（只统计之后的实时用量）')
      return { ok: false, code: 'no-persistence' }
    }
    let snaps = []
    try {
      snaps = await persistence.list()
    } catch (error) {
      ctx.logger.warn(`[dsh-ration] 会话列表读取失败: ${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, code: 'list-failed' }
    }
    let scanned = 0, skipped = 0, added = 0
    for (const snap of snaps) {
      const sid = snap?.header?.id ?? snap?.header?.sessionId ?? snap?.id
      if (typeof sid !== 'string' || sid === '') continue
      const bytes = typeof snap.sizeBytes === 'number' ? snap.sizeBytes : undefined
      const count = typeof snap.eventCount === 'number' ? snap.eventCount : undefined
      const meta = state.meta[sid]
      if (meta !== undefined && bytes !== undefined && count !== undefined && meta.bytes === bytes && meta.count === count) {
        skipped++
        continue
      }
      try {
        const handle = await persistence.open(sid, 'read')
        let events = []
        try {
          const read = await handle.read()
          if (Array.isArray(read?.events)) events = read.events
        } finally {
          await handle.close()
        }
        const maxSeq = state.maxSeq[sid] ?? -1
        for (const ev of events) {
          const seq = typeof ev?.seq === 'number' ? ev.seq : -1
          if (seq >= 0 && seq <= maxSeq && !byKey.has(`${sid}:${seq}`)) continue
          const rec = extractUsage(sid, ev)
          if (rec !== null && ingestRecord(rec)) added++
          if (seq > (state.maxSeq[sid] ?? -1)) state.maxSeq[sid] = seq
        }
        state.meta[sid] = { bytes, count }
        scanned++
      } catch (error) {
        ctx.logger.warn(`[dsh-ration] 回填会话失败(${sid}): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    state.records.sort((a, b) => a.t - b.t)
    scheduleSave()
    const banner = `[dsh-ration] 回填完成：扫描 ${scanned} 会话（跳过 ${skipped}），账本 ${state.records.length} 条`
    ctx.logger.info(banner)
    return { ok: true, scanned, skipped, added, total: state.records.length }
  }

  // —— 状态与展示 ——

  function blockedInfo(cfg, gates, now) {
    const over = [gates.h5, gates.week].filter((g) => g.on && g.over)
    if (cfg.enforce !== true || over.length === 0) return { on: false, gates: [], freeAt: null, text: '' }
    const parts = over.map((g) => {
      if (g.key === 'h5') return `5 小时窗满了（约 ${fmtEta(g.freeAt - now)}后回血）`
      return `本周额度用完了（${fmtDateTime(g.freeAt)} 解禁）`
    })
    return {
      on: true,
      gates: over.map((g) => g.key),
      freeAt: Math.max(...over.map((g) => g.freeAt)),
      text: `〔配给〕${parts.join('；')}。越线不做。`,
    }
  }

  function dayStartOf(ts) {
    const d = new Date(ts)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  function detailOf(now) {
    const records = state.records
    const today = sumRange(records, dayStartOf(now))
    const week = sumRange(records, weekStart(now))
    const last7 = []
    for (let i = 6; i >= 0; i--) {
      const d0 = dayStartOf(now - i * DAY)
      const d1 = d0 + DAY - 1
      const d = new Date(d0)
      last7.push({ label: `${d.getMonth() + 1}-${d.getDate()}`, total: sumRange(records, d0, d1).total })
    }
    return {
      today, week, last7,
      cacheShare: week.total > 0 ? week.cr / week.total : 0,
      steps: records.length,
      firstAt: records[0]?.t ?? null,
    }
  }

  function status() {
    const cfg = effectiveConfig()
    const now = nowFn()
    const gates = buildGates(state.records, cfg, now)
    return {
      ok: true,
      now,
      enforce: cfg.enforce === true,
      warnPct: cfg.warnPct,
      caps: { h5: cfg.cap5h, week: cfg.capWeek },
      gates,
      blocked: blockedInfo(cfg, gates, now),
      detail: detailOf(now),
    }
  }

  function statusText() {
    const s = status()
    const lines = [
      `〔配给〕越线不做：${s.enforce ? '开' : '关'}　账本 ${s.detail.steps} 步`,
      gateLine(s.gates.h5, `· 回血 ${fmtDateTime(s.gates.h5.freeAt)}`),
      gateLine(s.gates.week, `· ${fmtDateTime(s.gates.week.resetAt)} 重置`),
    ]
    if (s.blocked.on) lines.push(`⚠ 越线中：${s.blocked.text}`)
    lines.push('改额度：/ration set week 1.5亿；关越线：/ration off')
    return lines.join('\n')
  }

  function gateLine(g, tail) {
    const stateTag = g.on ? (g.over ? '【越线】' : '') : '（关）'
    const pct = Math.round(g.pct * 100)
    return `${stateTag}${g.label}  ${formatTokens(g.used)} / ${formatTokens(g.cap)}（${pct}%）${tail}`
  }

  // —— 命令 ——

  function setRuntime(key, value) {
    state.runtime[key] = value
    dirty = true
    saveNow()
  }
  function unsetRuntime(key) {
    delete state.runtime[key]
    dirty = true
    saveNow()
  }

  const GATE_ALIAS = {
    '5h': { key: 'h5', capKey: 'cap5h', gateKey: 'gate5h', label: '5 小时窗' },
    '5': { key: 'h5', capKey: 'cap5h', gateKey: 'gate5h', label: '5 小时窗' },
    week: { key: 'week', capKey: 'capWeek', gateKey: 'gateWeek', label: '本周' },
    w: { key: 'week', capKey: 'capWeek', gateKey: 'gateWeek', label: '本周' },
  }

  async function cmdRation(invocation) {
    const raw = String(invocation?.rawInput ?? '').trim()
    if (raw === '' || raw === 'status' || raw === '状态') {
      return { kind: 'success', text: statusText() }
    }
    const parts = raw.split(/\s+/u)
    const op = parts[0].toLowerCase()
    if (op === 'on' || op === 'off') {
      setRuntime('enforce', op === 'on')
      return { kind: 'success', text: `配给：越线不做已${op === 'on' ? '开启（越线拦新指令）' : '关闭（只记账不拦）'}。` }
    }
    if (op === 'set' || op === 'unset') {
      const gate = GATE_ALIAS[String(parts[1] ?? '').toLowerCase()]
      if (gate === undefined) return { kind: 'error', text: USAGE }
      if (op === 'unset') {
        unsetRuntime(gate.capKey)
        return { kind: 'success', text: `配给：${gate.label} 额度已回到 profile 配置（${formatTokens(effectiveConfig()[gate.capKey])}）。` }
      }
      const value = parseCap(parts[2])
      if (value === null) return { kind: 'error', text: USAGE }
      setRuntime(gate.capKey, value)
      return { kind: 'success', text: `配给：${gate.label} 额度已设为 ${formatTokens(value)}。` }
    }
    if (op === 'gate') {
      const gate = GATE_ALIAS[String(parts[1] ?? '').toLowerCase()]
      const arg = String(parts[2] ?? '').toLowerCase()
      if (gate === undefined || (arg !== 'on' && arg !== 'off')) return { kind: 'error', text: USAGE }
      setRuntime(gate.gateKey, arg === 'on')
      return { kind: 'success', text: `配给：${gate.label} 闸已${arg === 'on' ? '开启' : '关闭'}。` }
    }
    return { kind: 'error', text: USAGE }
  }

  // —— 跨插件接口（v0.1.2：dsh-plan 等消费方用） ——

  /** 直接设置额度（运行时改值，落盘）；返回 { ok, caps } 或 { ok:false, code }。 */
  function setCaps(input) {
    const patch = {}
    if (typeof input?.cap5h === 'number' && Number.isFinite(input.cap5h) && input.cap5h > 0) patch.cap5h = Math.round(input.cap5h)
    if (typeof input?.capWeek === 'number' && Number.isFinite(input.capWeek) && input.capWeek > 0) patch.capWeek = Math.round(input.capWeek)
    if (Object.keys(patch).length === 0) return { ok: false, code: 'bad-input' }
    Object.assign(state.runtime, patch)
    dirty = true
    saveNow()
    const cfg = effectiveConfig()
    return { ok: true, caps: { h5: cfg.cap5h, week: cfg.capWeek } }
  }

  /** 读当前额度（跨插件查询用）。 */
  function getCaps() {
    const cfg = effectiveConfig()
    return { h5: cfg.cap5h, week: cfg.capWeek, enforce: cfg.enforce === true }
  }

  function serviceApi() {
    return {
      version: '0.1.2',
      setCaps,
      getCaps,
      status: () => status(),
    }
  }

  // —— 路由 ——

  function sendJson(res, code, payload) {
    const body = JSON.stringify(payload)
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', (chunk) => {
        data += chunk
        if (data.length > 1 << 20) reject(new Error('body too large'))
      })
      req.on('end', () => resolve(data))
      req.on('error', reject)
    })
  }

  async function routeHandler(req, res) {
    try {
      const url = new URL(req.url ?? ROUTE_PREFIX, 'http://localhost')
      const route = url.pathname
      if (route === `${ROUTE_PREFIX}/state` && (req.method ?? 'GET') === 'GET') {
        return sendJson(res, 200, status())
      }
      if (route === `${ROUTE_PREFIX}/set` && req.method === 'POST') {
        let body
        try {
          body = JSON.parse((await readBody(req)) || '{}')
        } catch {
          return sendJson(res, 400, { ok: false, code: 'bad-json' })
        }
        const result = setCaps(body)
        return sendJson(res, result.ok ? 200 : 400, result)
      }
      if (route === `${ROUTE_PREFIX}/health`) {
        return sendJson(res, 200, { ok: true, name: 'dsh-ration', records: state.records.length, storage: storageDir })
      }
      return sendJson(res, 404, { ok: false, code: 'not-found' })
    } catch (error) {
      ctx.logger.warn(`[dsh-ration] 路由失败: ${error instanceof Error ? error.message : String(error)}`)
      return sendJson(res, 500, { ok: false, code: 'internal' })
    }
  }

  // —— 装配 ——

  function start(options = {}) {
    loadState()

    // 实时用量观察
    ctx.on('session/event', observeSessionEvent)

    // HTTP 路由（客户端挂件轮询）——webServer 可选
    try {
      ctx.inject(['webServer'], (scoped) => {
        scoped.effect(() => {
          const dispose = scoped.webServer.register({
            kind: 'prefix',
            path: ROUTE_PREFIX,
            handler: routeHandler,
          })
          return dispose
        }, 'dsh-ration: routes')
      })
    } catch (error) {
      ctx.logger.warn(`[dsh-ration] 路由注册失败（无 web 服务时忽略）: ${error instanceof Error ? error.message : String(error)}`)
    }

    // 斜杠命令
    ctx.effect(function* () {
      yield ctx.commands.register({
        definitionId: CommandDefinitionId('dsh-ration/ration'),
        name: 'ration',
        description: '配给：查看/调整自己的 5 小时·周·月 token 限额（越线不做）',
        handler: cmdRation,
      })
    }, 'dsh-ration: commands')

    // 跨插件服务（v0.1.2：dsh-plan 等经 ctx.inject(['ration']) 消费）
    try {
      ctx.provide('ration', serviceApi())
    } catch (error) {
      ctx.logger.warn(`[dsh-ration] 服务提供失败: ${error instanceof Error ? error.message : String(error)}`)
    }

    // 回填（等服务就绪；懒注入，headless 几何下自动跳过）
    try {
      ctx.inject(['sessionPersistence'], (scoped) => {
        svc = { sessionPersistence: scoped.sessionPersistence }
        if (options.autoBackfill !== false) void backfill()
      })
    } catch (error) {
      ctx.logger.warn(`[dsh-ration] 服务注入失败: ${error instanceof Error ? error.message : String(error)}`)
    }

    // 周期家务：剪枝 + 落盘
    ctx.effect(() => {
      const timer = setInterval(() => {
        prune()
        if (dirty) saveNow()
      }, 60_000)
      return () => {
        clearInterval(timer)
        if (saveTimer !== null) {
          clearTimeout(saveTimer)
          saveTimer = null
        }
        if (dirty) saveNow()
      }
    }, 'dsh-ration: housekeeping')

    ctx.effect(() => {
      const cfg = effectiveConfig()
      const banner = `[dsh-ration] 已加载（5h ${formatTokens(cfg.cap5h)} / 周 ${formatTokens(cfg.capWeek)}，越线不做=${cfg.enforce ? '开' : '关'}，storage=${storageDir}）`
      ctx.logger.info(banner)
      console.log(banner)
      return () => ctx.logger.info('[dsh-ration] 已卸载')
    })
  }

  return {
    start,
    // 测试与调试入口
    _state: state,
    _byKey: byKey,
    _ingestRecord: ingestRecord,
    _observe: observeSessionEvent,
    _backfill: backfill,
    _status: status,
    _statusText: statusText,
    _blockedInfo: blockedInfo,
    _cmdRation: cmdRation,
    _route: routeHandler,
    _loadState: loadState,
    _saveNow: saveNow,
    _prune: prune,
    _effectiveConfig: effectiveConfig,
    _storageDir: storageDir,
    _stateFile: stateFile,
  }
}

export function apply(ctx, config) {
  const rt = createRation({ ctx, config })
  rt.start()
  return rt
}
