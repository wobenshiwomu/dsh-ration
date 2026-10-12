window.__ModuleLoader__.load({
	id: "dsh-ration",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var ROUTE = "/dsh-ration";
var POLL_MS = 5e3;
var STALE_MS = 3e4;
var live = { state: null, at: 0 };
function fmtTok(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "?";
  if (n >= 1e8) return trim((n / 1e8).toFixed(2)) + "亿";
  if (n >= 1e4) return trim((n / 1e4).toFixed(1)) + "万";
  return String(Math.round(n));
}
function trim(s) {
  return s.includes(".") ? s.replace(/\.?0+$/u, "") : s;
}
function pctOf(g) {
  return Math.max(0, Math.min(999, Math.round((g?.pct ?? 0) * 100)));
}
function levelOf(g) {
  const p = g?.pct ?? 0;
  return p >= 1 ? "over" : p >= 0.8 ? "warn" : "ok";
}
function fmtClock(ts) {
  if (typeof ts !== "number" || ts <= 0) return "";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function MiniBar({ label, gate }) {
  const level = levelOf(gate);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ration-minirow", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-ration-minilabel", children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `dsh-ration-track is-${level}`, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { width: `${Math.min(100, pctOf(gate))}%` } }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: `dsh-ration-minipct is-${level}`, children: [
      pctOf(gate),
      "%"
    ] })
  ] });
}
function GateRow({ gate, tail }) {
  const level = levelOf(gate);
  const off = gate?.on !== true;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: `dsh-ration-gaterow${off ? " is-off" : ""}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ration-gatehead", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-ration-gatename", children: [
        gate.label,
        off ? "（关）" : "",
        gate.over ? " · 越线" : ""
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: `dsh-ration-gatenum is-${level}`, children: [
        fmtTok(gate.used),
        " / ",
        fmtTok(gate.cap),
        "（",
        pctOf(gate),
        "%）"
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `dsh-ration-track is-${level} is-big`, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { width: `${Math.min(100, pctOf(gate))}%` } }) }),
    tail !== "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-ration-gatetail", children: tail }) : null
  ] });
}
function Last7({ days }) {
  if (!Array.isArray(days) || days.length === 0) return null;
  const max = Math.max(1, ...days.map((d) => d.total ?? 0));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-ration-last7", children: days.map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-ration-day", title: `${d.label} · ${fmtTok(d.total)}`, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { height: `${Math.max(6, Math.round((d.total ?? 0) / max * 100))}%` } }) }, d.label)) });
}
function Detail({ state, onClose }) {
  const g = state?.gates ?? {};
  const d = state?.detail ?? {};
  const blocked = state?.blocked?.on === true;
  const today = d.today ?? { total: 0, in: 0, out: 0, cr: 0 };
  const cachePct = Math.round((d.cacheShare ?? 0) * 100);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: `dsh-ration-panel${blocked ? " is-blocked" : ""}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ration-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-ration-title", children: [
        "配给",
        blocked ? " · 越线中" : ""
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-ration-close", onClick: onClose, "aria-label": "收起", children: "×" })
    ] }),
    blocked ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-ration-alert", children: state.blocked.text }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GateRow, { gate: g.h5, tail: g.h5 ? g.h5.over ? `回血 ≈ ${fmtClock(g.h5.freeAt)}` : "滚动窗 · 持续回血" : "" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GateRow, { gate: g.week, tail: g.week ? `${fmtClock(g.week.resetAt)} 重置` : "" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-ration-sep" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ration-detail", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ration-dline", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "今日" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          fmtTok(today.total),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("em", { className: "dsh-ration-sub", children: [
            "（新 ",
            fmtTok(today.in),
            " · 出 ",
            fmtTok(today.out),
            " · 缓存 ",
            fmtTok(today.cr),
            "）"
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ration-dline", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "缓存占比（本周）" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          cachePct,
          "%"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ration-dline", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "近 7 天" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Last7, { days: d.last7 })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ration-foot", children: [
      "越线不做：",
      state.enforce ? "开" : "关",
      " · 调参 /ration"
    ] })
  ] });
}
function RationWidget() {
  const [state, setState] = (0, import_react.useState)(null);
  const [open, setOpen] = (0, import_react.useState)(false);
  const [toast, setToast] = (0, import_react.useState)("");
  const toastTimer = (0, import_react.useRef)(0);
  const showToast = (text, ms = 3600) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), ms);
  };
  (0, import_react.useEffect)(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const r = await fetch(`${ROUTE}/state`);
        const j = await r.json();
        if (!alive || j?.ok !== true) return;
        live.state = j;
        live.at = Date.now();
        setState(j);
      } catch {
      }
    };
    void refresh();
    const t = setInterval(refresh, POLL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  (0, import_react.useEffect)(() => {
    const blockedNow = () => {
      const s = live.state;
      if (s === null || Date.now() - live.at > STALE_MS) return null;
      return s.blocked?.on === true ? s.blocked : null;
    };
    const tryBlock = (inputEl) => {
      const text = String(inputEl?.textContent ?? "").trim();
      if (text === "" || text.startsWith("/")) return false;
      const blocked2 = blockedNow();
      if (blocked2 === null) return false;
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(inputEl);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("delete", false, null);
        sel.removeAllRanges();
      } catch {
      }
      showToast(blocked2.text !== "" ? blocked2.text : "〔配给〕越线了，先停一停。");
      return true;
    };
    const onKey = (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.repeat || e.isComposing || e.keyCode === 229) return;
      const t = e.target;
      const inputEl = t && t.closest ? t.closest("[data-composer-input]") : null;
      if (inputEl === null || inputEl === void 0) return;
      if (tryBlock(inputEl)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };
    const onClick = (e) => {
      const t = e.target;
      const card = t && t.closest ? t.closest("[data-composer-card]") : null;
      if (card === null || card === void 0) return;
      const btn = t.closest("button");
      if (btn === null || btn === void 0) return;
      const label = String(btn.getAttribute("aria-label") ?? "").toLowerCase();
      const isSend = label.includes("发送") || label.includes("send") || label.includes("queue") || label.includes("steer");
      if (!isSend) return;
      const inputEl = card.querySelector("[data-composer-input]");
      if (inputEl === null) return;
      if (tryBlock(inputEl)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
  if (state === null) return null;
  const g = state.gates ?? {};
  const blocked = state.blocked?.on === true;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ration-root", children: [
    toast !== "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-ration-toast", children: toast }) : null,
    open ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Detail, { state, onClose: () => setOpen(false) }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: `dsh-ration-chip${blocked ? " is-blocked" : ""}`,
        onClick: () => setOpen((v) => !v),
        title: "配给：5 小时窗 / 周 token 限额（点击展开）",
        children: [
          blocked ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-ration-badge", children: "停" }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MiniBar, { label: "5h", gate: g.h5 }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MiniBar, { label: "周", gate: g.week })
        ]
      }
    )
  ] });
}
var CSS = `
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
`;
var inject = ["slots"];
async function apply(ctx) {
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.id = "dsh-ration-style";
    tag.dataset.plugin = "dsh-ration";
    tag.textContent = CSS;
    document.head.appendChild(tag);
    return () => tag.remove();
  }, "dsh-ration: styles");
  ctx.slots.inject("shell.overlay", () => {
    const dispose = ctx.slots.register({ name: "shell.overlay", id: "ration", order: 950 }, RationWidget);
    return () => dispose();
  });
}

		return module.exports;
	}
});
