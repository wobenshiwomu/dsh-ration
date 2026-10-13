/**
 * dsh-ration 仿真测试台
 *
 * ①纯函数：usage 提取 / 窗口求和 / 回血时刻 / 周起点 / 两闸状态 / 额度解析 / 格式化
 * ②装配与账本：回填（幂等、meta 跳扫、增量）、实时观察、去重、剪枝、落盘/跨实例恢复
 * ③越线状态机：over 判定、enforce 开关、分闸开关、blocked 文案
 * ④命令：status / set / unset / gate / on / off
 * ⑤HTTP 路由：/state /health /404
 * ⑥真数据回填断言：读一份真实会话日志（zstdcat），账本条数与 token 总量必须吻合
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createRation,
  extractUsage,
  totalOfUsage,
  sumRange,
  rollingSum,
  dripAt,
  weekStart,
  nextWeekStart,
  buildGates,
  formatTokens,
  parseCap,
  fmtEta,
  ROUTE_PREFIX,
  WIN_5H,
} from '../src/index.mjs'

let passed = 0
const log = (...a) => console.log(...a)
function group(name) {
  log(`\n═══ ${name}`)
}
function ok(msg) {
  passed++
  log(`  ✓ ${msg}`)
}
function eq(msg, a, b) {
  assert.equal(a, b, msg)
  ok(msg)
}
function okIf(msg, cond) {
  assert.ok(cond, msg)
  ok(msg)
}

const HOUR = 3600_000
const DAY = 24 * HOUR

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeRes() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(s, h) {
      this.status = s
      this.headers = h
      return this
    },
    end(chunk) {
      if (chunk !== undefined) this.body += String(chunk)
    },
  }
}

function usageEvent(seq, time, u) {
  return { type: 'assistant/message', seq, time, data: { usage: u } }
}

/** 假 req（支持 POST body）。 */
function makeReq({ method = 'GET', url = `${ROUTE_PREFIX}/health`, body = '' } = {}) {
  const req = { method, url, _l: {} }
  req.on = (ev, cb) => {
    req._l[ev] = cb
    return req
  }
  setImmediate(() => {
    if (body !== '' && req._l.data) req._l.data(Buffer.from(body, 'utf8'))
    if (req._l.end) req._l.end()
  })
  return req
}

