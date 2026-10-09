# dsh-eval-control

[![npm version](https://img.shields.io/npm/v/dsh-eval-control?logo=npm&color=cb3837)](https://www.npmjs.com/package/dsh-eval-control)
[![npm downloads](https://img.shields.io/npm/dm/dsh-eval-control)](https://www.npmjs.com/package/dsh-eval-control)
[![license](https://img.shields.io/npm/l/dsh-eval-control)](LICENSE)
[![dsh-plugin topic](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)
[![dshfind](https://dshfind.com/api/badge/xyrrrrr-r/dsh-eval-control?metric=downloads)](https://dshfind.com/zh/plugins)

**aeval 的宿主侧 DSH 评测控制插件**：把一次评测试次所需的全部实验事实——
变量、预算、血统、证据归属——一次性注入 DSH agent 进程，并密封成可校验的
bundle descriptor。

Host-side Cordis control plugin for [aeval](https://github.com/xyrrrrr-r/aeval):
one-shot config injection for experiment variables, gateway-lease budgets,
fork lineage, and bundle descriptors.（experimental · v0.2.1 · Apache-2.0）

## 它解决什么问题

评测一个 DSH agent，靠手改配置跑会话是不可信的：参数没绑定、预算没封顶、
fork 出来的会话认不了亲、证据说不清归属。本插件把这些全部变成**声明式、
一次性、可校验**的：

- 评测开始时注入完整实验配置（`EvalControlConfig`），配置摘要（`configDigest`）
  与运行时锁（`runtime_lock_digest`）互相绑定——事后任何人无法辩称"当时参数不一样"；
- 所有模型调用经由宿主 broker 走网关租约：预算封顶、辅助调用按策略拒绝
  （`refuseAuxiliaryCalls` / `auxiliaryPolicy`），租约关闭即拒绝安装；
- fork 血统（`parentSessionId` / `parentTrialId` / `forkStep`）显式校验，
  跨会话记忆类评测才有可信基底；
- 会话记录经官方 JSONL persistence 读取，路径安全检查（拒绝符号链接、
  限定 allowed base、64KB 请求上限、类型化错误码）。

## 组成

| 模块 | 职责 |
|---|---|
| `index.ts`（Cordis 插件 `dsh-eval-control`） | 绑定配置、注入实验变量、写 bundle descriptor、`finalize` 终态锁存 |
| `sandbox_entry.ts` | 沙箱侧入口：安装 broker transport，把实验 provider 的每次模型调用路由到宿主 broker；对已关闭租约拒绝安装 |
| `variable_inject.ts` | 实验身份注入（provider / model / reasoning effort / agent options） |
| `gateway_lease.ts` · `host_broker.ts` | 网关租约（job token、调度/拒绝记录）与宿主 broker |
| `fork.ts` | fork 血统校验与会话元数据 |
| `bundle_writer.ts` | bundle descriptor（证据归属，schema 版本化） |
| `session_reader.ts` / `session_stub.ts` | 官方会话读取 / 桩会话创建（独立 bin，供 aeval 采集侧调用） |
| `token_bound.ts` · `upstream.ts` · `stop_reason.ts` | 输入 token 上限、上游 chat-completions 适配、停止原因推导 |
| `control_config_source.ts` · `control_status.ts` | 配置来源解析（内联 / `controlConfigPath` / `AEVAL_CONTROL_CONFIG`）与 `evalControlStatus` 状态服务 |
| `selfcheck.ts` | 自检命令：只读核对配置、token、路径与 broker `/info` |
| `client/client.js` | Web 只读状态胶囊（`dsh.client`，读宿主 `pluginInventory/list`） |

独立命令（`package.json` bin）：`aeval-dsh-session-reader`、`aeval-dsh-session-stub`、
`aeval-model-broker`、`aeval-dsh-control-selfcheck`。

## 配置（EvalControlConfig）

```jsonc
{
  "run": {                        // 运行绑定：四元组互相锁死
    "run_id": "run-tbench-offline-1",
    "job_config_hash": "…",
    "config_file_sha256": "…",
    "runtime_lock_digest": "…"
  },
  "trialId": "trial-0",
  "sessionId": "…",
  "sessionRoot": "/…",            // 绝对路径、无符号链接，越界即拒
  "provider": "…", "model": "…", "reasoningEffort": "…",
  "maxSteps": 32, "maxTokens": 8192,
  "tools": { "allow": ["…"], "deny": ["…"] },
  "lineage": { "parentSessionId": "…", "parentTrialId": "…", "forkStep": 3 },
  "bundlePath": "/…/bundle.json",
  "gatewayUrl": "http://127.0.0.1:…",   // 宿主 broker
  "jobTokenFile": "/…/job-token",
  "refuseAuxiliaryCalls": true,          // 辅助调用默认拒绝
  "auxiliaryPolicy": { "…": "allow" }    // 按用途显式放行（优先于总开关）
}
```

配置按原样（as-authored）参与摘要计算，宿主组合的配置与沙箱内解析的配置
逐字段比对——**两边不一致即失败**，不做静默兼容。

除内联配置外，行配置还接受两种等价形态（解析结果与内联逐字段一致，
`configDigest` 不变）：`{ "controlConfigPath": "/abs/config.json" }` 指向
owner 写出的配置文件；或整行为空 `{}` 且设置 `AEVAL_CONTROL_CONFIG`。
两者都没有时进入 **standalone**：不挂载任何东西、不重定向模型调用，
只发布 `evalControlStatus` 状态——安装插件不会破坏一个普通 profile。

## 安装

### 作为 aeval 的控制栈（沙箱内）

`aeval run` 的 DSH flavor 通过 `deploy_control_stack` 把编译后的 `dist/`
部署进沙箱的 DSH 安装树，并注入自己生成的 patch（transport 在前、控制插件
在后）。这条链路不读本包的 `cordis.patch.yml`，行为不受本包发布面影响。

### 作为 DSH 插件（普通 profile）

```bash
dsh plugin --profile web add dsh-eval-control
```

也可以走 [1024 商店的插件页](https://deepseek1024.com/plugins/xyrrrrr-r/dsh-eval-control) 的追踪安装器——`dsh1024 plugin …` 就是官方
`dsh plugin …` 换了名字，参数原样转发，额外记录一条匿名安装结果用于该店的安装量排名：

```bash
npm install -g dsh1024 && dsh1024 plugin --profile web add dsh-eval-control
```

目录收录：本包已在 [1024 商店](https://deepseek1024.com/plugins/xyrrrrr-r/dsh-eval-control) 的 `dev` 分类下；
仓库带有 [`dsh-plugin` 主题](https://github.com/topics/dsh-plugin)，[dshfind](https://dshfind.com/zh/plugins)
会在每日主题同步后自动索引，顶部 dshfind 徽章在收录前显示 `not listed` 属正常，收录后自动有值。

装完即为 standalone：设置页里能看到插件卡片与 Web 状态胶囊，
`aeval-dsh-control-selfcheck` 也能核对本机环境。要挂上完整控制栈，
把 `cordis.patch.yml` 的两行补全（或设 `AEVAL_CONTROL_CONFIG`）并重启：

```yaml
- insert:
    - id: aeval-broker-transport
      name: './dist/sandbox_entry.js'
      config:
        controlConfigPath: '/abs/path/control-config.json'
    - id: aeval-eval-control
      name: './dist/index.js'
      config:
        controlConfigPath: '/abs/path/control-config.json'
```

行序不可颠倒：控制插件 inject `evalBroker`，只有 transport 提供它。

```bash
npm install dsh-eval-control    # Node ^22.19 || >=24；含编译产物、类型 shim 与四个 bin 命令
aeval-dsh-control-selfcheck --config /abs/path/control-config.json   # 只读自检；加 --json 出机器可读报告
```

变更见 [CHANGELOG](CHANGELOG.md)；语义化版本（0.x 实验期：minor 版本可能含破坏性
变更，均在 CHANGELOG 显式列出）。

## 构建与测试

从源码构建（要求 Node `^22.19.0 || >=24.0.0`）：

```bash
npm install
npm run build     # pull-neutral + tsc：从 aeval/control 组合部署产物
npm test          # build + 测试编译 + node --test
```

`scripts/pull-neutral.mjs` 说明：broker 集群的**中立源码真身在 aeval 仓库的
`control/`（aeval-control）**——它从本包字节一致地抽出，供所有 agent 控制栈
共享。构建时若存在同级 `../aeval/control/dist`（或 `AEVAL_CONTROL_DIST` 指向），
则把中立运行时的 `.js` 组合进本包 `dist/`、`.d.ts` 落回 `src/`；若不存在
（独立 clone），已提交的 shim 与 dist 保证**独立可构建**，新鲜度测试会在
同级仓库存在时重新校验字节一致。

## aeval 如何消费本包

- `aeval run` 的 DSH flavor 通过 `deploy_control_stack` 把编译后的 `dist/`
  部署进沙箱的 DSH 安装树（`sandbox_entry` 在前、控制插件在后挂载）；
- 采集侧的官方 session reader 按以下顺序发现：`node_modules/dsh-eval-control/dist/session_reader.js`
  → 环境变量 `AEVAL_DSH_SESSION_READER`（配合 `AEVAL_DSH_CONTROL_ROOT`）；
  找不到就报错拒跑，绝不静默降级；
- 会话记录读取结果进入采集清单，与运行时锁一起被证据门逐一 sha256 校验。

## 与 aeval 的关系

```
aeval (Python)                     评测编排 · 判分 · 密封 · 报告
├── control/  (aeval-control)      agent 中立控制面：host broker + gateway lease
└── agents/dsh/                    DSH 适配器：部署并消费 ↓
dsh-eval-control (本包, TypeScript) DSH 形态控制插件：变量注入 · 血统 · descriptor
```

本包只保留 DSH 特有部分；一切 agent 通用的控制面逻辑归 aeval-control，
避免两份实现漂移。

## 测试

`test/` 覆盖：配置解析与摘要、变量注入、fork 血统、证据/bundle 写入、
session reader/stub 的路径安全拒绝、中立 shim 新鲜度、环境回归，以及发布面
自身的守卫（bundle 声明与补丁文件、`files`/`exports` 白名单、locale/icon、
peer 范围与构建期 pin 的分离、selfcheck 作为真实进程跑、standalone 与
fail-closed 两条路径）。`npm test` 全绿是提交前提。

```bash
npm test    # build + 测试编译 + node --test，全部用例
```

构建单元由中立运行时（`aeval/control`）组合而成，取用顺序是 `$AEVAL_CONTROL_DIST`
→ 同级 `../aeval/control/dist` → 仓库内的 `vendor/neutral/`。`dist/` 本身不入库，
所以 `vendor/neutral/` 正是**独立 clone 也能构建并跑全绿**的那一份；只有同级
checkout 存在时，`src/` 里的类型 shim 才会被真实构建刷新。中立产物变化后同步一次：

```bash
npm run vendor:neutral    # 需同级 ../aeval/control 已 npm run build
```

想接入自己的 agent、写自己的评测套件，或弄清报告里每个指标的含义，见 aeval 的
使用者指南：[写一个评测套件](https://github.com/xyrrrrr-r/aeval/blob/main/docs/guides/writing-a-suite.md) ·
[接入一个新的 agent](https://github.com/xyrrrrr-r/aeval/blob/main/docs/guides/adding-an-agent.md) ·
[指标语义与判分规则](https://github.com/xyrrrrr-r/aeval/blob/main/docs/guides/metric-semantics.md)。

## 发布

```bash
npm login       # 一次性；开了 2FA 的账号按提示输入 OTP（或使用 automation token）
npm publish     # prepublishOnly 会先自动 build + 全量测试，任何失败即中止
```

发布面的两条约定：

- `@deepseek-ai/*` 通过 `peerDependencies` 给出宿主版本窗口
  （`>=0.1.7-alpha.1 <0.1.8-0 || >=0.1.8-alpha.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0`、
  `cordis ^4.0.3`、`schemastery ^3.18.3`），精确 pin 留在 `devDependencies`
  作为构建记录——profile 因此复用宿主自己的那一份 Harness，而不是再装一套；
  peer 范围不满足时 DSH 会**跳过整个 bundle**（仅 stderr 提示），所以改范围
  必须真装一次验证。
- 写窗口时注意预发布规则：node-semver 只在范围里存在**同一
  `major.minor.patch` 元组上带预发布标签的比较符**时才放行该预发布版本。
  `<0.2.0` 这类上界不带预发布标签，因此静默排除 `0.2.0-rc.2`——宿主会跳过
  整个 bundle，看起来像插件没装。窗口按元组分段正是为此：`0.1.7` 与 `0.1.8`
  段各自放行自己的预发布，`0.2.x` 段用 `>=0.2.0-0 <0.3.0-0` 放行 0.2.0 的
  预发布与整条 0.2 线。宿主出现 0.2.1 及以上 minor 的预发布时，需再补一条
  对应元组的分支。
- 收录进插件市场时，静态审查只读 `package.json` 的 `dsh.bundle.patch` 与
  同 revision 的补丁文件；npm 上 latest manifest 声明 `dsh.bundle` 才会
  出现安装命令。本包两者都已具备。

## License

Apache-2.0，见 [LICENSE](LICENSE)。
