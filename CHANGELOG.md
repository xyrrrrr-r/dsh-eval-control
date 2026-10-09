# Changelog

本文件记录 dsh-eval-control 的所有重要变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

**0.x 实验期政策**：0.x 阶段的 minor 版本允许包含破坏性变更（配置
schema、bundle descriptor 格式、bin 协议），每次都会在下方
`Changed`/`Removed` 中显式列出并附迁移说明；patch 版本只含修复。
1.0.0 起严格遵循 SemVer。

## [Unreleased]

### Changed

- **仓库迁移至 GitHub**：托管地址由 GitCode 的
  `open_kunpeng_agentic_infra/dsh-eval-control` 改为 GitHub，`package.json` 与
  下方链接引用同步更新；源码、测试与全部历史提交完整保留。迁移时对**全部历史**
  做了清洗：开发过程记录（含其归档前后的两个仓库内路径）连同其中的本机绝对路径与
  内部编号一并剔除，提交邮箱改为 GitHub noreply（署名保留）。因此本仓库的提交
  SHA 与 GitCode 上的历史不再对应，从旧历史 cherry-pick 会冲突；0.2.0 这条即
  如此摘入。

### Fixed

- **独立 clone 无法构建运行面**：`scripts/pull-neutral.mjs` 原先只认同级
  `../aeval/control/dist`（或 `$AEVAL_CONTROL_DIST`），取不到就打一行提示并
  **以 0 退出**；而 `dist/` 在 `.gitignore` 里、`src/config.ts` 又已在瘦身时移除，
  于是单独 clone 本仓库拿不到 `dist/config.js`，4 条 selfcheck 用例以
  `ERR_MODULE_NOT_FOUND` 失败——README 承诺的"`npm test` 全绿是提交前提"对外部
  贡献者并不成立。现在取用顺序为 `$AEVAL_CONTROL_DIST` → 同级 checkout → 仓库内
  `vendor/neutral/`（8 个模块的 `.js` 与 `.d.ts`，与同级构建逐字节一致），三者皆缺
  才报错退出；`npm run vendor:neutral` 把同级构建同步进 vendor，并拒绝在没有同级
  checkout 时把回退副本复制给自己。`test/neutral-shims.test.ts` 新增完整性用例，
  防止 vendor 被逐个删空后仍"看起来能构建"。

## [0.2.0] - 2026-10-08

发布面版本：让本包作为 DSH 插件可被收录、可被独立安装，且装完不炸。
**aeval 的运行链路未变**：`deploy_control_stack` 依旧自己写 patch 与内联
配置，插件行为、descriptor 格式与 `configDigest` 计算方式均未改动。

### Added

- **可发布的 Cordis bundle**：`package.json` 声明 `dsh.bundle.patch`，仓库
  新增 `cordis.patch.yml`，`files` 白名单补齐补丁/locale/icon/client，
  `exports` 暴露 `./client`、`./package.json`、`./cordis.patch.yml`、
  `./locale/*.json`（并保留 `./dist/*`、`./src/*` 直通以免砍掉既有子路径）。
  已用真实 DSH 的 profile loader 验证：bundle 解析成功、peer 预检通过、
  补丁被加载且无跳过。

- **standalone 激活路径**（`src/sandbox_entry.ts`）：`controlConfigPath`
  改为可选。没有任何配置（无内联配置、无引用、无 `AEVAL_CONTROL_CONFIG`）
  时不再抛错，而是发布 `evalControlStatus` 服务、打一条通知并**什么都不挂载**
  ——模型调用不被重定向，控制行因缺少 `evalBroker` 保持未激活。**配置一旦
  提供，fail-closed 语义原样保留**：配置文件读不到、broker 不可达仍然拒绝安装。

- **配置引用形态**（`src/control_config_source.ts`）：行配置可以是内联完整
  配置、`{ controlConfigPath }` 引用，或在空配置时回退到
  `AEVAL_CONTROL_CONFIG`。内联路径逐字节透传，`configDigest` 不变。

- **自检命令** `aeval-dsh-control-selfcheck`（第 4 个 bin）：只读检查 Node
  版本、配置解析与摘要、run 绑定、job token（0600/归属/64-hex）、session
  root、descriptor 目录可写性与 broker `/info` 可达性；支持 `--json`，
  未配置时报 standalone 并以 0 退出，不打印 token。

- **Web 只读状态胶囊**（`client/client.js` + `dsh.client`）：在
  `conversation.composer.dock` 显示控制行是否挂载及其 fiber 阶段，数据来自
  宿主 `pluginInventory/list` Remote；该 Remote 缺席时如实显示"宿主通道不可用"，
  不做任何状态修改。