/** 假 ctx + 假 sessionPersistence。 */
function makeEnv({ storageDir = null, store = null, config = {} } = {}) {
  const dir = storageDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ration-sim-'))
  const listeners = { 'session/event': [] }
  const commands = []
  const routes = []
  const logs = []
  const opened = []
  const provided = {}
  const persistence = store ?? {
    list: async () => [],
    open: async (id) => ({
      read: async () => ({ events: [] }),
      close: async () => {},
    }),
  }
  persistence.__opened = opened
  const ctx = {
    logger: {
      info: (m) => logs.push(['info', m]),
      warn: (m) => logs.push(['warn', m]),
    },
    provide: (name, value) => {
      provided[name] = value
      return () => {}
    },
    on: (ev, fn) => {
      ;(listeners[ev] ??= []).push(fn)
      return () => {}
    },
    inject: (deps, cb) => {
      if (deps.includes('sessionPersistence')) {
        cb({ sessionPersistence: persistence, effect: (fn, _label) => { const d = fn(); return d } })
      } else if (deps.includes('webServer')) {
        cb({
          effect: (fn, _label) => fn(),
          webServer: {
            register: (route) => {
              routes.push(route)
              return () => {}
            },
          },
        })
      }
    },
    commands: {
      register: (def) => {
        commands.push(def)
        return () => {}
      },
    },
    effect: (fn) => {
      if (typeof fn === 'function' && fn.constructor && fn.constructor.name === 'GeneratorFunction') {
        const it = fn()
        for (let r = it.next(); !r.done; r = it.next()) {
          /* 拿到的 disposer 不存也行 */
        }
        return () => {}
      }
      const dispose = typeof fn === 'function' ? fn() : undefined
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }
  const cfg = {
    cap5h: 40_000_000, capWeek: 200_000_000,
    enforce: true, gate5h: true, gateWeek: true,
    warnPct: 0.8, keepDays: 35, storageDir: dir,
    ...config,
  }
  return { ctx, cfg, dir, listeners, commands, routes, logs, persistence, opened, provided }
}

function emit(env, sid, event) {
  for (const fn of env.listeners['session/event']) fn({ id: sid }, event)
}

// ---------------------------------------------------------------------------
// ① 纯函数
// ---------------------------------------------------------------------------

group('① 纯函数')
{
  eq('totalOfUsage 优先 totalTokens', totalOfUsage({ totalTokens: 5, inputTokens: 1, outputTokens: 1 }), 5)
  eq('totalOfUsage 回退四项相加', totalOfUsage({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 1 }), 16)
  eq('totalOfUsage null → 0', totalOfUsage(null), 0)

  const rec = extractUsage('s1', usageEvent(7, 1000, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0, totalTokens: 115 }))
  eq('extractUsage 提取 seq', rec.seq, 7)
  eq('extractUsage 提取 total', rec.total, 115)
  eq('extractUsage 非 assistant → null', extractUsage('s1', { type: 'user/message', seq: 1, data: {} }), null)
  eq('extractUsage 无 usage → null', extractUsage('s1', { type: 'assistant/message', seq: 1, time: 1, data: { message: {} } }), null)
  eq('extractUsage 零用量 → null', extractUsage('s1', usageEvent(2, 1, { totalTokens: 0 })), null)

  const now = new Date(2026, 9, 12, 15, 0, 0).getTime() // 2026-10-12（周一）15:00
  eq('weekStart = 周一 00:00', weekStart(now), new Date(2026, 9, 12, 0, 0, 0, 0).getTime())
  eq('nextWeekStart = 下周一', nextWeekStart(now), new Date(2026, 9, 19, 0, 0, 0, 0).getTime())

  const records = [
    { t: now - 6 * HOUR, sid: 'a', seq: 1, total: 100, in: 1, out: 1, cr: 98, cw: 0 }, // 滚出 5h 窗
    { t: now - 3 * HOUR, sid: 'a', seq: 2, total: 200, in: 2, out: 2, cr: 196, cw: 0 },
    { t: now - 1 * HOUR, sid: 'b', seq: 3, total: 300, in: 3, out: 3, cr: 294, cw: 0 },
  ]
  eq('rollingSum 只算 5h 窗内', rollingSum(records, now), 500)
  eq('sumRange 自定义区间', sumRange(records, now - 2 * HOUR).total, 300)
  eq('dripAt 未越线 → now', dripAt(records, now, 600), now)
  eq('dripAt 越线 → 最老一条窗内记录滚出的时刻', dripAt(records, now, 450), records[1].t + WIN_5H)
  eq('dripAt 更紧 → 第二条也滚出', dripAt(records, now, 250), records[2].t + WIN_5H)
  eq('dripAt 窗内全是旧账（-6h 那条不计）', dripAt(records, now, 400), records[1].t + WIN_5H)

  const gatesOn = buildGates(records, { cap5h: 400, capWeek: 10000, gate5h: true, gateWeek: true }, now)
  okIf('h5 越线判定', gatesOn.h5.over === true)
  okIf('周未越线', gatesOn.week.over === false)
  const gatesOff = buildGates(records, { cap5h: 400, capWeek: 10000, gate5h: false, gateWeek: true }, now)
  okIf('关闸后不算越线', gatesOff.h5.over === false)

  eq('parseCap 30M', parseCap('30M'), 30_000_000)
  eq('parseCap 1.5亿', parseCap('1.5亿'), 150_000_000)
  eq('parseCap 4000万', parseCap('4000万'), 40_000_000)
  eq('parseCap 2b', parseCap('2b'), 2_000_000_000)
  eq('parseCap 纯数字', parseCap('123456'), 123456)
  eq('parseCap 非法 → null', parseCap('abc'), null)
  eq('parseCap 负数 → null', parseCap('-5'), null)

  eq('formatTokens 4000万', formatTokens(40_000_000), '4000万')
  eq('formatTokens 2亿', formatTokens(200_000_000), '2亿')
  eq('formatTokens 小数字', formatTokens(1234), '1234')
  eq('fmtEta 23 分钟', fmtEta(23 * 60_000), '23 分钟')
  eq('fmtEta 1 小时 12 分', fmtEta((72) * 60_000), '1 小时 12 分')
}

