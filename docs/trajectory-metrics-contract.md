# DSH 轨迹指标与分类契约 v1.1

> 用途：记录 `dsh-eval-control` 实时分析与 aeval 离线复算共用的分类、关系和指标语义。跨后端语义的权威维护方是 aeval；本文是插件侧设计/接入副本，若有差异以锁定的 aeval 契约版本为准。
> 原始字段映射见 [`trajectory-field-metric-span-map.md`](trajectory-field-metric-span-map.md)。
> TS/Python 共用的规范化模型、fixture 与逐字段对齐规则见 [`trajectory-normalization-fixture-contract.md`](trajectory-normalization-fixture-contract.md)。
> 本文是插件侧指标语义副本，不把样本中观察到的字段形状外推为所有 DSH 版本的保证。跨后端契约以 aeval 正式版本为准；v1.1 在基础运行指标上增加个人会话诊断指标，带代理/启发式性质的指标必须保留相应证据等级与限制。
> Team 指标 ID、状态规则和公式以 aeval 的 `TRAJECTORY-METRIC-CATALOG-v1.md` 为准。下表中的 Team 指标使用 `coordination.*` canonical ID；UI 标签不得作为第二套指标 ID。

## 1. 分类

每个事件和指标都带一个执行域。域描述“发生在哪类执行活动”，不表示成功、失败或根因。

| 域 | 范围 | DSH 事件族示例 |
| --- | --- | --- |
| `context` | 上下文请求、注入、压缩、修剪 | `request/context`、`user/message.source.kind`、`compaction/*` |
| `model` | 模型调用、流式输出、用量、重试 | `step/*`、`assistant/message`、`llm/retry*` |
| `tool` | 工具调用、结果、错误、耗时 | `tool/call`、`tool/result` |
| `planning_state` | todo、goal、工作区状态、交付物 | `todo/write`、`goal/change`、`workspace/changes`、`deliverables/presented` |
| `coordination` | agent 血缘、Team 成员、消息、任务 | `team/*`、`subagent/*`、`agent/inbox/spliced` |
| `human_control` | 用户插话、审批、人工等待 | 用户来源消息、`approval/*` |
| `outcome` | turn/session 终止与可验证结果 | `turn/end`、外部任务结果 |
| `data_quality` | 缺失、未知类型、配对或时钟异常 | 分析器派生的质量记录 |

失败或异常可使用独立的诊断类别；不得把执行域当作失败分类。

## 2. 证据等级与结论边界

| 等级 | 规则 | 例子 |
| --- | --- | --- |
| `observed` | 原始事件直接记录 | `turn/end.reason.kind`、`tool/result.message.isError` |
| `derived` | 由冻结的确定性公式计算，保留输入事件引用 | callId 配对后的事件跨度、压缩事件计数 |
| `inferred` | 规则或时间重叠给出的可反驳解释 | 工具 Span 与 inbox 事件间隔重叠 |
| `unavailable` | 需要的数据不存在或不能可靠恢复 | provider 实际发送时刻、检索召回率 |

`inferred` 只用于提示待检查的关联，不得显示成已确认根因。`unavailable` 显示为未知/不支持，不得按 0 进入分母。异常信号、失败结果和根因归属是三个不同对象。

## 3. 关系类型

关系记录为 `(fromRef, relation, toRef, evidenceRefs, evidenceLevel)`。仅使用以下语义：

| 关系 | 含义 | 规则 |
| --- | --- | --- |
| `precedes` | A 的事件时间早于 B | 不隐含因果 |
| `invokes` / `returns` | 工具调用与结果关联 | 按 `callId` 配对；替换重发去重 |
| `derives_from` | surface 事件声明其来源事件 | 使用 `sourceEventSeqs`；不替代 `callId` 配对 |
| `replaces` | 新 surface 节点替换旧区间 | 使用 `surfaceOp`，校验 `sourceEventSeqs` 与被替换节点 |
| `delegates_to` | 父会话声明/记录子会话 | 由父子 session lineage 字段支持；深度字段本身不足以建立此边 |
| `delivers` | Team 消息 queued 到 delivered | 按消息 ID 配对 |
| `overlaps` | 两个时间区间相交 | 只表示时间重叠，不表示 `blocks` 或 `causes` |
| `blocked_by` | 明确的任务依赖/阻塞关系 | 必须有显式依赖字段或 runtime 证据；不能从 overlap 推断 |

