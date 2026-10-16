# aeval 现有指标与 DSH 轨迹指标映射盘点

> 目的：先核实 aeval 已有的轨迹判分和面板统计，再决定 DSH 指标哪些复用、哪些扩展、哪些保持 DSH 专属。
> 本文是独立映射设计文档，不改写 [`trajectory-metrics-contract.md`](trajectory-metrics-contract.md)、规范化/fixture 契约或 aeval 现有 metric ID。
> 盘点基于本地 aeval 源码（2026-10-16）；“相似”不代表公式和证据口径已等价，映射前必须保留表中说明的差别。

## 1. 结论摘要

aeval **已经有一套可复用的 sealed trajectory 判分框架**，也有运行统计和轨迹面板；其中已有若干与 DSH 候选指标高度相关的 metric ID。因此目标不应是“保留一整套旧指标，再新增一整套 DSH 指标”，而应逐步把两边接到同一层规范化事实和 reducer 上。

建议采用“统一计算、兼容旧口径、增量扩展”的路线：

1. 建立跨 Agent 的 canonical facts，例如工具调用/结果/错误证据、模型 step/stream/retry、usage/window、计划快照、消息投递、turn outcome；team/member/session/task 与显式关系也在底座模型中预留。
2. 将 aeval 现有 ATIF `TrajectoryEvidence` 转成这些 facts；DSH adapter 从结构化 DSH events 转成同一 facts。两种来源进入同一 reducer 时不再复制一份算法。
3. aeval 已有指标 ID 作为兼容 API 保留；在定义一致时让旧 ID 调用共享 reducer。语义不一致时，旧 ID 保持原公式，新通用定义通过明确的版本升级或新 ID 提供，不能静默改变旧 suite 的结果。
4. 只为确实没有现有通用表示的观测能力增加新指标，例如 DSH compaction 周期/回收规模、显式 task dependency chain。先做 DSH adapter 和事实映射；其他 Agent 将来提供同语义 facts 时，再复用同一个 reducer。

aeval 目前还不是一个完整的、事件级、跨 harness 的实时 trajectory metrics 服务：

- 判分指标以 ATIF/canonical transcript 建立的 `TrajectoryEvidence` 为输入，输出 `MetricOutcome`（`ok`/`degraded`/`violated`/`skipped`、score、reasons、evidence）。它面向 sealed trial 的判分，不等同于个人面板需要的计数、趋势、span 状态和当前前缀快照。
- 多个相近指标依赖 aeval 现有启发式或预算参数，和 DSH 契约中的显式事件口径不完全相同。
- aeval 的轨迹面板/`TrajectoryStats` 已收集一些 counts、first-token、context peak、工具重试和步骤时间信息，但它们是展示统计，不自动等于 verdict metric。
- 尚未在所检查的代码中找到 DSH 的 compaction lifecycle、Team message/task DAG、成员跨子会话 busy/idle/concurrency/critical-chain 等已实现的 metric。

因此复用不等于强行把指标表一一配对。真正要统一的是 canonical facts、公式/reducer 和缺失处理；旧 ID 是兼容面，DSH 扩展是来源证据与专属事实输入。面板型观测值也不应自动被折叠成 score。

## 2. 本次源码核实范围

核对的主要实现：

- `aeval/src/aeval/verdict/trajectory/metrics.py`：trajectory metric 类与具体公式。
- `aeval/src/aeval/canonical_trajectory.py`、`aeval/src/aeval/agents/dsh/normalization.py`：当前新增的 aeval-owned canonical envelope 和首批 DSH allowlisted fact 映射；尚未有共享 reducer 或 fixture gate。
- `aeval/src/aeval/verdict/trajectory/presets.py`：现有 metric registry。
- `aeval/src/aeval/verdict/trajectory/base.py`：sealed evidence 输入模型与 metric 输出规则。
- `aeval/src/aeval/verdict/trajectory/stats.py`：从 sealed transcript 派生的 `TrajectoryStats`、`StepPoint`、`ToolStat`。
- `aeval/src/aeval/metrics/trajectory_panel.py`：ATIF/canonical transcript 轨迹统计面板。
- `aeval/docs/guides/metric-semantics.md`、`writing-a-suite.md`：aeval metric 声明、判分与报告语义。