- **展示元数据**：`locale/en.json`、`locale/zh.json`（`meta.title` /
  `meta.description`）与顶层 `icon.svg`，已用真实 `readPluginMeta` 验证三者在
  不激活插件的情况下均可解析。

### Changed

- **发布面 peer 范围与构建期 pin 分离**：`@deepseek-ai/*` 从 `dependencies`
  移入 `peerDependencies`（范围为 `>=0.1.7-alpha.1 <0.2.0`、`cordis ^4.0.3`、
  `schemastery ^3.18.3`），精确 pin 保留在 `devDependencies` 作为构建记录，
  `@agentclientprotocol/sdk` 仍为普通依赖。profile 不再被塞入第二份 Harness。
- **内部资料归档**：`docs/TESTS/P0-3-host-broker.md` → `docs/internal/P0-3-host-broker.md`
  （内容按历史原样保留，仅修正其中一条指向 aeval 文档的相对路径）。该目录为开发
  过程记录，不作为接口说明，也不随 npm 包分发。

### Fixed

- **README 里的坏链**：README 链接的 `docs/TESTS/P0-3-host-broker.md` 对读者不可达
  ——`docs/` 不在 npm 包的 `files` 白名单里。现改为自足的 `npm test` 说明，并链接
  aeval 侧的三份使用者指南（写套件、接 agent、指标语义）。运行方式本身没有变化。

### 已知限制

- aeval 部署路径仍按 `@deepseek-ai/dsh-*@0.1.7-alpha.1` 的片构建与锁定；
  `peerDependencies` 的范围只描述**本包可被加载**的宿主版本窗口
  （`>=0.1.7-alpha.1 <0.2.0`），不改变 aeval 侧的锁定纪律。跨窗口升级仍需
  与 aeval 同步验证。
- Node 要求 `^22.19.0 || >=24.0.0`。

## [0.1.0] - 2026-10-08

首个公开版本（experimental）。

### Added

- **Cordis 控制插件** `dsh-eval-control`（inject: `llm` / `tools` /
  `sessions` / `evalBroker`）：会话启动时一次性注入全部实验事实。
- **EvalControlConfig**：run 绑定四元组（run_id / job_config_hash /
  config_file_sha256 / runtime_lock_digest）互相锁死；配置按原样
  （as-authored）参与 configDigest，宿主组合的配置与沙箱内解析的配置
  逐字段比对，不一致即失败。
- **实验变量注入**：provider / model / reasoningEffort / maxSteps /
  maxTokens / tools allow-deny。
- **网关租约预算**：BrokerAdapter + 宿主 broker（`startHostBroker`）；
  job token 鉴权；辅助调用策略（`refuseAuxiliaryCalls` 总开关 +
  `auxiliaryPolicy` 按用途显式放行，默认拒绝）；租约关闭即拒绝安装
  broker transport；调度/拒绝记录可审计。
- **fork 血统校验**：parentSessionId / parentTrialId / forkStep 显式
  验证，跨会话记忆类评测的可信基底。
- **bundle descriptor**：schema v2 证据归属写入；owner finalize 终态
  锁存（完成证据经官方 flush barrier 落盘后才可发布）。
- **沙箱侧入口** `sandbox_entry`：在被沙箱化的 DSH profile 内安装
  broker transport，把实验 provider 的每次模型调用路由到宿主 broker。
- **独立 bin**：`aeval-dsh-session-reader`（官方 JSONL persistence
  读取）、`aeval-dsh-session-stub`（桩会话创建）、`aeval-model-broker`
  （宿主 broker）。路径安全纪律：拒绝符号链接祖先、限定 allowed
  base、64KB 请求上限、类型化错误码。
- **pull-neutral 构建**：broker 集群的中立源码真身在 aeval 仓库
  `control/`（aeval-control）；构建时组合其 dist，独立 clone 用已提交
  的 shim/dist 保持可构建，新鲜度测试保证字节一致。
- token 上限、上游 chat-completions 适配、停止原因推导。

### Fixed

- 测试 fixture 在 macOS 下因 `/var → /private/var` 符号链接被 bundle
  写入器安全防护拒绝的问题（与其余测试文件同一 `realpathSync`
  约定对齐）。

### 已知限制

- 依赖 `@deepseek-ai/dsh-*` 固定 `0.1.7-alpha.1`（与 aeval 的 DSH
  适配器、官方 session 格式对齐）；升级需与 aeval 同步验证。
- Node 要求 `^22.19.0 || >=24.0.0`。

[Unreleased]: https://github.com/xyrrrrr-r/dsh-eval-control/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/xyrrrrr-r/dsh-eval-control/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/xyrrrrr-r/dsh-eval-control/releases/tag/v0.1.0