本版本不定义由轨迹统计直接生成的 `causes` 边。根因归因必须作为单独、可审阅的诊断结果，并引用支撑证据及不确定性。

## 4. Span 和规范化记录

Span 的最小字段：

```text
spanId, sessionId, domain, kind, key,
startEventRef, endEventRef, startTimeMs, endTimeMs,
parentSpanRef?, linkedSpanRefs[], evidenceLevel, sourceDshVersion
```

单点事件可作为 instant，不伪造持续时间。跨会话 Span 必须包含父子 lineage 引用。无法闭合的 Span 保留 `open`/`incomplete` 状态，不补造结束时间。

每项指标的定义必须同时给出：稳定 ID、执行域、输入事件、公式、分子/分母、去重与替换规则、粒度、缺失处理、证据等级和来源版本。实时 TS 与离线 Python 读取同一组规范化 fixture 与期望值。

## 5. 基础指标口径

| 指标 ID | 域 | 中文名 | 个人用户价值 | 定义 | 分母/去重/限制 | 等级 |
| --- | --- | --- | --- | --- | --- | --- |
| `compaction.summary_cycles` | `context` | 摘要压缩次数 | 了解会话中压缩发生了几次，以及是否存在尚未结束的压缩。 | 按 `compactionId` 统计有 start 的摘要周期；分别报闭合、开放周期 | start-summary-end 配对；未闭合周期单列 | `derived` |
| `compaction.elapsed_ms` | `context` | 摘要压缩耗时 | 判断上下文压缩本身占用了多少时间。 | `end.time - start.time` | 仅闭合周期；负值/缺端点视为不可用 | `derived` |
| `compaction.shadowed_tokens` | `context` | 被摘要覆盖的历史 Token 数 | 了解压缩处理了多少历史上下文。 | 汇总摘要事件的 `shadowedTokenCount` | 只对去重后的 `compactionId` 求和 | `observed`/`derived` |
| `compaction.prune_passes` | `context` | 历史修剪批次 | 区分摘要压缩与历史修剪，了解会话状态清理的频度。 | 按相邻 prune 事件形成 prune 批次 | 与摘要周期分开报，禁止相加 | `derived` |
| `compaction.reclaimed_tokens_per_call_token` | `context` | 压缩调用 Token 效率 | 粗略比较压缩调用开销与其覆盖的历史规模；不是压缩率。 | `shadowedTokenCount / usage.totalTokens` | 仅在两值均有效且总调用 token > 0 时计算；称“调用 token 效率”，不是压缩比 | `derived` |
| `model.step_to_first_chunk_ms` | `model` | 模型首个输出块等待时间 | 观察每步从启动到开始收到输出的代理时延，帮助发现响应变慢。 | step start 到首个 stream chunk | 不称 TTFT；缺 provider-send 时间时只报告该代理跨度 | `derived` |
| `model.stream_span_ms` | `model` | 模型流式输出跨度 | 了解模型持续输出的时间，不将它误当成纯生成耗时。 | stream 首事件到末事件 | 不称纯解码耗时 | `derived` |
| `tool.call_elapsed_ms` | `tool` | 工具调用耗时 | 找出本次会话中耗时较长的工具调用并定位事件。 | tool/call 到其结果事件的跨度 | 按 `callId` 配对；surface 替换结果不重复计调用 | `derived` |
| `tool.failure_rate` | `tool` | 工具显式失败率 | 快速了解工具结果中明确标记为失败的比例。 | 显式失败结果数 / 有结果的唯一调用数 | 未配对调用另报；启发式文本错误另设指标 | `derived` |
| `tool.repeat_loop` | `tool` | 工具重复调用信号 | 发现相似工具调用反复出现，帮助用户检查是否陷入重复尝试。 | 冻结 call-key 规则识别的连续/往返重复 | 显示匹配事件与规则；不得自动宣称无效或导致失败 | `derived` |
| `coordination.inbox_insert_to_message_event_ms` | `coordination` | 协作消息事件间隔 | 查看协作或用户消息从进入 inbox 到对应消息事件出现的间隔；不代表模型读取时间。 | inbox 插入到同 ID user/message 事件的跨度 | 不等同于模型读取时延；按消息来源分层 | `derived` |
| `coordination.inbox_tool_overlap_share` | `coordination` | 消息等待期间的工具调用重叠比例 | 查看消息进入 inbox 到对应消息事件出现期间，有多少时间与工具调用同时发生，以便定位相关事件；时间重叠不代表工具导致等待。 | 工具 Span 并集覆盖上述跨度的比例 | 同一时段重叠工具先取区间并集；仅为 overlap 信号 | `inferred` |
| `coordination.team_delivery_ms` | `coordination` | Team 消息投递耗时 | 观察 Team 消息从排队到投递的耗时，发现投递链路上的延迟。 | queued 到 delivered 的跨度 | 按消息 ID 配对；缺一端单列 | `derived` |
| `coordination.delegation_depth` | `coordination` | 委派层级 | 快速了解当前会话记录的委派层级；不能单独还原完整团队结构。 | session header 中记录的层级值 | 不单独判定 fork/fresh 或重建团队树 | `observed` |
| `outcome.turn_reason_mix` | `outcome` | 轮次结束原因分布 | 了解轮次以完成、中断、受阻或错误等何种原因结束。 | 按 `turn/end.reason.kind` 汇总轮次结局 | 未闭合 turn 单列 | `observed`/`derived` |

