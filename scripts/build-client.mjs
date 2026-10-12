// 把 src/client/index.jsx 打成 lib/client.js —— DSH 浏览器内核期待的
// window.__ModuleLoader__.load 形状（与 dsh-johnny / dsh-bite / dsh-bookmarks 同款封装）。
//
// esbuild 用外部二进制（本机 Termux 用 @esbuild/android-arm64 的二进制）：
//   已随仓库附带：scripts/esbuild
//   运行：ESBUILD_BIN=scripts/esbuild node scripts/build-client.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

// factory id 必须等于 loader row 名（内核核对浏览器入口的 boot-graph id）
const MODULE_ID = 'dsh-ration'
const BODY_FILE = 'lib/.client-body.cjs'

const candidates = [process.env.ESBUILD_BIN, 'scripts/esbuild', 'node_modules/.bin/esbuild', 'esbuild'].filter(
  (c) => typeof c === 'string' && c !== '',
)
let bin = null
for (const c of candidates) {
  if (c === 'esbuild' || existsSync(c)) {
    bin = c
    break
  }
}
if (bin === null) throw new Error('build-client: esbuild 未找到（设置 ESBUILD_BIN 或放置 scripts/esbuild）')

mkdirSync('lib', { recursive: true })
execFileSync(
  bin,
  [
    'src/client/index.jsx',
    '--bundle',
    '--format=cjs',
    '--platform=browser',
    '--target=es2020',
    '--jsx=automatic',
    '--charset=utf8',
    '--external:react',
    '--external:react-dom',
    '--external:react/jsx-runtime',
    '--external:@deepseek-ai/dsh-client-ui-primitives',
    `--outfile=${BODY_FILE}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
)

const body = readFileSync(BODY_FILE, 'utf8')
const header = `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(MODULE_ID)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n`
const footer = `\n\t\treturn module.exports;\n\t}\n});\n`

writeFileSync('lib/client.js', header + body + footer)
rmSync(BODY_FILE, { force: true })
console.log(`build-client: 已写出 lib/client.js（${(header.length + body.length + footer.length) / 1024 | 0} KB）`)
