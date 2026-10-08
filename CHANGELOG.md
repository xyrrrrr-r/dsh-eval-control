# Changelog

本文件记录 dsh-eval-control 的所有重要变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

**0.x 实验期政策**：0.x 阶段的 minor 版本允许包含破坏性变更（配置
schema、bundle descriptor 格式、bin 协议），每次都会在下方
`Changed`/`Removed` 中显式列出并附迁移说明；patch 版本只含修复。
1.0.0 起严格遵循 SemVer。

## [Unreleased]

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

[Unreleased]: https://gitcode.com/open_kunpeng_agentic_infra/dsh-eval-control/compare/v0.1.0...HEAD
[0.1.0]: https://gitcode.com/open_kunpeng_agentic_infra/dsh-eval-control/releases/tag/v0.1.0