// ---------------------------------------------------------------------------
// ② 账本：回填 / 实时 / 去重 / 落盘
// ---------------------------------------------------------------------------

group('② 账本引擎')
{
  const t0 = Date.now() - 2 * HOUR
  const eventsA = [
    usageEvent(1, t0, { totalTokens: 1000 }),
    usageEvent(3, t0 + 1000, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 5, cacheWriteTokens: 0 }),
    { type: 'user/message', seq: 2, time: t0, data: {} },
  ]
  const eventsB = [usageEvent(5, t0 + 2000, { totalTokens: 7000 })]
  const store = {
    list: async () => [
      { header: { id: 'sess-A' }, sizeBytes: 111, eventCount: 3 },
      { header: { id: 'sess-B' }, sizeBytes: 222, eventCount: 1 },
    ],
    open: async (id) => ({
      read: async () => ({ events: id === 'sess-A' ? eventsA : eventsB }),
      close: async () => {},
    }),
  }
  const env = makeEnv({ store })
  const rt = createRation({ ctx: env.ctx, config: env.cfg })
  rt.start({ autoBackfill: false })

  const r1 = await rt._backfill()
  eq('回填两个会话', r1.scanned, 2)
  eq('回填账本条数（user 事件不计）', rt._state.records.length, 3)
  eq('回填 token 总量', rt._state.records.reduce((s, r) => s + r.total, 0), 8020)

  const r2 = await rt._backfill()
  eq('meta 未变则跳扫', r2.skipped, 2)
  eq('跳扫不重复计', rt._state.records.length, 3)

  store.list = async () => [{ header: { id: 'sess-A' }, sizeBytes: 333, eventCount: 4 }]
  const eventsA2 = [...eventsA, usageEvent(7, t0 + 3000, { totalTokens: 42 })]
  store.open = async () => ({ read: async () => ({ events: eventsA2 }), close: async () => {} })
  const r3 = await rt._backfill()
  eq('meta 变化 → 重扫并只加新 seq', rt._state.records.length, 4)
  eq('增量 42 已入账', rt._state.records.some((r) => r.total === 42), true)
  okIf('返回值 added', r3.added === 1)

  // 实时去重（同 seq 重放）
  emit(env, 'sess-A', usageEvent(7, t0 + 3000, { totalTokens: 42 }))
  eq('同 seq 重放不重复计', rt._state.records.filter((r) => r.total === 42).length, 1)
  emit(env, 'sess-A', usageEvent(9, t0 + 4000, { totalTokens: 555 }))
  eq('新 seq 实时入账', rt._state.records.filter((r) => r.total === 555).length, 1)

  // 落盘 → 跨实例恢复
  rt._saveNow()
  const rtB = createRation({ ctx: env.ctx, config: env.cfg })
  rtB._loadState()
  eq('跨实例恢复条数', rtB._state.records.length, rt._state.records.length)

  // 剪枝
  const old = { t: Date.now() - 40 * DAY, sid: 'sess-old', seq: 1, total: 999, in: 0, out: 0, cr: 0, cw: 0 }
  rtA_push(rt, old)
  const pruned = rt._prune(true)
  okIf('剪枝掉过期记录', pruned >= 1 && !rt._state.records.some((r) => r.total === 999))
}
function rtA_push(rt, rec) {
  rt._state.records.push(rec)
  rt._state.records.sort((a, b) => a.t - b.t)
}

// ---------------------------------------------------------------------------
// ③ 越线状态机
// ---------------------------------------------------------------------------