## 6. 个人会话诊断指标

本节把基础事件统计组合成用户可采取行动的诊断。UI 应优先呈现“发现 + 影响范围 + 可核查证据”，不将诊断分数包装成客观根因。实时视图和 aeval 离线报告共用相同公式、配对规则与版本门禁。

| 指标 ID | 域 | 中文名 | 个人用户价值 | 定义与公式 | 分母/去重/缺失处理 | 等级与展示边界 |
| --- | --- | --- | --- | --- | --- | --- |
| `context.input_window_utilization` | `context` | 上下文窗口输入占用比例 | 观察输入 Token 相对已知窗口的变化趋势，提前发现上下文压力增大的会话。 | 每个带有效 usage 的模型输出：`input_tokens / contextWindow`；呈现逐步趋势和峰值 | `contextWindow` 必须与该事件所属 provider/model/会话上下文匹配；缺少或不确定时 unavailable。不得把单个 `request/context` 值无条件外推到整个会话 | `derived`；称“观测输入占窗口比例”，不得称压缩触发阈值或精确剩余上下文 |
| `context.compaction_frequency_per_1k_input_tokens` | `context` | 每千输入 Token 的摘要压缩频率 | 按会话输入规模比较压缩出现频度，避免只看原始次数。 | `1000 × 闭合 compaction summary 周期数 / 有效模型 input_tokens 总和`；另报相邻摘要压缩周期的间隔 | 分子只按唯一 `compactionId` 计摘要周期；prune 独立，不并入；分母为同一会话、同一纳入范围内有效输入 token | `derived`；小分母或 usage 覆盖不完整时不算比率，只显示次数和覆盖率 |
| `model.step_to_first_chunk_ms` | `model` | 步骤开始到首个输出块等待时间 | 观察每步从启动到模型第一次产生 token-bearing 输出的代理时延，便于发现响应变慢。 | `step/start` 到 assistant message/attempt 内首个 token-bearing stream 成员的时间 | 一个 step 只取最早的首 token；空流不算 0，已结束且无 token 时为 incomplete；token-bearing 遵循锁定 DSH stream reader，包括非空文本/推理/工具参数片段或有名称的工具调用片段 | `derived`；不称 provider TTFT 或首个可见文字；canonical 只保存首 token 时间和源事件引用，不保存 stream 内容 |
| `context.compaction_time_share` | `context` | 摘要压缩时间占比 | 了解压缩时间占会话观测时长的比例，判断它是否值得进一步排查。 | `compaction Span 与 session Span 的区间并集覆盖时长 / session Span 时长` | 区间并集避免重叠压缩重复累计；只纳入闭合 Span，session 时长须大于零 | `derived`；是会话时间占比，不表示压缩造成其余等待 |
| `model.retry_recovery` | `model` | 模型请求重试与后续响应 | 查看模型请求是否重试、重试后是否出现后续响应，以及等待跨度。 | 按 `retryId` 统计重试次数及之后是否出现配对的 assistant/message 结果；显示重试至结果的墙钟跨度 | 关联限于同 session、turn、step；缺结果标记 incomplete，不判失败；结果事件不等价于任务成功 | `derived`；称“请求重试后有/无后续结果”，不称任务恢复成功 |
| `tool.error_recovery` | `tool` | 工具错误后的后续尝试 | 查看显式工具错误后是否出现相似调用及非错误结果，辅助判断问题是否缓解。 | 对每次唯一 `tool/call` 错误结果，观察同一 turn 内后续相同规范化 `call_key` 调用是否有非错误结果；计重试次数和错误至后续结果跨度 | `call_key` 规范化算法及版本固定并记录；显式错误仅据 `message.isError`；参数不可比或结果缺失归 unknown；移除 surface 替换重发副本 | 错误事实为 `observed`，重复关联为 `inferred`；“后续调用返回非错误结果”不证明业务任务成功 |
| `tool.repeat_overhead` | `tool` | 重复工具调用耗时与开销 | 量化重复调用占用的时间及可明确归属的 Token，辅助检查重复尝试的影响。 | 对满足冻结重复规则的调用组，统计重复调用数、其 `toolCallElapsedMs` 区间并集时长及可唯一归属的模型 token | 同一 call 不重复计数；并行工具区间取并集；无法唯一归属的模型 token 不分摊 | 调用与时间为 `derived`，规则识别为 `inferred`；显示匹配调用和规则，不直接称“浪费” |
| `model.long_gap_segments` | `model` | 长时间事件间隔片段 | 把长空档及其重叠的已知操作列出来，帮助用户从事件证据定位待检查区间。 | 相邻可排序事件或 step 边界间超过版本化展示阈值的 gap；报告已知 compaction、tool、approval、retry Span 与 gap 的交集，其余列为未归属时长 | 阈值是展示配置，不是原始事实；交集取区间并集；未覆盖部分标记 `unattributed` | gap 为 `derived`，候选解释为 `inferred`；不得把无事件称为 agent 停滞或卡死 |
| `planning.todo_snapshot_change` | `planning_state` | 计划快照变化 | 了解待办新增、移除、改写和状态流转，掌握计划如何演变。 | 相邻 `todo/write.todos` 快照的新增、移除、内容变化、状态变化数；并汇总 goal revision | 按事件顺序比较；无稳定 todo ID 时按版本化规范化内容匹配；缺字段不按空列表处理 | `derived`；称“计划变化”，不据此判定返工或低效 |
| `planning.rewrite_after_completion` | `planning_state` | 完成阶段后的计划改写信号 | 识别计划完成后是否出现整体更新，帮助区分阶段切换与值得复查的变化。 | 上一快照全部条目 completed 后，下一快照出现整体替换/新建时计一次；未完成快照后的类似变化另计 | 按相邻快照及冻结的内容匹配算法；空快照、无法匹配或状态缺失列为 unknown | `inferred`；展示前后差异，不能仅凭重写认定计划推翻 |
| `coordination.task_blocked_duration` | `coordination` | Team 任务阻塞观测时长 | 查看有显式依赖的任务从观察到受阻到再次推进的跨度。 | 对 `blockedBy` 非空的 task，计算首次观察 blocked 到首次观察其进入 `in_progress`/`completed` 的跨度 | 以 `(teamId, taskId)` 配对；只表示观测边界跨度，不拆成各依赖的独立耗时；缺少解除快照为 open | `derived`；不得把多个依赖的时长相加 |
| `coordination.active_members_now` | `coordination` | 当前忙碌成员数 | 了解此刻有多少不同 Team 成员正在执行 turn。 | 在观察时点统计至少有一个打开 turn 的成员 | 一个成员多 session 仍计 1；成员—session 关联不完整时为 partial | `derived`；不是生产力判断 |
| `coordination.peak_concurrent_members` | `coordination` | 峰值并发成员数 | 了解观察窗口内 Team 同时忙碌的峰值规模。 | 基于每个成员 busy 区间并集计算最大重叠成员数 | 半开区间 `[start,end)`；同一时间先处理结束再处理开始；窗口或 turn 边界不完整时 partial/incomplete | `derived`；按成员计数，不按 session 数 |
| `coordination.member_busy_ms` | `coordination` | 成员忙碌时长 | 查看各成员实际处于打开 turn 的累计时间。 | 对每个成员的闭合 turn/work 区间求并集后求和 | 多 session 区间先按成员取并集；未闭合区间单列，不算入闭合时长 | `derived`；不跨成员相加为团队墙钟时长 |
| `coordination.member_idle_ms` | `coordination` | 成员可确认空闲时长 | 区分确实存活但没有打开 turn 的时段与缺失数据。 | 对明确存活/可用且没有打开 turn/活动工作的区间求并集 | 离线必须在封存证据中有存活区间；没有则 unavailable；settled 不算 idle | `derived`；不代表浪费时间 |
| `coordination.fan_out_width` | `coordination` | Team 成员数 | 了解根 Team 显式关联了多少不同成员。 | 统计观察窗口内显式关联到根 Team 的成员数 | 不是并发数；不可访问或缺少成员关联时 partial | `observed`/`derived` |
| `coordination.team_completion_wall_ms` | `coordination` | Team 端到端完成跨度 | 观察根 Team 从首次明确派发/任务启动到所有关联成员或任务终止的跨度。 | 最早明确派发（如 `childCreatedAt`）或根任务 `in_progress` 至最晚明确 settled/terminal 边界 | 任一相关成员无终止证据、后代集不完整或时间异常时 incomplete/unavailable | `derived`；不是依赖关键链 |
| `coordination.branch_first_activity_ms` | `coordination` | 子会话创建至首事件间隔 | 观察委派子会话创建后多久出现首个事件，帮助检查分支启动过程。 | `subagent/catalog.childCreatedAt` 到对应子会话首个有效事件的跨度 | 必须有可靠 `childId` ↔ session lineage；缺关联或时钟异常时 unavailable | `derived`；称“子会话创建到首事件间隔”，不称成员空闲或启动故障 |
| `coordination.team_path_critical_segments` | `coordination` | Team 显式依赖关键链 | 沿明确的任务依赖查看最长观测链及相关节点，帮助识别协作流程中的等待环节。 | 沿显式 task `blockedBy` 边构建依赖图；节点耗时取可观测 task 状态跨度，报告最长依赖链及其节点 | 只用同一 team 的已配对快照与显式依赖；循环、缺失状态时间或不完整图标记 incomplete；不得用消息重叠补边 | `derived`；称“已观测依赖关键链”，不代表完整 agent runtime 关键路径 |

