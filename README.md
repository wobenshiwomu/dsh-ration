# dsh-ration（配给）

> 自己给自己防沉迷的 token 限额插件 —— 5 小时滚动窗 + 周，两把闸；越线就不接新活。
> 刻度对标 Kimi：5h : 周 = 1 : 5（默认 **4000 万 / 2 亿**）。

## 是什么

DSH 里没有"套餐额度"这回事，按 token 烧钱、无限续杯——很容易一坐就是十几个小时。
**配给**给你装两把闸：

| 闸 | 默认额度 | 重置方式 |
|---|---|---|
| 5 小时滚动窗 | **4000 万** token | 滚动：烧掉的份额随时间自己流回来（Kimi 式） |
| 周 | **2 亿** token | 每周一 00:00 |

**越线不做**：任一把闸越线 → 左下角挂件变红，新的指令发不出去（正在跑的回合不受影响）。
"/" 开头的命令永远放行，所以被拦时可以用 `/ration off` 当场自救。

## 界面

- **左下角小挂件**：两根细条 —— 5 小时窗、周（平时不打扰，瞄一眼就知道用了多少）。
  亮暗跟随 DSH 主题（走设计令牌，不需要手动切）。
- **点开**：两把闸的进度 + 详细 Token 消耗（今日拆分：新 prompt / 输出 / 缓存读；
  缓存占比；近 7 天迷你柱状图）。
- 配色会自动预警：80% 起变黄，越线变红。

## 命令

```
/ration                          查看两闸状态
/ration on | off                 越线不做 开 / 关
/ration set 5h|week N            改额度（支持 k/m/b/万/亿：/ration set week 1.5亿）
/ration unset 5h|week            撤回改值，回到 profile 配置
/ration gate 5h|week on|off      单独开关某把闸
```

## 实现要点

- **账本**：启动时回填全部会话日志（`sessionPersistence`），之后由 `session/event`
  实时增量；按 (会话, seq) 幂等，重启/重放不重复计。零 token、不打扰模型。
- **统计口径**：每条 assistant 消息的 `usage.totalTokens`（含缓存读与写入）。
- **越线拦截**：客户端在捕获层拦下输入框 Enter 与发送按钮；状态过期时自动 fail-open
  （不会因为插件故障挡住你干活）。
- 状态持久化在 `$DSH_HOME/storages/dsh-ration/state.json`，账本默认保留 35 天。
- **跨插件接口（v0.1.2）**：`ctx.provide('ration')` 服务（`setCaps` / `getCaps`）+ `POST /dsh-ration/set`
  路由——供 [dsh-plan](https://github.com/wobenshiwomu/dsh-plan) 订阅后自动校准额度。

## 配置（profile 层可覆盖）

```yaml
- id: dsh-ration
  config:
    cap5h: 40000000      # 5 小时滚动窗
    capWeek: 200000000   # 周
    enforce: true        # 越线不做
    gate5h: true
    gateWeek: true
    warnPct: 0.8
    keepDays: 35
```

## 安装

```sh
dsh plugin --profile web add 'https://codeload.github.com/wobenshiwomu/dsh-ration/tar.gz/v0.1.1'
```

或在图形界面：侧栏「插件」→ 添加插件 → 填上面这条 URL。装完重启 DSH 生效。
URL 末段的 `v0.1.1` 是版本标签；升级时换成本仓库的新版本标签重装即可。

## 开发

```bash
node test/sim.mjs          # 72 项断言（含真实会话日志回填校验）
# 重建客户端（需要一个 esbuild 二进制：cp 别家的 scripts/esbuild，或 npm i -g esbuild）
ESBUILD_BIN=scripts/esbuild node scripts/build-client.mjs
```