当前实现有两种不可混为一谈的“指标”：

1. **verdict metrics**：被 suite/family 声明，由 registry 构造，返回状态与 score，参与评测判分。
2. **trajectory panel/stats fields**：用于描述性展示的计数、时长或趋势字段；它们可能没有阈值、score 或相同的 missing semantics。

将 DSH 的个人分析接入 aeval 通用层，优先复用 `TrajectoryEvidence`、canonical fact/reducer 能力和已有 fact extraction；来源特有事实留在 DSH adapter namespace，不应强行把每个描述性指标改成 verdict score。

## 3. 已有 verdict metrics：可以复用，但需逐项对齐口径

### 3.1 “保留旧 metric ID”具体指什么

旧 ID 兼容不是保留旧实现副本，也不是把不同值伪装成相同值，而是保留 suite 已引用的公开身份与既有数学/判分语义：

1. 将输入统一转换成 normalized facts；
2. 将历史规则收敛为可配置的 compatibility policy；
3. 旧 metric ID 继续调用同一个共享 reducer，但显式传入 legacy policy；
4. 新证据源或新定义使用新的 policy/version，只有语义完全一致后才可复用旧 ID；
5. 在未显式迁移 suite/metric contract 版本前，任何旧 suite 的 `MetricOutcome`（status、score、reason、evidence）都不得因内部重构改变。

概念接口示意（非当前已存在的 aeval API）：

```python
facts = normalize_trajectory(evidence)

legacy_tool_error_rate = reduce_tool_failure_rate(
    facts,
    policy="aeval.tool_error_rate@legacy-v1",
)

dsh_explicit_error_view = reduce_tool_failure_rate(
    facts,
    policy="tool_failure_rate@explicit-v1",
)
```

两个调用复用“分子/分母/coverage 聚合”的 reducer；policy 负责将源事件解释为 facts、规定纳入分母方式和保留既有判分阈值。结果必须携带 `policy/version` 和错误证据来源，避免把 heuristic 与 explicit 证据说成同等确定。

| DSH 候选指标 | aeval 已有项 | 核实结果 | 建议映射 |
|---|---|---|---|
| `tool.failure_rate` | `tool_error_rate` | 已存在相似判分项。aeval 当前用 `looks_like_error(observation_text)` 文本特征识别失败；DSH 可读显式 `tool/result.message.isError`。 | 统一成 `ToolOutcome` fact 和一个可配置/版本化的 failure reducer，结果同时带 `errorEvidenceSource` 与覆盖率。旧 `tool_error_rate@v1` 保持启发式结果；迁移后的共享定义可优先显式证据、必要时兼容启发式，并清楚标注证据级别。不要维护两份计算器。 |
| `tool.repeat_loop` | `loop_detection` | 已存在连续重复检测，默认相同 `call_key` 连续达到 3 次才触发。 | 共用 `call_signature` 和连续 run reducer。若 DSH 指标定义也采用相同连续规则/阈值，旧 `loop_detection` 可成为共享 reducer 的 legacy preset；若检测往返或宽松重复，则在同一重复调用指标族中作为另一视图/选项，不复制基础识别代码。 |
| `tool.error_recovery` | `recovery` | 已存在错误后换不同调用并成功的判分；DSH 事件可明确识别错误后重试同一调用及其结果。 | 共用 error→next-attempt 状态机，输出尝试策略（same-call retry / changed-call）和后续 outcome。旧 `recovery@v1` 保留“必须换策略”的既有判分；统一的描述性恢复指标可报告两种策略，不应把它们折成相同 score。 |
| `tool.repeat_overhead` | `redundant_actions` | 已有重复 `call_key` 比率判分；没有重复调用耗时区间并集或可归因 token。 | 共用 `call_signature`、重复组和事件引用；重复率沿用已有 reducer，时长/Token 是对同一重复组的新增量，不另造一套重复识别算法。无法归属的 token 不分摊。 |
| `model.step_to_first_chunk_ms` | `TrajectoryStats.StepPoint.first_token_ms` / 面板的 first-token 时延 | 已有展示字段，不是当前 standard verdict metric。字段来自 transcript step 的 `extra.first_token_ms`，文档注释来源是 facade 调用账本；DSH 候选从 `step/start` 到首 stream chunk。两端起点可能不同。 | 这是最接近直接复用的项；先统一起点定义与来源标记，再在 aeval 中作为 descriptive metric 字段复用。不能把面板字段的存在说成已有判分 metric。 |
| `context.input_window_utilization` | trajectory panel 的 context occupancy | 面板已支持以 prompt/input token 除以显式或 evidence-carried `context_window` 展示上下文占用；它不是当前 verdict metric。DSH 的 window 绑定也必须逐请求/模型可靠。 | 可共用通用计算表达式；DSH adapter 提供带来源/适用范围的 window facts。比例不可计算时沿用 aeval 的缺失处理原则，不猜测窗口。 |
| `tool.call_elapsed_ms` | `TrajectoryStats.ToolStat.step_seconds`、`tool_time_share` | 有“含该工具调用的 step duration”近似归因，不是 `tool/call` 到配对 `tool/result` 的精确调用 Span。 | 可复用展示结构/聚合器；精确 call span 是 DSH 新证据口径，保留更窄的新字段/metric。不能复用 approximate step duration 作为精确值。 |
| `outcome.turn_reason_mix` | `effective_stop_reason`、transcript turn metadata | 有单次 trial stop reason 的归一化读取，但未发现按 session 汇总 turn end reason 分布的同名判分项。 | 复用 reason normalization helper（若其 reason domain 对齐）；turn 级 reason counts 作为新 descriptive metric。 |