Team 状态统一按如下优先级：打开 turn 为 `busy`；没有打开 turn 且会话在该窗口明确存活/可用时为 `idle`；显式终止/settled 为 `settled`；显式 blocked 运行态或任务关系支持时才为 `blocked`；关联、存活或边界缺失/冲突时为 `unknown`。runtime status 与 turn 推导冲突时保留双方证据并将冲突区间置为 `unknown`。`team/member.phase` 的单次快照不作为状态流。详细边界见 aeval 权威指标目录。
| `outcome.turn_completion_evidence` | `outcome` | 轮次结束与交付证据 | 同时查看轮次结束原因、关联交付物和证据覆盖，避免把“轮次完成”误认为“任务成功”。 | 汇总 turn 终止原因，并将 `deliverables/presented` 通过显式 `callId` 关联到来源；显示证据覆盖 | `completed`、产物数和显式错误分开报告；没有外部验收/任务判定时任务成功率 unavailable | 原事件为 `observed`、关联为 `derived`；turn completed 或有产物不等于任务成功 |
| `data_quality.trajectory_coverage` | `data_quality` | 轨迹证据覆盖度 | 了解当前分析有多少缺失、未配对或版本不支持的数据，判断结论是否完整。 | 报告未知事件、未配对 call/result、未闭合 Span、无效时间、缺字段和版本不支持项 | 分母分别注明适用事件数；无效/缺失证据不当作零或成功 | `derived`；作为诊断覆盖提示，不参与用户表现评分 |