group('③ 越线状态机')
{
  const env = makeEnv({ config: { cap5h: 1000, capWeek: 100_000 } })
  const rt = createRation({ ctx: env.ctx, config: env.cfg })
  rt.start({ autoBackfill: false })

  emit(env, 's1', usageEvent(1, Date.now(), { totalTokens: 1500 }))
  const s1 = rt._status()
  eq('越线后 blocked.on', s1.blocked.on, true)
  okIf('blocked 文案含「越线不做」', s1.blocked.text.includes('越线不做'))
  okIf('blocked 含 5 小时窗', s1.blocked.text.includes('5 小时窗'))

  await rt._cmdRation({ rawInput: 'off' })
  eq('enforce off 后不拦', rt._status().blocked.on, false)
  await rt._cmdRation({ rawInput: 'gate 5h off' })
  eq('关闸后该闸不越线', rt._status().gates.h5.over, false)
  await rt._cmdRation({ rawInput: 'gate 5h on' })
  await rt._cmdRation({ rawInput: 'on' })
  eq('恢复后仍然越线', rt._status().blocked.on, true)

  // 周闸
  const env2 = makeEnv({ config: { cap5h: 10 ** 9, capWeek: 1000 } })
  const rt2 = createRation({ ctx: env2.ctx, config: env2.cfg })
  rt2.start({ autoBackfill: false })
  emit(env2, 's2', usageEvent(1, Date.now(), { totalTokens: 2000 }))
  const s2 = rt2._status()
  eq('周闸越线', s2.blocked.gates.join(','), 'week')
  okIf('文案含「本周」且含解禁时间', s2.blocked.text.includes('本周') && s2.blocked.text.includes('解禁'))
}

// ---------------------------------------------------------------------------
// ④ 命令
// ---------------------------------------------------------------------------

group('④ 命令')
{
  const env = makeEnv()
  const rt = createRation({ ctx: env.ctx, config: env.cfg })
  rt.start({ autoBackfill: false })
  eq('注册了 /ration 命令', env.commands.length, 1)
  eq('命令名合法', env.commands[0].name, 'ration')

  const st = await rt._cmdRation({ rawInput: '' })
  okIf('status 输出两闸', st.text.includes('5 小时窗') && st.text.includes('本周'))

  const set = await rt._cmdRation({ rawInput: 'set week 1.5亿' })
  okIf('set week 1.5亿 生效', rt._effectiveConfig().capWeek === 150_000_000)
  okIf('回执含 1.5亿', set.text.includes('1.5亿'))

  const bad = await rt._cmdRation({ rawInput: 'set week abc' })
  eq('非法额度 → error', bad.kind, 'error')

  const un = await rt._cmdRation({ rawInput: 'unset week' })
  okIf('unset 回到配置', rt._effectiveConfig().capWeek === 200_000_000)

  const g = await rt._cmdRation({ rawInput: 'gate week off' })
  okIf('gate week off 生效', rt._effectiveConfig().gateWeek === false)

  const on = await rt._cmdRation({ rawInput: 'on' })
  okIf('on 回执', on.text.includes('开启'))

  // 运行时改值要落盘（新实例可见）
  rt._saveNow()
  const rtB = createRation({ ctx: env.ctx, config: env.cfg })
  rtB._loadState()
  eq('运行时改值跨实例保持', rtB._effectiveConfig().capWeek, 200_000_000)
  eq('gate week off 跨实例保持', rtB._effectiveConfig().gateWeek, false)
}

// ---------------------------------------------------------------------------
// ⑤ HTTP 路由
// ---------------------------------------------------------------------------

group('⑤ HTTP 路由')
{
  const env = makeEnv()
  const rt = createRation({ ctx: env.ctx, config: env.cfg })
  rt.start({ autoBackfill: false })
  eq('注册了 1 条前缀路由', env.routes.length, 1)
  eq('路由前缀正确', env.routes[0].path, ROUTE_PREFIX)

  const res1 = makeRes()
  await rt._route({ method: 'GET', url: `${ROUTE_PREFIX}/state` }, res1)
  eq('GET /state 200', res1.status, 200)
  const body = JSON.parse(res1.body)
  okIf('state 含两闸与 blocked/detail', body.ok === true && body.gates.h5.cap === 40_000_000 && typeof body.blocked.on === 'boolean' && Array.isArray(body.detail.last7))
  eq('last7 是 7 天', body.detail.last7.length, 7)

  const res2 = makeRes()
  await rt._route({ method: 'GET', url: `${ROUTE_PREFIX}/health` }, res2)
  eq('GET /health 200', JSON.parse(res2.body).ok, true)

  const res3 = makeRes()
  await rt._route({ method: 'GET', url: `${ROUTE_PREFIX}/nope` }, res3)
  eq('未知路由 404', res3.status, 404)
}

// ---------------------------------------------------------------------------
// ⑤.5 跨插件接口（v0.1.2：service + POST /set）
// ---------------------------------------------------------------------------