已有 verdict registry 中还包括 `step_efficiency`, `token_efficiency`, `turn_efficiency`, `task_wall_clock`, `budget_adherence`。它们依据 suite-declared budget 输出预算余量/判分，**不等同于** DSH 的 turn/step 数、Token 总量或实际耗时原始统计。两者可以读取相同的 turn/step/token/time facts，但预算 score 仍是独立消费层，不复制底层采集事实。

### 3.2 兼容迁移示例：工具错误与恢复

| 公开指标 | legacy policy 必须保持的行为 | 新共享 facts/reducer 可增加的能力 | 迁移边界 |
|---|---|---|---|
| `tool_error_rate` | 现有 aeval `ToolErrorRate` 用 `looks_like_error(observation_text)` 识别错误；分母是所有 `tool_events`；再用原有 tolerance 生成 `ok`/`degraded` 和 score。无 tool calls 时 `skipped`。 | `ToolOutcome` 可记录 `error=true/false/unknown`、`evidenceSource=explicit/text_heuristic/missing`、配对与 completeness；共享 reducer统一计数和算率。 | 将 ATIF 原有文本识别器封装成 legacy fact policy，调用共享 reducer；DSH `isError` 进入 explicit policy。若新版本统一为 explicit-first 或调整分母，须升级 metric/contract version，不能改变历史 suite 的默认结果。 |
| `loop_detection` | 在事件顺序上用现有 `call_key(function_name + canonical JSON arguments)`；默认连续相同调用达到 3 次才认定 loop，并沿用当前 score/status 规则。 | 共享 `CallSignature` 与 `RepeatedRun` reducer 可产出重复组、长度、边界 refs；描述性面板可展示阈值以下的重复调用而不计为旧判分 loop。 | 先让 DSH 与 ATIF adapter 生成完全相同的 call signature 和顺序；旧 ID 调 reducer 时固定 `max_repeat=3`。若新 UI 想用宽松的相似/往返循环定义，作为另一种检测视图，不能改写 legacy loop 的判分。 |
| `recovery` | 现有逻辑只看文本启发式 error；只判紧邻的下一次工具调用；下一调用需 `call_key` 不同且结果非 error 才是 recovered；尾部无后继的 error 不进 judged 分母。 | 共享 `ErrorAttemptSequence` reducer 可输出后续尝试序列、策略类型（same-call retry / changed-call）、每次结果和可判覆盖度。 | 旧 `recovery` metric ID 调 reducer 的 `changed-call + immediate-successor + heuristic-error` policy；新 DSH 描述性诊断可以报告 same-call retry 后是否有非错误结果。二者共享事实和状态机，但不能直接比较成同一个 recovery score。 |

