// dsh-ration — 浏览器半区：左下角"配给"挂件（5 小时窗 / 周 双条）+ 点开详情。
//
//  收起态：左下角一块小卡片，两根细条 —— 5 小时滚动窗、周限额（越线变红）。
//  展开态：两把闸的进度 + 详细 Token 消耗（今日拆分、缓存占比、近 7 天迷你柱状图）。
//
//  配色跟随 DSH 主题：全部走设计令牌（--dsw-alias-* / --dsw-static-*），
//  亮色/暗色由 body[data-ds-dark-theme] 自动翻转，不需要 JS 判断。
//
//  越线不做：轮询宿主 /dsh-ration/state；blocked.on 为真时，在捕获层
//  拦下输入框的 Enter 与发送按钮（'/' 开头的命令照常放行，方便自救），
//  并用 toast 提示哪把闸满了、多久回血。
import { useEffect, useRef, useState } from 'react'

const ROUTE = '/dsh-ration'
const POLL_MS = 5000
const STALE_MS = 30000

/** 最新一次状态（捕获层监听器读取；轮询失败/过期时 fail-open）。 */
const live = { state: null, at: 0 }

function fmtTok(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?'
  if (n >= 1e8) return trim((n / 1e8).toFixed(2)) + '亿'
  if (n >= 1e4) return trim((n / 1e4).toFixed(1)) + '万'
  return String(Math.round(n))
}
function trim(s) {
  return s.includes('.') ? s.replace(/\.?0+$/u, '') : s
}
function pctOf(g) {
  return Math.max(0, Math.min(999, Math.round((g?.pct ?? 0) * 100)))
}
function levelOf(g) {
  const p = g?.pct ?? 0
  return p >= 1 ? 'over' : p >= 0.8 ? 'warn' : 'ok'
}
function fmtClock(ts) {
  if (typeof ts !== 'number' || ts <= 0) return ''
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 一根小条（5h / 周通用）。 */
function MiniBar({ label, gate }) {
  const level = levelOf(gate)
  return (
    <div className="dsh-ration-minirow">
      <span className="dsh-ration-minilabel">{label}</span>
      <span className={`dsh-ration-track is-${level}`}>
        <i style={{ width: `${Math.min(100, pctOf(gate))}%` }} />
      </span>
      <span className={`dsh-ration-minipct is-${level}`}>{pctOf(gate)}%</span>
    </div>
  )
}

/** 展开面板里的一根大条。 */
function GateRow({ gate, tail }) {
  const level = levelOf(gate)
  const off = gate?.on !== true
  return (
    <div className={`dsh-ration-gaterow${off ? ' is-off' : ''}`}>
      <div className="dsh-ration-gatehead">
        <span className="dsh-ration-gatename">
          {gate.label}
          {off ? '（关）' : ''}
          {gate.over ? ' · 越线' : ''}
        </span>
        <span className={`dsh-ration-gatenum is-${level}`}>
          {fmtTok(gate.used)} / {fmtTok(gate.cap)}（{pctOf(gate)}%）
        </span>
      </div>
      <span className={`dsh-ration-track is-${level} is-big`}>
        <i style={{ width: `${Math.min(100, pctOf(gate))}%` }} />
      </span>
      {tail !== '' ? <div className="dsh-ration-gatetail">{tail}</div> : null}
    </div>
  )
}

/** 近 7 天迷你柱状图。 */
function Last7({ days }) {
  if (!Array.isArray(days) || days.length === 0) return null
  const max = Math.max(1, ...days.map((d) => d.total ?? 0))
  return (
    <div className="dsh-ration-last7">
      {days.map((d) => (
        <span key={d.label} className="dsh-ration-day" title={`${d.label} · ${fmtTok(d.total)}`}>
          <i style={{ height: `${Math.max(6, Math.round(((d.total ?? 0) / max) * 100))}%` }} />
        </span>
      ))}
    </div>
  )
}

function Detail({ state, onClose }) {
  const g = state?.gates ?? {}
  const d = state?.detail ?? {}
  const blocked = state?.blocked?.on === true
  const today = d.today ?? { total: 0, in: 0, out: 0, cr: 0 }
  const cachePct = Math.round((d.cacheShare ?? 0) * 100)
  return (
    <div className={`dsh-ration-panel${blocked ? ' is-blocked' : ''}`}>
      <div className="dsh-ration-head">
        <span className="dsh-ration-title">配给{blocked ? ' · 越线中' : ''}</span>
        <button type="button" className="dsh-ration-close" onClick={onClose} aria-label="收起">
          ×
        </button>
      </div>
      {blocked ? <div className="dsh-ration-alert">{state.blocked.text}</div> : null}
      <GateRow gate={g.h5} tail={g.h5 ? (g.h5.over ? `回血 ≈ ${fmtClock(g.h5.freeAt)}` : '滚动窗 · 持续回血') : ''} />
      <GateRow gate={g.week} tail={g.week ? `${fmtClock(g.week.resetAt)} 重置` : ''} />
      <div className="dsh-ration-sep" />
      <div className="dsh-ration-detail">
        <div className="dsh-ration-dline">
          <span>今日</span>
          <span>
            {fmtTok(today.total)}
            <em className="dsh-ration-sub">（新 {fmtTok(today.in)} · 出 {fmtTok(today.out)} · 缓存 {fmtTok(today.cr)}）</em>
          </span>
        </div>
        <div className="dsh-ration-dline">
          <span>缓存占比（本周）</span>
          <span>{cachePct}%</span>
        </div>
        <div className="dsh-ration-dline">
          <span>近 7 天</span>
          <Last7 days={d.last7} />
        </div>
      </div>
      <div className="dsh-ration-foot">
        越线不做：{state.enforce ? '开' : '关'} · 调参 /ration
      </div>
    </div>
  )
}

function RationWidget() {
  const [state, setState] = useState(null)
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef(0)

  const showToast = (text, ms = 3600) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), ms)
  }

  // —— 状态轮询 ——
  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try {
        const r = await fetch(`${ROUTE}/state`)
        const j = await r.json()
        if (!alive || j?.ok !== true) return
        live.state = j
        live.at = Date.now()
        setState(j)
      } catch {
        /* 宿主没起来：保持现状（拦截侧 fail-open） */
      }
    }
    void refresh()
    const t = setInterval(refresh, POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      clearInterval(t)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  // —— 越线不做：捕获层拦下新发送 ——
  useEffect(() => {
    const blockedNow = () => {
      const s = live.state
      if (s === null || Date.now() - live.at > STALE_MS) return null
      return s.blocked?.on === true ? s.blocked : null
    }
    const tryBlock = (inputEl) => {
      const text = String(inputEl?.textContent ?? '').trim()
      if (text === '' || text.startsWith('/')) return false
      const blocked = blockedNow()
      if (blocked === null) return false
      try {
        const sel = window.getSelection()
        const range = document.createRange()
        range.selectNodeContents(inputEl)
        sel.removeAllRanges()
        sel.addRange(range)
        document.execCommand('delete', false, null)
        sel.removeAllRanges()
      } catch {
        /* 清不掉也拦住发送 */
      }
      showToast(blocked.text !== '' ? blocked.text : '〔配给〕越线了，先停一停。')
      return true
    }
    const onKey = (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.repeat || e.isComposing || e.keyCode === 229) return
      const t = e.target
      const inputEl = t && t.closest ? t.closest('[data-composer-input]') : null
      if (inputEl === null || inputEl === undefined) return
      if (tryBlock(inputEl)) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
      }
    }
    const onClick = (e) => {
      const t = e.target
      const card = t && t.closest ? t.closest('[data-composer-card]') : null
      if (card === null || card === undefined) return
      const btn = t.closest('button')
      if (btn === null || btn === undefined) return
      const label = String(btn.getAttribute('aria-label') ?? '').toLowerCase()
      const isSend = label.includes('发送') || label.includes('send') || label.includes('queue') || label.includes('steer')
      if (!isSend) return
      const inputEl = card.querySelector('[data-composer-input]')
      if (inputEl === null) return
      if (tryBlock(inputEl)) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
      }
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [])

  if (state === null) return null
  const g = state.gates ?? {}
  const blocked = state.blocked?.on === true
  return (
    <div className="dsh-ration-root">
      {toast !== '' ? <div className="dsh-ration-toast">{toast}</div> : null}
      {open ? <Detail state={state} onClose={() => setOpen(false)} /> : null}
      <button
        type="button"
        className={`dsh-ration-chip${blocked ? ' is-blocked' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="配给：5 小时窗 / 周 token 限额（点击展开）"
      >
        {blocked ? <span className="dsh-ration-badge">停</span> : null}
        <MiniBar label="5h" gate={g.h5} />
        <MiniBar label="周" gate={g.week} />
      </button>
    </div>
  )
}

// ── 样式（注入一次） ─────────────────────────────────────────────────────
// 颜色全部走 DSH 设计令牌：亮/暗由 body[data-ds-dark-theme] 自动翻转。
// var() 第二参是兜底值（防御未来主题失效，不至于裸奔）。
const CSS = `
.dsh-ration-root{position:fixed;left:12px;bottom:14px;z-index:11000;pointer-events:none;font-size:12px}
.dsh-ration-chip{pointer-events:auto;position:relative;display:flex;flex-direction:column;gap:3px;padding:6px 8px;
  border-radius:10px;cursor:pointer;min-width:104px;text-align:left;
  border:1px solid var(--dsw-alias-border-l2, rgba(128,132,140,.35));
  background:var(--dsw-alias-bg-layer-1, rgba(22,26,34,.86));
  backdrop-filter:blur(8px);color:var(--dsw-alias-label-primary, #e6e8ee);
  box-shadow:0 4px 14px rgba(0,0,0,.12)}
.dsh-ration-chip.is-blocked{border-color:var(--dsw-static-red-600, #ec1313);
  box-shadow:0 0 0 1px var(--dsw-static-red-600, #ec1313) inset}
.dsh-ration-minirow{display:flex;align-items:center;gap:5px}
.dsh-ration-minilabel{width:17px;font-size:10px;line-height:1;color:var(--dsw-alias-label-tertiary, #81858c)}
.dsh-ration-minipct{width:30px;text-align:right;font-size:10px;line-height:1;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-secondary, #61666b)}
.dsh-ration-track{display:inline-block;flex:1;height:5px;border-radius:3px;overflow:hidden;
  background:var(--dsw-alias-bg-skeleton, rgba(128,132,140,.18))}
.dsh-ration-track.is-big{display:block;width:100%;height:7px;margin-top:5px}
.dsh-ration-track i{display:block;height:100%;border-radius:3px;transition:width .4s ease;
  background:var(--dsw-static-green-500, #22c55e)}
.dsh-ration-track.is-warn i{background:var(--dsw-static-amber-500, #f59e0b)}
.dsh-ration-track.is-over i{background:var(--dsw-static-red-600, #ec1313)}
body[data-ds-dark-theme] .dsh-ration-track i{background:var(--dsw-static-green-400, #4ed17e)}
body[data-ds-dark-theme] .dsh-ration-track.is-warn i{background:var(--dsw-static-amber-400, #fbbf24)}
body[data-ds-dark-theme] .dsh-ration-track.is-over i{background:var(--dsw-static-red-500, #ef4444)}
.dsh-ration-minipct.is-warn,.dsh-ration-gatenum.is-warn{color:var(--dsw-static-amber-500, #f59e0b)}
.dsh-ration-minipct.is-over,.dsh-ration-gatenum.is-over{color:var(--dsw-static-red-600, #ec1313)}
body[data-ds-dark-theme] .dsh-ration-minipct.is-warn,body[data-ds-dark-theme] .dsh-ration-gatenum.is-warn{color:var(--dsw-static-amber-400, #fbbf24)}
body[data-ds-dark-theme] .dsh-ration-minipct.is-over,body[data-ds-dark-theme] .dsh-ration-gatenum.is-over{color:var(--dsw-static-red-500, #ef4444)}
.dsh-ration-badge{position:absolute;top:-7px;right:-7px;width:18px;height:18px;border-radius:50%;
  background:var(--dsw-static-red-600, #ec1313);color:#fff;font-size:11px;line-height:18px;text-align:center}
body[data-ds-dark-theme] .dsh-ration-badge{background:var(--dsw-static-red-500, #ef4444)}
.dsh-ration-panel{pointer-events:auto;position:absolute;left:0;bottom:calc(100% + 8px);width:264px;padding:10px 12px 8px;
  border-radius:12px;border:1px solid var(--dsw-alias-border-l2, rgba(128,132,140,.35));
  background:var(--dsw-alias-bg-layer-1, rgba(22,26,34,.95));backdrop-filter:blur(10px);
  box-shadow:0 10px 30px rgba(0,0,0,.24);color:var(--dsw-alias-label-primary, #e6e8ee)}
.dsh-ration-panel.is-blocked{border-color:var(--dsw-static-red-600, #ec1313)}
.dsh-ration-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.dsh-ration-title{font-weight:600;font-size:12px;letter-spacing:.06em}
.dsh-ration-close{width:20px;height:20px;padding:0;border:none;border-radius:50%;cursor:pointer;line-height:1;
  background:var(--dsw-alias-bg-skeleton, rgba(128,132,140,.18));color:var(--dsw-alias-label-secondary, #61666b)}
.dsh-ration-alert{margin:-2px 0 8px;padding:6px 8px;border-radius:8px;font-size:11px;line-height:1.5;
  background:color-mix(in srgb, var(--dsw-static-red-600, #ec1313) 12%, transparent);
  color:var(--dsw-static-red-600, #ec1313)}
body[data-ds-dark-theme] .dsh-ration-alert{color:var(--dsw-static-red-500, #ef4444);
  background:color-mix(in srgb, var(--dsw-static-red-500, #ef4444) 18%, transparent)}
.dsh-ration-gaterow{margin-bottom:8px}
.dsh-ration-gaterow.is-off{opacity:.55}
.dsh-ration-gatehead{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.dsh-ration-gatename{font-size:11px;color:var(--dsw-alias-label-secondary, #61666b)}
.dsh-ration-gatenum{font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary, #e6e8ee)}
.dsh-ration-gatetail{margin-top:3px;font-size:10px;color:var(--dsw-alias-label-tertiary, #81858c)}
.dsh-ration-sep{height:1px;background:var(--dsw-alias-border-l2, rgba(128,132,140,.35));margin:10px 0 8px}
.dsh-ration-dline{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;font-size:11px;
  color:var(--dsw-alias-label-secondary, #61666b);font-variant-numeric:tabular-nums}
.dsh-ration-sub{font-style:normal;color:var(--dsw-alias-label-tertiary, #81858c);font-size:10px;margin-left:4px}
.dsh-ration-last7{display:flex;align-items:flex-end;gap:3px;height:26px}
.dsh-ration-day{width:10px;height:100%;display:flex;align-items:flex-end;border-radius:3px;
  background:var(--dsw-alias-bg-skeleton, rgba(128,132,140,.18))}
.dsh-ration-day i{display:block;width:100%;border-radius:3px;background:var(--dsw-static-green-500, #22c55e);opacity:.85}
body[data-ds-dark-theme] .dsh-ration-day i{background:var(--dsw-static-green-400, #4ed17e)}
.dsh-ration-foot{margin-top:8px;font-size:10px;color:var(--dsw-alias-label-tertiary, #81858c)}
.dsh-ration-toast{pointer-events:none;position:absolute;left:0;bottom:calc(100% + 8px);max-width:320px;padding:8px 12px;
  border-radius:10px;font-size:12px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.28);
  border:1px solid var(--dsw-static-red-600, #ec1313);
  background:var(--dsw-alias-bg-layer-1, rgba(24,28,36,.96));color:var(--dsw-alias-label-primary, #e6e8ee)}
`

const inject = ['slots']

async function apply(ctx) {
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.id = 'dsh-ration-style'
    tag.dataset.plugin = 'dsh-ration'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => tag.remove()
  }, 'dsh-ration: styles')

  ctx.slots.inject('shell.overlay', () => {
    const dispose = ctx.slots.register({ name: 'shell.overlay', id: 'ration', order: 950 }, RationWidget)
    return () => dispose()
  })
}

export { apply, inject }