### 6.1 诊断呈现规则

- 每条诊断包含指标 ID、会话/turn 粒度、值或状态、样本数、证据等级、来源事件引用、公式版本和 DSH 版本。
- `inferred` 诊断可展开查看触发规则、匹配事件及其他可能解释；不得用确定的失败状态替代不确定性。
- 实时尚未闭合的周期以 `open`/`incomplete` 呈现；会话结束后可更新最终值，但不改写历史证据。
- 分位数和归一化比率附样本量、分母覆盖率及时间窗口。
- 成本金额、检索质量、模型是否实际读取某条消息、成员空闲时长等当前事件无法直接支持的结论保持 `unavailable`，不以代理量伪装成实测值。

除明确规定外，分布统计需同时显示样本量。小样本分位数不可当稳定基线；报告中注明样本数和分位数算法。不能比较的 token 或时间口径不得拼成“效率分”。

## 7. 版本、未知字段与隐私

- 每条结果记录 DSH 版本、事件 schema/词汇表版本和指标契约版本。
- 未知事件保留为 `unknownEventTypes`/兼容性信号，不把未知类型硬塞进既有类别；是否忽略遵从目标 DSH reader 契约。
- 保留原始事件引用供审计；UI 默认显示聚合与短字段。消息正文、参数、路径等内容按最小必要原则展示，跨会话读取遵守 parent-session 授权边界。
- 事件字段缺失、版本不支持、Span 未闭合、配对不唯一时，输出明确状态和原因，不静默回退为零或猜测。