这里保留的是旧**语义兼容**，不是旧**代码分叉**。落地顺序应是先给现有指标建立 characterization fixtures（固定输入与旧 `MetricOutcome`），抽取通用 facts/reducers 后保证这些 fixtures 原样通过，再接入 DSH explicit facts；新定义需要改变时另行版本迁移。

## 4. aeval 已有面板统计：可复用事实抽取，不代表有同名判分指标

`TrajectoryStats` / 面板当前提供或消费的相关事实包括：

| aeval 当前统计字段 | 与 DSH 清单关系 | 映射建议 |
|---|---|---|
| `total_steps`, `live_turns`, `copied_turns` | 可支持 turn/step 计数和分组；不提供完整 `turn/end.reason.kind` 分布。 | 规范化成计数事实；保留 live/copied 的 aeval/ATIF 来源，不与 DSH `turn/start/end` 边界混为一谈。 |
| `total_prompt_tokens`, `total_completion_tokens`, `total_cached_tokens`, `peak_input_tokens` | 可支持 Token 趋势/峰值与窗口比例的分子；usage 的来源和覆盖度需随值保留。 | 复用 usage aggregate；不要将 peak 输入 token 当作 compaction 回收量。 |
| `StepPoint.first_token_ms` | 与首输出时延相近，已在 §3 说明。 | 对齐起点/采集来源后可共用 reducer。 |
| `ToolStat.calls`, `observed`, `missing_obs`, `retries` | 可支持工具调用数、缺结果数、相邻同参重试统计；`missing_obs` 不是显式 `isError`。 | 区分 `result_missing`、`explicit_error`、`text_heuristic_error` 三类，不压成一个失败值。 |
| `ToolStat.step_seconds`, `avg_seconds`, `longest_seconds`, `tool_time_share` | 基于包含工具调用的 step 时间差；并行工具可能重复分摊同一 step 时长。 | 仅作为 `step_attributed_tool_time` 近似统计；精确 per-call elapsed 使用配对 call/result Span。 |
| context occupancy chart/workspace insight | 按 context window 来源展示 occupancy，能显示输入压力趋势。 | 复用统一 ratio reducer，并携带 window 来源、模型/session 作用域和 usage coverage。 |
| canonical completeness / grader `skipped` reasons | 已有“证据不完整时不判”的机制，但未发现契约里的完整 `trajectory_coverage` 指标 envelope。 | 复用 completeness/skip reason 机制；数据质量维度仍需定义独立输出契约。 |

## 5. 当前没有发现 aeval 对应实现的 DSH 专属候选

在本次核查的 registry、trajectory stats 和 panel 中，未发现以下相同语义实现：

- DSH `compaction/*` 的周期配对、压缩耗时、summary 覆盖规模、prune 识别及调用 Token 效率；
- compaction 频率、compaction time share、压缩周期趋势；
- durable `llm/retry` / `retry-started` 与后续模型结果按 `retryId` 的关联（现有 `recovery` 指工具失败后的工具调用改变，不是模型重试）；
- `request/context` 的 per-model/per-request window 绑定保证；
- Team queued/delivered message lifecycle；
- Team whole-state task/member snapshot、显式 `blockedBy` DAG 与阻塞观察跨度；
- 父子 session lineage 下的成员 busy/idle/unknown 区间、并发峰值、fan-out 与 completion wall span；
- Team 显式依赖链、子 session 创建到首活动跨度；
- 工具错误后相同 call key 后续尝试的 DSH 显式事件证据版本。

这些目前没有可直接复用的 aeval 指标实现。压缩事件、DSH 原始 task/member snapshot 等仍由 DSH adapter 提供；但 team/member/session/task/message、span 和显式 relation 的概念应由 aeval canonical 模型预留，避免插件形成私有的通用对象模型。首发可以先由 DSH extension reducer 消费这些事实；在语义与证据要求经 fixture 验证后，再将适用的 reducer 提升为共享实现。不要为了“通用”把 DSH 字段硬映射成不等价 ATIF 字段。

## 6. ATIF 主体 + DSH 扩展层（已选架构）