group('⑤.5 跨插件接口')
{
  const env = makeEnv()
  const rt = createRation({ ctx: env.ctx, config: env.cfg })
  rt.start({ autoBackfill: false })

  okIf('已提供 ration 服务', typeof env.provided.ration === 'object' && env.provided.ration !== null)
  const svc = env.provided.ration
  eq('服务版本', svc.version, '0.1.2')

  const r1 = svc.setCaps({ cap5h: 12_345_678, capWeek: 98_765_432 })
  okIf('setCaps 生效', r1.ok === true && r1.caps.h5 === 12_345_678 && rt._effectiveConfig().cap5h === 12_345_678)
  eq('getCaps 读回', svc.getCaps().week, 98_765_432)

  const bad = svc.setCaps({ cap5h: -1 })
  eq('setCaps 拒绝非法输入', bad.ok, false)

  // POST /set 路由
  const res = makeRes()
  await rt._route(makeReq({ method: 'POST', url: `${ROUTE_PREFIX}/set`, body: JSON.stringify({ cap5h: 5_000_000 }) }), res)
  eq('POST /set 200', res.status, 200)
  eq('POST /set 生效', JSON.parse(res.body).caps.h5, 5_000_000)

  const resBad = makeRes()
  await rt._route(makeReq({ method: 'POST', url: `${ROUTE_PREFIX}/set`, body: '{oops' }), resBad)
  eq('POST /set 坏 JSON → 400', resBad.status, 400)

  // 落盘：新实例可见
  rt._saveNow()
  const rtB = createRation({ ctx: env.ctx, config: env.cfg })
  rtB._loadState()
  eq('跨插件改值跨实例保持', rtB._effectiveConfig().cap5h, 5_000_000)
}

// ---------------------------------------------------------------------------
// ⑥ 真数据回填断言
// ---------------------------------------------------------------------------

group('⑥ 真数据回填断言')
{
  const root = path.join(os.homedir(), '.dsh', 'sessions')
  let files = []
  try {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name === 'session.v4.jsonl.zstd') files.push(p)
      }
    }
    if (fs.existsSync(root)) walk(root)
  } catch {
    /* 没有会话目录：跳过 */
  }
  if (files.length === 0) {
    log('  （跳过：本机没有 ~/.dsh/sessions 真数据）')
  } else {
    let target = files[0]
    let best = 0
    for (const f of files) {
      const s = fs.statSync(f).size
      if (s > best) { best = s; target = f }
    }
    let raw = ''
    try {
      raw = execFileSync('zstdcat', [target], { maxBuffer: 1 << 30 }).toString('utf8')
    } catch {
      raw = ''
    }
    if (raw === '') {
      log('  （跳过：zstdcat 不可用）')
    } else {
    const events = []
    for (const line of raw.split('\n')) {
      if (!line) continue
      try { events.push(JSON.parse(line)) } catch { /* 跳过坏行 */ }
    }
    const expected = events.map((e) => extractUsage('sess-real', e)).filter((r) => r !== null)
    const uniq = new Map()
    for (const r of expected) uniq.set(r.seq, r)
    const expectedTotal = [...uniq.values()].reduce((s, r) => s + r.total, 0)

    const store = {
      list: async () => [{ header: { id: 'sess-real' }, sizeBytes: 1, eventCount: events.length }],
      open: async () => ({ read: async () => ({ events }), close: async () => {} }),
    }
    const env = makeEnv({ store })
    const rt = createRation({ ctx: env.ctx, config: env.cfg })
    rt.start({ autoBackfill: false })
    const r = await rt._backfill()
    eq('真日志：会话被扫描', r.scanned, 1)
    eq('真日志：步数与 usage 事件数一致', rt._state.records.length, uniq.size)
    eq('真日志：token 总量吻合', rt._state.records.reduce((s, x) => s + x.total, 0), expectedTotal)
    log(`  （真日志：${path.basename(path.dirname(target))} · ${uniq.size} 步 · ${formatTokens(expectedTotal)} tokens）`)
    }
  }
}

// ---------------------------------------------------------------------------
log(`\n═══ 全部通过：${passed} 项断言 ═══`)
// 宿主插件会挂 60s 家务定时器——测试跑完显式退出，别等事件循环自然清空
process.exit(0)