## 8. 插件侧实现契约（协议 v3，冻结引擎拆分）

本节记录 `dsh-eval-control` 0.2.6 起 TS 引擎与 aeval 离线 reducer 的冻结拆分；语义权威仍归 aeval `TRaJECTORY-METRIC-CATALOG-v1`（见 `src/aeval/trajectory_metrics.py`）。

### 8.1 引擎拆分

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 每会话折叠 | `src/analytics/metrics.ts` 的 `foldLifecycleMetrics` / `MetricFoldState` | 逐事件增量折叠本会话全部 30 个会话级指标 + 根会话专属 Team 事实（fan_out、member_idle、task_blocked、team_delivery、critical segments）。每个事件后从状态整体重算（recompute-from-state），保证任意前缀自一致 |
| 跨会话引擎 | `src/analytics/team.ts` 的 `foldTeamMetrics` / `combineFoldStates` | 输入根 + 子会话的 `TeamSessionInput`，计算 member_busy、active_members_now、peak_concurrent_members、team_completion_wall、branch_first_activity，以及根会话 coverage 的树级质量码覆盖（`member_session_not_observed` / `child_session_not_observed`） |
| 封口 | `sealMetricFoldState(state, sealed)` | 会话完成标志只影响完成敏感指标的 status（`partial`→`incomplete`/`available`），不改历史证据；实时折叠永不封口 |
| 线视图 | `src/analytics/projection.ts` | wire view 携带 `metricResults`（每折叠状态上限 64 条，LRU 逐出）与 `teamInput`（跨会话引擎的有界输入） |

### 8.2 对等测试协议

`test/analytics_parity.test.ts` 逐 fixture：根/子会话分别折叠 → 按 fixture `complete` 封口 → `combineFoldStates` 组合 → 与 aeval 金标（`test/fixtures/trajectory_contract/v1/expected/*.metrics.json`，manifest 锁 sha256 与 `aevalRevision`）全字段深比较（status/value/unit/sampleCount/denominator/evidenceLevel/evidenceRefs/qualityRefs）。另测任意事件前缀的增量折叠 == 同前缀重放。fixture 由 `scripts/sync-trajectory-fixtures.mjs` 从 aeval 同步。

已知且已记录的非对称（fixture 未覆盖，文档化为可接受差异）：跨会话 callId/digest 在 byId/byDigest 索引中的碰撞；实时 repeat_overhead 按会话内 digest 分组而 aeval 全树分组；wire 路径 `teamInput` 有界截断（turnIntervals 256、refs 64、children 32、taskSnapshots 128、memberSnapshots 64、qualityItems 64）。对等路径（fold states）不受截断影响。

### 8.3 客户端聚合

`client/client.js` 的轨迹分析视图在根会话 `teamInput.memberIds` 非空时，经 `ctx.sessions.using(memberId, {source: 'dsh-eval-control-analytics'})` 读取各成员会话的 `trajectoryAnalytics` 线视图（5s 打开超时，失败降级），并在浏览器内镜像 `foldTeamMetrics` 的活跃/并发/忙碌/墙钟/分支首活动计算。该聚合是展示层近似（wire 截断），不得用于评测判分；页面文案已声明与离线精确值的差异。