这里不要求 aeval 脱离 ATIF。保留两层是必要的：

1. **ATIF 主体层**：继续用 ATIF `Trajectory` 表达跨 Agent 通用的 user/assistant/tool 交互和 steps，供 aeval 现有 grader、报告与面板继续使用。ATIF 字段的含义和验证规则不因 DSH 增加事件而改变。
2. **来源扩展层**：在 canonical transcript 的 adapter-owned namespace 中保存 DSH 原始事件、来源专属事实及版本信息。DSH 专属指标可读取这些来源事实；跨来源共享指标读取 aeval-owned canonical facts。已被 ATIF 覆盖且语义一致的事实优先归一到同一 canonical fact，并通过原始引用溯源，避免重复来源冲突。

这不只是未来设想：aeval 当前 DSH mapper 已经采用该模式。`CanonicalTranscript.to_json_dict()` 把 ATIF `extra` 保留在同一份 canonical ATIF JSON 中，其中 `extra.aeval` 放 aeval envelope，adapter 的 `extra.dsh` 放 DSH namespace；当前 mapper 在 `extra.dsh.events` 保留官方 session events，并以 `extra.dsh_preserved_events` 保存未投影到 ATIF 的事件；ATIF step 的 `extra.dsh.eventSeqs` 提供事件引用。具体实现见 `aeval/src/aeval/contracts.py::CanonicalTranscript`、`aeval/src/aeval/agents/dsh/atif_mapper.py::convert_dsh_read_to_atif` 和 `aeval/src/aeval/agents/dsh/vocabulary.py`。

因此，设计决定是**继续并正式化现有双层模型**，而不是重做 canonical transcript 或发明不兼容的 ATIF 替代格式。当前缺口是：扩展层尚未成为完整稳定的 metric input contract；需要定义 schema/version、各字段 completeness、事件保留/脱敏策略、跨 session 引用和 normalization reducer 的输入面，并用 fixture 锁定行为。

**已确认的保存策略：canonical artifact 同时保存 ATIF 主体、原始 DSH 事件和规范化派生事实。** 原始事件是可审计的来源依据；规范化事实是带 schema/version 与来源 event refs 的可复算中间层；指标从规范化事实计算。这样离线重算不必每次重复解析原始事件，同时可按需从 raw events 重新规范化核验。派生事实不能取代原始证据，也不能脱离来源引用单独作为事实依据。

如果将来 DSH 需要缓存无法映射到共享模型的来源专属派生值，可在 `extra.dsh` 加版本化扩展；当前第一批规范化事实直接进入 `extra.aeval.trajectory`，不额外建立重复的 `extra.dsh.normalized` 副本。具体 sidecar 替代布局仍须与 aeval artifact/sealing 实现对账。

物理存储继续沿用 ATIF `extra` namespaced extension；图中 `extension` 是逻辑概念，不要求改成 canonical JSON 顶层新字段：

```json
{
  "schema": "ATIF trajectory document",
  "steps": [
    {
      "step_id": 1,
      "source": "agent",
      "tool_calls": [],
      "extra": { "dsh": { "eventSeqs": [3, 4] } }
    }
  ],
  "extra": {
    "aeval": {
      "stop_reason": "...",
      "completeness": {},
      "trajectory": {
        "schemaVersion": 1,
        "source": {
          "adapterId": "dsh",
          "adapterVersion": "1",
          "sourceVersion": "0.2.0-rc.2",
          "sourceSchema": "session.v4",
          "normalizationVersion": "1"
        },
        "sessions": [],
        "entities": [],
        "facts": [],
        "spans": [],
        "relations": [],
        "capabilities": {},
        "quality": []
      }
    },
    "dsh": {
      "mapperVersion": "dsh-official-session-persistence@0.2.0-rc.2",
      "dshVersion": "0.2.0-rc.2",
      "sessionSchema": "session.v4",
      "events": [],
      "eventState": "detached",
      "inheritedEventCount": 0,
      "conversionIssues": {}
    },
    "dsh_preserved_events": []
  }
}
```

目标约束：

- `extra.aeval` 由 aeval 核心拥有；其中 `extra.aeval.trajectory`（或等价 sidecar）保存跨来源 canonical facts、spans、relations、capabilities 与 quality。`extra.dsh` 和 `extra.dsh_preserved_events` 由 DSH adapter 拥有，只保存 DSH 原始事件及来源专属映射/扩展；adapter 不覆写其他 vendor namespace。
- 扩展最少带 `schemaVersion`, `dshVersion`, `sessionSchema`, mapper version、session identity/watermark、event references 和 completeness。版本标记不可只靠 package pin 隐式推导。
- `extra.dsh.events` 保存官方 reader 返回的原始事件；`extra.aeval.trajectory`（或 sidecar）保存共享 canonical facts。当前实现不生成重复的 `extra.dsh.normalized`。原始和规范化内容随 canonical artifact 一起参与现有 artifact SHA-256 封存。
- aeval canonical facts 带 schema/version；每条 fact/span/relation 的 source refs 必须能解析到对应 session 的原始 event seq。封存/加载时校验版本、schema、引用存在性和基本不变量；发现不一致时标记证据不完整/不可判，不静默信任派生层。
- 正常离线复算优先读取兼容版本的 aeval canonical facts；需要新规范化规则或审计时，可从同一 artifact 的 DSH `events` 重新生成 canonical facts 并比较。无法读取旧版本时，若原始事件足够则重建；否则返回明确 unavailable。
- 已映射进 ATIF 的 tool/step facts 与原始 DSH event 引用可并存；引用用于溯源和核验，不应让同一工具调用在通用统计中双计。
- 原始事件保留策略和规范化事实传输策略分开定义。Harbor sealed artifact 可按评测审计策略保留 DSH events；普通用户实时 projection 只发白名单摘要/引用，不能因 canonical artifact 保留原始事件就把正文发到 UI。
- 有缺失或未映射事件时，通过 `completeness`/conversion issue 和共同 metric envelope 表达；不能悄悄从 ATIF 投影缺字段推断为 DSH 事件不存在。

## 7. 统一 facts/reducer 的落地方式

```text
DSH events ─> DSH adapter ──┐
                            ├─> normalized shared facts ─> shared reducers ─┬─> aeval legacy metric IDs/presets
ATIF evidence ─> ATIF adapter┘                                             ├─> new generic metrics
                                                                          └─> descriptive snapshots
DSH-only facts (compaction / source snapshots) ─> DSH extension reducers ────> DSH-specific metrics
DSH Team events ─> canonical team facts ─> shared or DSH-first reducers ──────> team metrics
```

### A. aeval 通用层

- 继续维护现有 sealed transcript、`TrajectoryEvidence`、verdict metric registry、`MetricOutcome` 和报告聚合；新增一个共享 normalized fact/reducer 层作为 ATIF 与 DSH 的共同入口。
- ATIF adapter 将现有 `TrajectoryEvidence` 转为规范化 facts，保留 legacy 缺失/错误启发式来源；DSH adapter 从结构化事件生成同一事实类型，提供更精确的来源与覆盖信息。
- 让 `step_efficiency`、`tool_error_rate`、`loop_detection` 等现有 ID 委托给共享 reducer 的 legacy policy。改变旧 ID 的分母/阈值/证据规则必须升 metric version 或显式迁移，禁止影响既有 suite。
- 描述性个人分析和 verdict scoring 共用 facts/核心 reducer，但使用不同输出 envelope；不要求每个 dashboard 数值都变成 `MetricOutcome`。

能力声明与样本完整度要分开：适配器按事件/字段声明 `supported_complete`、`supported_partial`、`unsupported` 或 `unknown`；单个样本再用 coverage/quality 标明实际缺失。unsupported/unknown 不等于测得 0，partial 不能伪装成完整结果。DeepAgents 若暂时没有 compaction/team 证据，应返回 unsupported，而不是推断为没有压缩或没有协作。

### B. DSH adapter / extension

- 读取 DSH 官方事件，以 event ref (`sessionId + seq`) 保留来源。
- 将 DSH 字段转换成 aeval-owned canonical facts；对 compaction 等尚无跨来源通用语义的事件，以及 DSH 原始快照细节，保留在 DSH namespace 和 source version 中。Team/member/task/message 先映射到预留的通用概念；具体 DSH 事件形状仍由 DSH namespace 管理。
- 对真正 DSH-only metrics 提供实时 TS fold 与离线 Python reducer，按同一 fixture 对齐；aeval 的 sealed-evidence loader/runner 从 aeval-owned canonical facts 执行共享 reducer。若 DSH-only reducer 需要来源专属字段，则通过受版本约束的 DSH extension input 读取，并在结果中保留来源引用。
- 用户界面可以呈现 DSH 专属指标；aeval 通用 scorer 可忽略未知 DSH extension facts，但不得将 unknown 伪装成零。

### C. Golden / fixture 归属

跨后端共同 schema 和 golden fixtures 由 aeval 维护；DSH 原始事件样本可以由 DSH adapter 开发贡献，但经 aeval 接受后进入其 fixture 源。插件仓库只锁定 aeval revision/manifest hash 并验证 adapter 输出，不维护第二份期望值。该规则详见 [`trajectory-normalization-fixture-contract.md`](trajectory-normalization-fixture-contract.md)。

## 8. 首批垂直切片建议

先挑能检验“共享 facts/reducer + legacy 兼容策略”的小集合，而不是建立平行指标库：

1. **工具事实垂直切片**：实现一个 `ToolCall/ToolOutcome/CallSignature` 规范化模型；让旧 `tool_error_rate`、`loop_detection`、`recovery` 通过 legacy policy 调共享 reducer，同时在 DSH explicit error facts 上输出新的描述性 error/retry breakdown；
2. **工具耗时**：新增精确 DSH call/result Span，并把 aeval step-attributed duration 显式标记为 estimate；共用 duration summary reducer，但保留 measurement basis；
3. **首输出时延**：复用候选统计，统一 DSH stream 与 aeval `first_token_ms` 起点后使用同一 duration reducer；
4. **压缩**：添加 shared `ContextOperation` 基础事实/周期 reducer；DSH adapter 映射压缩生命周期与回收规模。先作为新能力，不重复实现通用计数/耗时算法；
5. 相同样本包含闭合 session 与事件前缀，结果对齐包含 `available`/`incomplete`/`unavailable`、证据类型/覆盖与引用，而不只比较数字。

Team 概念模型（team/member/session/task/message、显式依赖 relation、span 与证据引用）应在首批 canonical schema 中预留；不要求首批就实现完整跨 session Team 指标。DSH 是首个验证来源：先映射 lineage、成员状态、消息阶段和显式依赖，再在 DSH fixtures 上验证 busy/idle、并发与关键路径 reducer。对于有相同 canonical 输入语义的 reducer，可在底座共享；DSH 专属生命周期事实仍由 DSH adapter 提供。DeepAgents 等来源缺少相应证据时保持 unsupported，不推断为零。

## 9. 尚待冻结的映射决定

1. 将 `extra.aeval.trajectory`（或 aeval-owned sidecar）和 DSH 来源扩展分别正式化：定 canonical schema/version、capability/completeness 字段、event refs 与兼容策略；物理布局仍待与 aeval artifact/sealing 实现对账。原始事件 + 派生事实双层保留，以及共享 canonical facts 归 aeval 命名空间/sidecar，已确认。
2. `tool_error_rate` 是否支持多个明确的 error source，及旧 ATIF 文本启发式的兼容策略；
3. `recovery` 与 `tool.error_recovery` 的语义是否合并，还是维持两个不同 ID；
4. DSH 实时面板的描述性结果是否进入 aeval 的 `MetricOutcome`，还是使用单独的 observation/snapshot schema；
5. DSH-only 离线 metric extension 的装载协议、版本绑定和 sealed evidence 输入接口。

本盘点最初的源码检查不包含 Canonical Trajectory v1 的后续实现；当前已增加 envelope 与 DSH fact normalization，但尚未修改现有指标定义或计算行为。下一步优先完成权威 vocabulary/fixture 和共享 reducer，再逐个把现有 metric ID 接到共享实现；只有新观测能力才新增定义。历史 suite 必须由 characterization fixtures 保护，不因 reducer 重构改变结果。
