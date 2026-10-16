# 计划：dsh-eval-control 扩展为「面向普通用户的实时轨迹分析」

> 状态：**口径与形态已拍板（§0），待开工 M0**。本文件只描述计划，不含实现。
> 所有事实性论断都带锚点：`文件:行`，或本机真实会话日志的实测数字。
> 两份独立侦察（DSH 宿主/客户端 API 面、aeval 指标管线）的结论已并入，并标注了推翻/更正之处。

---

## 0. 已拍板的三个决策

| | 决策 | 影响 |
| --- | --- | --- |
| **Q1** | **B**：加宿主侧跨会话聚合器，显示成员实时忙闲与关键路径 | Layer 1 从「单会话投影」升级为「投影 + 跨会话聚合器」（§5.1） |
| **Q2** | **A**：TS 与 Python 双实现 + conformance fixture 逐字段对齐 | M0 必须先冻结期望值（§6） |
| **Q3** | **A**：对话视图环新增一个分析标签页 | 走 `conversation.view`（与官方 Trajectory 并列），不是 chip（§5.2） |

### 待定决策

| | 问题 | 选项 |
| --- | --- | --- |
| **D1** | **跨会话证据怎么取**（客户端只保留打开的那个会话，成员子会话与 `team/*` 的证据它手里没有） | **(a)** 宿主聚合器在 wire view 里带少量必要载荷；**(b)** 证据链对跨会话项只给句柄 + 让用户跳到那个会话。见 §2.5 |
| **D2** | **目标 DSH 版本** | 0.1.7-rc.1（本机实际在跑）／0.2.0-rc.2（插件 devDeps 与 aeval 现在 pin 的）／两版都进 conformance 矩阵。见 §7 R1 |

---

## 1. 目标：一个包，两条产品线

| | 产品线 A（已有，语义不动） | 产品线 B（新增，本计划重点） |
| --- | --- | --- |
| 用户 | aeval 评测 runner | 普通 DSH 用户 |
| 前提 | 有 control config + broker 重定向模型调用 | **零配置**，装了就有 |
| 时态 | 试次结束后密封 bundle | **会话进行中实时** |
| 现有落点 | `src/index.ts`、`src/sandbox_entry.ts`、`cordis.patch.yml` | 无（本次新建） |

新增指标族：**① 上下文压缩频率 ② 工具循环调用 ③ Agent Team 协作分叉 ④ 重试与等待 ⑤ 状态与计划重写（待确认）**。

第 ④ 族来自一份外部方法论的对照（Agent 延迟治理 / 分布式追踪），见 §8；它暴露了前三族的一个真实缺口：
**失败重试的退避等待完全不在前三族的视野里，却能实打实吃掉用户几十秒**（实测见 §3.4）。

⚠️ **「压缩频率」问的只是一半。** 实测一次会话 8 次压缩 = **9.0 分钟的用户可见停顿**（§2.5）。
用户感知的不是「压缩了 8 次」，而是「卡了 9 分钟」。所以 ① 族必须同时报**频率**与**代价**（`compactionStallMs`）。

**更根本的是 §2.5 的三层数据模型**（原始事件 → 执行单元 → 关系与证据）：各族指标都只是那个骨架上的具名查询。
指标必须能被质问「这个数字从哪来」，而不是只给一个无法解释的汇总。

### 验收标准

1. 普通 profile（无 `AEVAL_CONTROL_CONFIG`、无 broker）装完插件，对话视图环出现分析标签页，数字随会话推进实时增长。
2. **不依赖 aeval 安装**（普通用户没有 aeval）。
3. A 线零回归：现有 **203 个测试**（已实测 `npm test` 全绿）保持通过；`standalone` 语义不变。
4. 三族指标在「实时（TS）」与「aeval 离线（Python）」两条实现上，对同一份冻结会话日志**逐字段相等**。
5. 投影 state 有界、可序列化、`apply` 同步且对无关事件返回同一引用（官方 seam 硬要求，见 §5.1）。
6. **不新增会话事件类型**：日志读路径会拒绝词汇表外的类型（除非带 `ignorable: true`），我们的派生状态一律走投影 key。
7. **每个信号都能被质问**：面板上任一数字都可展开成 §2.5 的 L3 关系链，每条关系带来源事件与 `strength`；
   推断型关系必须显示 confidence。**不允许只留一个无法解释的汇总数字。**

---

## 2. 架构结论：挂官方 live seam，不 tail JSONL

| 方案 | 判据 | 结论 |
| --- | --- | --- |
| ① tail `~/.dsh/sessions/**/session.v4.jsonl.zstd` | 默认 `compression: 'zstd'`（`dsh-base/cordis.patch.yml:130-133` → `dsh-session-persistence-jsonl`，默认值在 `lib/index.js:2285/2373`），是 Zstandard 帧不是可读行；且实测全仓库**没有任何** tail/fs.watch 跟随会话目录的实现 | ✗ |
| ② 进程外分析进程 | 与 ① 同问题，还多一个进程 | ✗ |
| ③ **官方 live seam** | 已存在、有 first-party 范例、且是 GUI 数据的既有通道 | ✓ |

三条 seam：

- **投影注册表**：`ctx.sessionProjections.register(def)`，`def = { key, stateSchema, stateVersion, init(header, inheritedEventCount), apply(state, event), wire:{viewSchema, view} }`。
  `apply` 在已提交事件上同步折叠，引用不变即零下游工作；`snapshot(session)` / `onChanged(listener)` / `stateOf` / `checkpoint`。
  范例：`@deepseek-ai/dsh-session-stats/lib/index.js:186-196`（`inject=['sessionProjections']`，198 行的完整实现）。
- **客户端视图环**：`ctx.uiConversation.views.register(...)` 或 `ctx.slots.inject('conversation.view', () => ctx.slots.register({...}))`。
  官方 Trajectory 就是在这里注册的（`dsh-client-ui-trajectory/lib/client.js:8683`，`order: 10`）。
  数据由宿主投影**推送**到浏览器：`dsh-api-session-controller/lib/index.js:1042-1048` → 落到 `projectionsBySession[id].values[key]`，组件里 `useProjection(key)` 或 `useSessions(...)` 读取。**全程无轮询。**
- **实时事件总线**：`ctx.sessions` 服务（`SessionStore`，`dsh-session/lib/index.js:1467/1492`）；`session/event (session, event)` 在 `append` 时**同步**触发（`:1351-1358`），另有 `session/created` / `session/disposed` / `session/flush`（awaited）。

**关键发现（更正我自己先前的判断）**：本插件**已经在用这条总线**了 —— `src/index.ts:218` `session/created`、`:279` `session/event`、`:293` `session/disposed`，且都已经带 `{ global: true }`。
但那三个回调是**控制域限定的**（`:280` 第一时间 `if (!ownsControl() || changed !== session ...) return`），只为 A 线 descriptor 追踪 turn 边界，**不能复用为 B 线的观测 tap**。B 线需要自己那条常开通道（§5.1），但可以照抄同一套惯用法与 `dsh-session-telemetry` 的 HMR 游标纪律。

> ⚠️ **必须避免的重复建设**：DSH 已自带 `@deepseek-ai/dsh-client-ui-trajectory`，它已经把 compaction 记录渲染进 Trajectory 标签页并跟随尾部。
> 我们做的是**聚合指标**，不是第二个日志查看器；分析标签页应能跳转过去定位。

---

## 2.5 三层数据模型（骨架）

四族指标（§4）是**这个骨架上的具名查询**，不是并列的功能。三层是：

| 层 | 内容 | 关键要求 |
| --- | --- | --- |
| **L1 原始事件** | 模型请求、工具调用与结果、压缩、团队消息、任务变化、子会话创建 | **保留稳定引用**（`sessionId + seq`），用户能回查；不复制载荷 |
| **L2 执行单元** | turn、step、模型调用、工具执行、压缩周期、team member、子会话 | 边界规则必须冻结（见下「粒度陷阱」） |
| **L3 关系与证据** | 「工具结果发生在某次调用之后」「这次压缩覆盖了哪些历史事件」等 | **每条关系要说明依据来自哪个事件**，不允许只剩一个无法解释的汇总数字 |

### 这不是新发明：两边的既有纪律都指向它

- **DSH 原生就有溯源边**：`sourceEventSeqs` 的语义是「earlier events **this one derives from**」（`dsh-session/lib/types/index.js:539-544`），配 `surfaceOp:{op:'replace',startSeq,endSeq}`。
- **aeval 已经是证据优先设计**：`EvidenceBundle` = 「Sealed, verified evidence for one trial — **the only grader input**」；`MetricOutcome` 带 `reasons[]`/`evidence[]`（`contracts.py:638-662`）；`FieldCompleteness`/`CompletenessRecord`（`:176-194`）逐字段可信度，`CompletenessStatus = ok/partial/unavailable`（`:111`）。

⇒ 本计划就是把 aeval 已有的证据纪律**搬到 live 路径**，并因此天然服务 Q2=A（同一口径）。

### L3 的关系必须分三档强度（**因果 ≠ 时序**）

DSH **不记录因果边**——没有任何事件表达「因为 A 所以 B」。所以：

| 强度 | 含义 | 实例（已核实） |
| --- | --- | --- |
| `reference`（硬证据） | 事件自带显式 id / seq | `tool/result.message.source.callId ↔ tool/call.callId`；`compaction/summary.shadowedSeqs`（实测 **167 条**，显式列举）+ `shadowedRange{start,end}`；`surfaceOp{startSeq,endSeq}` + `sourceEventSeqs`；`subagent/catalog.childId` ↔ 子 header `parentSession`；`team/message.queued.{senderId,targetId} → delivered.messageId`；`tool-workflow/agent-start.childId` |
| `temporal`（软证据） | **只说明先后，不说明因果** | 「消息先于派发出现，且 `targetId` 指向同一 member id」——只能说这个，**不能说「触发」** |
| `inferred`（启发式） | 判定规则本身是启发式，必须带 confidence | **整条工具循环族**：`call_key` 是参数归一化、`looks_like_error` 是正则文本匹配（`aeval/.../metrics.py:65,83-108`） |

关系 schema：`(sourceRef, relationKind, targetRef, strength, confidence)`，`strength ∈ {reference, temporal, inferred}`，`sourceRef/targetRef = (sessionId, seq, type)`。

### 投影有界 vs 证据保留：用 seq 句柄解

`sessionProjections.checkpoint(session)` 会逐单元持久化 state；把关系链全塞进去会让 checkpoint 爆。**解法：投影只存 seq 句柄，不存载荷。**
wire view 保持小（计数 + 每信号一个有界的 seq 引用环）；客户端用句柄去它**已经持有的会话窗口**解析事件。
（客户端确实持有：`SessionEventStream` 发布 `snapshot`/`entry`/`prepend`/`append`；host 侧 `session.eventAt(seq)`。）

两个必须一并处理的例外：

1. **跨会话证据**：客户端只保留**打开的那个会话**，成员子会话与 `team/*` 的证据它手里没有（Q1=B 的直接后果）。
   决策点：**(a)** 宿主聚合器在 wire view 里带少量必要载荷；**(b)** 证据链对跨会话项只给句柄 + 让用户跳到那个会话。**待定。**
2. **surface vs log**：压缩替换后当前 surface 隐藏被替换节点，日志仍保留（`session.surface` vs `eventAt(seq)`）。
   证据链必须标注「surface 上已被替换，日志仍可回查」，否则用户点进去看到的是另一份内容。

### 六个通用字段 → 实际来源

| 字段 | 来源 |
| --- | --- |
| 范围 `scope` | `sessionId`；跨会话时是 `header.parentSession` / `delegationDepth` 构成的子树路径 |
| 时间 `time` | 事件 `time`（epoch ms）；区间用 `step/start→step/end`、`compaction start→end` |
| 参与者 `participants` | `team/member.member.id`、`tool/call.name`、`request/context.provider+model`、`assistant/attempt` 的 provider |
| 关联事件 `related` | L3 三种关系，一律 `(sessionId, seq, type)` |
| 数据来源 `provenance` | `sessionId + seq`；派生量带 `{key, stateVersion, mapperVersion}`（aeval 已有 `mapper_version` 先例） |
| 推断与可信度 `inferred` / `confidence` | **复用既有枚举，不新造词**：`CompletenessStatus = ok/partial/unavailable` |

### L2 的「粒度陷阱」（必须在 M0 冻结）

`turn`/`step` 是 DSH 原生的；但把「模型调用 / 工具执行 / 压缩周期 / team member / 子会话」归成统一执行单元是**我们的派生**。
实测例：`llm/retry` 在同一 step 内有 5 次尝试 —— 「模型调用」单元取 `assistant/attempt` 粒度还是 step 粒度，
**直接决定重试指标是 1 还是 5**。这类边界不冻结，TS/Python 双实现必漂。

### Span 拆分能力矩阵（§8 文章列了 8 类子 Span，DSH 支持其中 5 类）

文章的根 Span 是「一次端到端任务」，子 Span 是网关鉴权 / 调度排队 / 上下文构建 / 检索 / 模型调用 / 工具调用 / 状态存储 / 结果整理。
逐条对 DSH 判定：

| 文章的 Span | 能否拆 | 依据 |
| --- | --- | --- |
| **根 Span**（整个 Agent 请求） | ✅ | `turn/start` → `turn/end`（带 `reason.kind`）；跨多 turn 的任务用 session 为根 |
| **工具调用** | ✅ | `tool/call` → `tool/result` 按 `callId`；**必须先按 surface 去重**（§3.2）；实测 19 个 step 存在区间重叠 |
| **压缩周期** | ✅ | `compaction/start` → `compaction/end`（`.error?`），summary 自带 usage 与影子范围 |
| **模型调用** | ✅ **可拆为 TTFT + decode** | `assistant/message` **100% 自带 `stream`**（实测 1450/1450），逐 chunk 带 `time`，所以 **TTFT / decode 对每一步都可算**：`step/start→首delta chunk`、`首chunk→assistant/message`。**实测 TTFT 中位 2534ms、max 67384ms**（n=1450）——`sessionStats` 已在算这两个值，直接复用。<br>⚠️ 但**更细的「单次尝试」粒度只有失败轮有独立事件**：`assistant/attempt` 仅在 `finish.kind==='error'\|'aborted'` 时 append（`dsh-agent-loop/lib/index.js:1101`），实测 553 step 只有 11 个、`usage` 全 0，与 `llm/retry` 1:1 |
| **上下文构建** | ✅ **可拆，无需钩子** | `[turn/start → step/start(1)]` 或 `[step/end(N) → step/start(N+1)]`。**实测中位 30–40ms**，纯会话日志即可算（见下） |
| **压缩停顿** | ✅ **可拆且可归因** | 压缩挂在 `agent/pre-step`，其耗时全额落进上面的组装间隙。**实测 8 次归因 100%，合计 541.7 秒 = 9.0 分钟**（见下） |
| **调度排队** | 🟡 **仅信箱侧** | 团队 `team/message/queued → delivered` 按 `message.id ↔ messageId` 可拆（**实测中位仅 120ms，非瓶颈**，§3.3）；<br>**提供方排队融合进 TTFT，分离不出来**（见下「TTFT 里到底有什么」） |
| **结果整理** | 🟡 **可测，但可忽略** | 边界存在：`assistant/message.stream` 的**末 chunk 带 `time`**，故 `[末chunk → assistant/message]` 可算。**实测中位 1ms、max 15ms**（n=1450）⇒ 指标价值接近零，列出来只为口径完整，**不要**在面板上占位置 |
| **检索** | ❌ **不是层，而是工具** | **DSH 里根本不存在独立的记忆/知识检索层**（见下）。所有检索都以 `tool/call` 出现：fs-search、web-search、mcp-resource、skill。唯一带独立事件的是 `web/deepseek-search-llm-request` |
| **网关鉴权** | ❌ 无事件 | 会话日志里没有；A 线 broker 有 lease 记录，但普通用户路径没有 |
| **① Agent 状态**（todo / goal / 产物 / 工作区） | ✅ **完全可见** | `todo/write` 是**全量快照**、`goal/change` 带 `revision`、`deliverables/presented` 带路径、`workspace/changes`。⚠️ **不是「记忆」**——DSH 没有记忆层（§2.5 下节），它是**计划外化**，见「命名」一段 |
| **③ 宿主持久化**（session JSONL / 投影 checkpoint / `dsh-storage` / `dsh-session-query` / spill） | ❌ **读结构性不可得，写部分可得** | 写侧有 `session-log-deepseek/delivery-accepted`、`image/offload`、`session/end-seed`；读侧无事件——**load/resume 发生在第一条例事件之前**，日志里根本没有它（官方 59 类里无任何 `session/load|resume`） |

#### 上下文组装：**可以拆，而且不需要宿主钩子**（此前判定 ❌ 已更正）

源码顺序（`dsh-agent-loop/lib/index.js`）说明关键事实：

```js
const decision = await this.preStep(target, {turn, step});  // ← 内部 systemPrompt.assemble() + agent/pre-step 瀑布
...
this.session.append("step/start", {turn, step});            // ← 组装【完成之后】才落盘
const stepEnd = await this.step(decision);                  // ← 模型调用在这里
```

⇒ 组装**不在** `step/start → 首 chunk` 窗口里，而在 `step/start` **之前**。所以区间就是：

| 区间 | 含义 |
| --- | --- |
| `[turn/start → step/start(1)]` | 首步：上下文组装 + pre-step 瀑布（含压缩）+ inbox claim |
| `[step/end(N) → step/start(N+1)]` | 后续步：同上 |

**实测（`session-16e5940f`，纯会话日志即可算，无需任何钩子）**：

```
首步   [turn/start → step/start(1)]        n=35    min=28  中位=40  P90=54   max=103 ms
后续步 [step/end(N) → step/start(N+1)]     n=1415  min=11  中位=30  P90=37   max=118737 ms
```

⇒ **正常组装是几十毫秒**（中位 30–40ms），是个干净的指标。
⇒ **max 118.7 秒，且 8 个极值全部是压缩落点** —— 见下。

#### ⭐ 这个区间同时给出了压缩的**用户可见代价**（新发现）

压缩挂在 `agent/pre-step` 瀑布上，而 `step/start` 在该瀑布之后才落盘。所以压缩的耗时**全额记进这个间隙**。
实测 8 次摘要压缩，**归因 100%**：

| cycle | `[step/end → step/start]` 间隙 | `compaction/start → end` | 占比 |
| --- | --- | --- | --- |
| 1 | 50,630 ms | 50,583 ms | 100% |
| 2 | 41,992 ms | 41,946 ms | 100% |
| 3 | 44,180 ms | 44,131 ms | 100% |
| 4 | 71,044 ms | 70,988 ms | 100% |
| 5 | 67,641 ms | 67,582 ms | 100% |
| 6 | 74,084 ms | 74,030 ms | 100% |
| 7 | 118,737 ms | 118,681 ms | 100% |
| 8 | 73,417 ms | 73,372 ms | 100% |
| | **合计 541.7 秒** | | |

⇒ **一次会话里 8 次压缩 = 9.0 分钟的用户可见停顿**（且该会话 `llm/retry=0`，与重试无关）。

这是压缩族的**质变**：用户感知的不是「压缩了 8 次」，而是「卡了 9 分钟」。
所以压缩族必须同时报**频率**和**代价** —— 这是本项目最初只问「频率」时漏掉的一半。

#### TTFT 里到底有什么（组装**不在**其中；提供方排队分离不出来）

`sessionStats.ttftMs` = `step/start` → **首个非空 delta chunk**，首 token 取自 `assistant/message.stream`
（`dsh-session-stats/lib/types/projection.js`：`firstToken = open.firstTokenTime ?? assistantStreamFirstTokenTime(event.data.stream)`）。
实测 `assistant/message` **100% 带 stream**（1450/1450），所以**每一步都有 TTFT**。窗口内依次是：

```
step/start
  ├─ 1. 请求构建（header/tools 已在上一步组装好）
  ├─ 2. HTTP 发出 + 网络往返
  ├─ 3. 提供方排队 ← 请求在对方调度器里等 GPU 槽位
  ├─ 4. prompt prefill（处理全部输入 token）
  └─ 5. 首个 delta chunk 到达  ← 唯一的下一个可观测点
```

**3 与 4 之间没有任何事件**，所以拿不到「排队 800ms、prefill 300ms」的拆分，只能得合计值。
要真分离，需要提供方给服务端计时或上报队列深度——DSH 的会话事件里没有。
⇒ 报 TTFT 合计并**注明「含排队与 prefill，不可分」**；若做对照推断，**必须标 `inferred`**。
（注意：**上下文组装不在此窗口内**，它已在上面的间隙里单独可测。）

**实测 TTFT 规模**（`session-16e5940f`）：`n=1450, 中位=2534ms, max=67384ms`；同会话 decode（首chunk→message）示例 `1323ms`。
⇒ TTFT 中位数是**秒级**，是模型调用的主要构成——这个量级值得进面板。

#### 精度限制（必须写进 M0 契约）

`time` 是事件 **append 时的 host 墙钟**，事件可能成簇落盘。所以：

- 压缩间隙（40–119 秒）远高于噪声，**可靠**；
- 组装间隙中位 30–40ms **接近落盘抖动与时钟粒度**，只能作**近似值**报告，不能当精确耗时；
- 结论：`assemblyGapMs` 标 `inferred` + 标注精度；`compactionStallMs` 可靠。

#### 三条纪律

1. **✅ 的才进指标；🟡 的必须标 `inferred`**（§2.5 强度分档）；**❌ 的明确列为「不可观测」**，不造字段。
   文章那 8 类是在**自己完全掌控的服务**上拆的；DSH 的边界止于插件能看到的 seam。
2. **Span = L2 执行单元，边界 = L1 的 seq 引用**。统一为
   `spanRef = (sessionId, kind, key, startSeq, endSeq)`，`key ∈ {stepKey, callId, compactionId, retryId, memberId, childId}`。
   因为配对靠的是**显式 id**，父子边与配对边都是 `strength: reference`（不是推断）——**Span 与 L3 关系是同一套东西，不是两套**。
3. **状态字段必须显式且定源**：`step/end` **不带状态**（实测 payload 只有 `{turn, step}`），所以步的成败要从
   `turn/end.reason.kind`（`completed`/`aborted`/`blocked`/`error`/`max-tokens`/`interrupted`/`forked`）或 attempt 的 finish 推导；
   工具成败以 `message.isError` 为准、`error` 只补详情（§3.2 双源陷阱）。

⇒ 账目（文章 8 类子 Span，**3 + 2 + 3 = 8**）：

| 判定 | 数量 | 具体 |
| --- | --- | --- |
| ✅ 真可拆 | **3** | 工具调用、上下文构建、模型调用（TTFT + decode） |
| 🟡 受限 | **2** | **调度排队**（只剩信箱侧；提供方排队与 prefill 融合进 TTFT）<br>**结果整理**（可测但中位 **1ms**，无指标价值） |
| ❌ 不可观测 | **3** | **网关鉴权**、**检索**（作为独立层）、**状态存储** |

再加两格（不在文章 8 类里）：**根 Span** ✅（`turn/start→turn/end`）、
**压缩停顿** ✅（DSH 原生，落在上下文构建间隙里，**实测 9.0 分钟，是单项最大**）。

⇒ 唯一「只有失败轮可拆」的是**模型调用的「单次尝试」粒度**（`assistant/attempt`）；模型调用**整体**是可拆的。
把不可观测的写在面板上，比给它们编一个数字更符合这个仓库的既有纪律。

#### ⭐ 等待与排队全清单（**9 个场景，不是 2 个**）

原先只列了「Team 调度」和「等模型服务端」两项。逐包核对源码后，DSH 一次执行里的等待至少有 9 处，
且**可观测性差异很大**——这是面板必须如实分层的原因：

**A. 等资源（严格意义的调度排队）**

| # | 场景 | 机制 / 证据 | 可观测性 |
| --- | --- | --- | --- |
| 1 | **提供方排队** | 请求在模型服务端等 GPU 槽位 | ❌ 融合进 TTFT，不可分 |
| 2 | **Team 信箱** | `team/message/queued → delivered` 按 `message.id ↔ messageId` | ✅ 实测中位 **120ms** |
| 3 | **Workflow/PTC 子 agent 槽位** | `dsh-workflow-ptc` 有**显式 FIFO 队列**：`acquireSlot()` / `slotWaiters`；默认 `maxConcurrentAgents = min(16, availableParallelism()−2)`（配置 0 表示自动）；`maxTotalAgents` 默认 1000 | 🟡 **队列等待不可直接测**：`tool-workflow/agent-start` 在 `await acquireSlot()` **之后**才 emit，只能从 `agent-start` 的时间散布/并发数间接推断，标 `inferred` |
| 4 | **工具并发槽位** | `dsh-agent-loop` 的 `runGroup` 槽位池：`inFlight.size < maxParallelToolCalls`，**默认 10**（`lib/index.js:1493`） | ❌ 等待发生在 `[tool/call, tool/result]` **内部**，对用户不可见 |

**B. 等依赖**

| # | 场景 | 机制 | 可观测性 |
| --- | --- | --- | --- |
| 5 | **Team 任务依赖** | `team/task.blockedBy`，量级分钟 | 🟡 状态可见，等待时长需跨会话推 |

**C. 等人**（⭐ 新发现，此前完全没考虑）

| # | 场景 | 机制 | 可观测性 |
| --- | --- | --- | --- |
| 6 | **审批等待** | `approval/asked{id,toolName,callId?,reason?} → approval/decided{id,outcome}`，按 `id` 配对。**实测真实存在**（`session-e8063251`，`approval/policy={"policy":"ask"}`）：<br>· 一次 **63,191 ms**（人当场点了）<br>· 一次 **30,360,365 ms ≈ 8.4 小时**（人不在） | ✅ **可精确测量** |
| 7 | **等用户输入** | `turn/end.reason.kind === 'blocked'` + turn 之间的用户思考时间 | ✅ 边界清楚 |

**D. 串行阻塞（不是排队，但同样是「卡住」）**

| # | 场景 | 实测 |
| --- | --- | --- |
| 8 | **压缩** | ⭐ **9.0 分钟**（单会话 8 次），单项最大 |
| 9 | **重试退避** | **32.5 秒**（10 次 `TRANSPORT`，撞 `maxRetries=5`） |

**E. 仅 API 层可见（不落会话日志）**

| # | 场景 | 证据 |
| --- | --- | --- |
| 10 | **会话写锁争用 / 用户消息转向队列** | `dsh-api-session-controller` 的类型里有 `session/writer-held`、`session/agent-busy`、`session/conflict`、`session/queue-item-not-found`、`session/steer-unavailable`——都是 **API 错误码**，不是会话事件 |

#### ⚠️ 「等人」必须与「等资源」分开统计

实测那次 **8.4 小时**的审批等待说明了一个硬约束：**把人类响应时间混进延迟统计，会用一个午休毁掉所有分位数。**

- `approvalWaitMs` / `blockedWaitMs` 单列为 **`humanWaitMs`**，**排除**在 agent 侧延迟与分位数之外（或至少单独着色）；
- 只有 `provideQueueInTtft`（不可分）、`teamMailboxWaitMs`、`workflowSlotWaitMs`、`toolSlotWaitMs` 才算 **`resourceWaitMs`**。

#### 记忆与知识检索：**DSH 里不存在这一层**（不是「被隐藏」）

三条实证：

1. **包层面：0 个。** 本机 checkout 的 200+ 个 `@deepseek-ai/dsh-*` 包里，名字含
   `memory` / `knowledge` / `rag` / `retriev` / `embed` / `vector` / `recall` / `index` 的**一个都没有**。
2. **事件层面：1 个。** 官方 59 个事件类型里，含检索类关键词的只有 `web/deepseek-search-llm-request`。
   没有 `skill/*`、没有 `mcp/*`、没有 `memory/*`、没有 `retrieve/*`。
3. **三个最像「记忆/知识检索」的候选，全部是工具而非检索层**：

| 候选 | README 原文 | 结论 |
| --- | --- | --- |
| `dsh-skill` / `dsh-tool-skill` | 「模型访问需搭配 `dsh-tool-skill`」 | skill 通过**工具**访问；目录是**上下文段注入**，不是检索事件 |
| `dsh-mcp-resources` | 「自动提供**三个共享工具**…资源文本进入对话历史」 | 也是工具 |
| `dsh-session-query` | 「让**应用代码**可以…当**应用代码**需要以编程方式访问」 | 给应用代码的 API，**不在模型轨迹里** |

**可见性分档**：

| 部分 | 可见性 |
| --- | --- |
| 检索**动作**（搜索词 / 路径 / MCP 服务器名） | ✅ `tool/call` 的 `name` + `arguments` |
| 检索**结果文本** | ✅ `tool/result.message.content`（长度可算，是「返回了多少」的粗代理） |
| 检索**内部**（命中数、排序、相似度、rerank、chunk 切分、召回率） | ❌ **工具只返回最终文本，无任何中间量** |
| **skill 目录 → 模型的选择** | ❌ 目录注入为上下文段，只能从 `request/header` 变更间接看出；**为什么选它没有事件** |
| 网络检索 | 🟡 **唯一例外**：`web/deepseek-search-llm-request` |

⇒ **处理方式不是「补一个检索指标族」**，而是：

1. **工具族加语义分类**：按 `tool/call.name` 把 fs-search（grep/glob）、web-search、mcp-resource、skill
   标注为「检索类工具」，至少能回答「这次会话有多少步花在找东西上」；
2. **明确声明检索内部不可观测**，不造字段（与 §5.2「未知要显式化」同一纪律）；
3. **检索质量只能用外部对照**（aeval 侧任务成功/答案质量），不能用轨迹指标。
   这也解释了文章那套「检索 Span」为何不可移植：**在文章场景里检索是自家组件，在 DSH 里是别人的黑盒。**

#### ⭐ 状态：三块，可见性**正好相反**（此前把整行判 ❌ 是错的）

「状态存储与读取」不是一个东西，是三块：

| 块 | 是什么 | 可见性 |
| --- | --- | --- |
| **① 模型可见的 agent 状态** | todo 列表、goal、产物、工作区变更、plan/permission/sandbox 模式 | ✅ **完全可见**——全部是事件，且都是**全量快照** |
| **② 状态被读回上下文（注入）** | 上述状态被渲染进 prompt | 🟡 状态可见，但**「注入了哪一版」无事件**。可用 seq 顺序推断：`todo/write(seq)` → 下一次 `request/header(seq)` 之间用哪版，标 `inferred` |
| **③ 宿主自己的持久化层** | session JSONL、投影 checkpoint cache、`dsh-storage*`、`dsh-session-query*`、`dsh-spill*` | ❌ **读不可得，写部分可得** |

**③ 的结构性原因**（不是实现偷懒）：**写 = 产生持久状态 = 有事件；读 = 发生在会话存在之前或宿主内部 = 无事件。**
会话 load/resume 在第一条例事件**之前**就完成了；投影 checkpoint 恢复、storage 读、`session-query` 全文搜索都在宿主/插件内部，不产生会话事件。

**API 层可见、日志不可见的争用信号**（`dsh-api-session-controller` 的类型里有）：
`session/writer-held`、`session/agent-busy`、`session/conflict`、`session/queue-item-not-found`、`session/steer-unavailable`。
⇒ 说明存在**会话写锁争用**与**用户消息转向队列**这两个等待场景，但它们是 **API 错误码，不落会话日志**。
这条补进 §2.5 的等待清单，标为「仅 API 层可见」。

##### ① 逐事件展开（全机实测计数 + 精确键集合）

全机 60 个会话扫描得到的次数与**唯一键集合**：

| 事件 | 次数 | 载荷键 | 关键点 |
| --- | --- | --- | --- |
| `workspace/changes` | 182 | `{turn}` **仅此一键** | ⚠️ **只说「这一 turn 改了工作区」，不说改了哪些文件**。弱信号：能回答「多少 turn 真的动了文件」，**不能当文件变更日志**；文件级细节只能去 `tool/call` 的写类工具参数 |
| `deliverables/presented` | 114 | `{turn, callId, files[{path, description}]}` | ⭐ **`callId` 把产物与产生它的工具调用用显式 id 连起来** → L3 里是 `reference` 强度，不是推断。「这次交付了什么」的最直接证据 |
| `todo/write` | 111 | `{todos}` **仅此一键** | 全量快照；**无 `turn`/`step`**，须按 seq/time 对齐。`TodoItem = {content, status:'pending'\|'in_progress'\|'completed'}`——**无 id、无优先级、无时间**，所以 churn 只能按 `content` 匹配 |
| `system/message` | 80 | `{turn, step, message}` | **基础系统提示全文**（实测 9626 / 9630 字符），只在 turn 的 `step=1` 出现 ⇒ **提示全文可 diff**。⚠️ 但**不含动态状态**（见下） |
| `sandbox/mode` | 64 | `{mode}` 27× / `{mode, source}` 37× | 取值 `workspace-write` / `danger-full-access`；⭐ **`source:'delegation'` 是子会话继承父沙箱模式的证据** → 又一条 `reference` 血统边 |
| `permission/preset` | 34 | `{preset}` | 权限档位状态（实测含 `danger-full-access`） |
| `model/selection` | 27 | `{provider, model}` 23× / `+reasoningEffort` 4× | 模型切换轨迹：能回答「中途换过模型吗」 |
| `goal/change` | 20 | `{kind, version, operation, goal{id, revision, objective, phase, maxGoalRounds}, roundsStarted, createdAt, updatedAt}` | 有 `revision`/`phase`/`roundsStarted` ⇒ 目标进度可算；**无 `turn`** |
| `agent-preset/selected`·`plan/mode`·`schedule/change`·`hook/invoked`·`developer/message` | **0** | 词汇表成员，本机未使用 | `developer/message = {turn, step, message, headerSeq?}` ⭐ **`headerSeq` 是唯一显式的「注入 ↔ 请求头」溯源边** |

##### `todo/write` 的实测价值：计划重写量（原称 churn）

> **术语**：本文此前用的 `churn`（搅动、反复改写）是从工程分析借的词，对中文 UI 不友好，
> 正式指标名改用 **`planRewrite*` / 计划重写量**。

实测 `session-16e5940f` 10 次写入：

```
 #  seq   条数  completed  新增  删除  整份重写  上一份计划状态
 1    31    7      0        0    0
 2   108    7      3        0    0            推进
 3   262    7      6        0    0            推进
 4   273    7      7        0    0            推进 → 全部完成
 5   357    9      0        9    7     是      ✅ 重写发生在【完成后】→ 正常分段
 6   781    9      4        9    9     是      ⚠️ 重写发生在【未完成时 0/9】→ 计划被推翻
 7  1413   10      7        1    0            推进
 8  1662   10     10        0    0            推进 → 全部完成
 9  2671    7      0        7   10     是      ✅ 重写发生在【完成后】→ 正常分段
10  2972    7      6        0    0            推进
```

**⚠️ 关键结论：重写量高 ≠ 有问题。** 3 次整份重写里，**2 次是上一份计划全部完成之后才开的下一段**
（正常任务分段），只有 **1 次是在未完成时推翻**（真正的「计划不稳定」）。

⇒ 所以**不能只报重写量**，必须带进度归因：

| 字段 | 定义 | 判别力 |
| --- | --- | --- |
| `planRewrites` | 相邻快照整份替换的次数 | 实测 3/10——**单独看会误判** |
| **`planRewritesAfterComplete`** | 重写时上一份**已全部完成** | 实测 2 → **正常分段，不是问题** |
| **`planRewritesMidPlan`** ⭐ | 重写时上一份**尚未完成** | 实测 1 → **这才是「计划不稳定」的真信号** |
| `planChurn` | Σ(新增+删除) | 实测 26+26 = 52；同样需按上面两项归因才有意义 |

⇒ 这是**比「重复调用同一工具」更高一层的循环信号**，但前提是**用「完成后 / 未完成」把它切开**，
否则会把「任务分三段做」误报成「反复无常」。

**⭐ 模型到底怎么看到 todos —— 一条可交叉校验的 `reference` 关系**：
`todo_write` 的**工具结果只有汇总**（实测 87 字符：`"Updated todo list: 6 pending, 1 in progress, 0 completed."`），
所以模型看到的**不是** `tool/result`，而是**它自己那次 `tool/call` 的 `arguments`**（含全量列表，留在对话历史里）。
⇒ `todo/write.todos` 与 `tool/call(todo_write).arguments` 是**同一份状态的两个副本**，
可互为校验——这正是 L3 要的「有依据的关系」，而非一个孤零零的数字。

##### 命名：`todo/write` 是「计划写入」，**不是「记忆」也不是「计划生成」**

我先前称它为「agent 的任务记忆」——**错，而且与本文件自己的结论矛盾**（DSH 没有记忆层，包 0 个、事件仅 1 个）。
叫「记忆」会让人以为存在一个可读回的 memory store，那正是本文件论证过不存在的东西。

但「计划生成」**也不准确**。实测这 10 次写入实际在干什么：

| 类型 | 次数 |
| --- | --- |
| **纯状态更新**（条目内容完全不变，只改 `status`） | **5** |
| 整份重写 / 生成 | 3 |
| 首次建立 | 1 |
| 小幅追加 | 1 |

⇒ 真正属于「生成」的只有 **3/10**；**7/10 是状态流转**（把一条 `pending` 改成 `completed`）。
用「生成」描述这个事件会漏掉它的主要用途。

**DSH 自己的命名就是答案**：它叫 `todo/**write**`，不叫 `todo/plan` 或 `todo/generate`；
且载荷**只有 `{todos}`，没有 `operation` 字段**——create 还是 update **根本不在事件里**，只能靠相邻快照差集推。

**准确定位**：它记录的不是「记住什么」，而是**模型把计划外化成一份可观测的全量快照**。
核心价值是**让「意图」可观测**：

> `tool/call` 记录模型**做了什么**；`todo/write` 记录它**打算做什么**。
> **意图与行为的落差才是真信号**——写了 7 条待办，实际只动了 2 条。

⇒ 正式命名：族名 **「计划与状态」**；事件保持 DSH 原名 `todo/write`（不改事件名）；
分析字段用 `planWrites`（计数）/ `planSnapshot`（单次快照）。
**本文件不再使用「记忆」指称任何 DSH 状态。**

##### ② 注入：**再修正一次**（`system/message` 只给基础提示）

我先前说「注入无事件」**不完全对**，但也不能反过来说「注入可见」：

- ✅ **基础系统提示可见**：`system/message` 带**全文**，可逐次 diff（实测 9626 → 9630 → 9626，中途确实变过）；
- ❌ **动态状态（todo / goal）的注入仍无独立事件**：我验证了那三份 system 提示**都不含** goal objective、
  也不含 `todo` / `in_progress` 字样。todos 是靠**模型自己的工具调用参数**留在历史里的（见上）；
- 🟡 `developer/message.headerSeq` 是**唯一显式的**注入↔header 溯源边，但本机 0 次使用。

⇒ 结论：**「状态写入」全可见；「状态注入」只有基础提示可见，动态部分仍属推断。**

既然 `request/header` 是**纪元头记录**（`{config, tools}` + `reason`，本会话 17 次，远少于 step 数），
它不该当 Span 边界，但能支撑另一个指标：
**上下文头部漂移** —— 每次 config/tools 变化及其 `reason`（实测取值 `initial` / `series`）。
与压缩族互补：压缩改**历史**，它记**头部**。

##### ⚠️ 反例留档：`request/header` 里没有状态注入

我一度以为 `request/header` 出现 17 次 todo 字样是「状态被注入上下文」的载体。查下去是**假阳性**：
那些 `in_progress` 全在**工具定义的 schema** 里——
`.tools[25].parameters.properties.todos.items.properties.status.enum[1]`，以及工具描述文本。

⇒ `request/header` 载荷 = `{config, tools}`，是**纪元头**（模型配置 + 工具定义集），**不是注入的上下文**。
⇒ **todo 状态确实没有任何注入事件**：模型只能通过**自己历史里的 `tool/call.arguments`** 看到它（工具结果只有 87 字符的汇总）。

#### ⚠️ 版本差异实证（R1 / D2 的直接证据）

同一台机器上两个会话的**事件词汇表不同**：

| | `session-63322f41` | `session-16e5940f` |
| --- | --- | --- |
| 日志内事件类型总数 | **34** | **27** |
| `assistant/attempt` | 11 | **0** |
| `llm/retry` | 10 | **0** |
| `request/header` | 14 | 17 |

⇒ 计划里的每一条「实测」都带版本前提。**D2（目标 DSH 版本）不定，M0 的期望值 JSON 就没有效力。**

---

## 3. 数据源事实核对（真实会话日志实测）

事件词汇表是官方 59 成员集合，aeval 侧已冻结（`aeval/src/aeval/agents/dsh/atif_mapper.py:55-70`）。
`LOG_ONLY_EVENT_TYPES = OFFICIAL_EVENT_TYPES - MAPPED_EVENT_TYPES`（`:79`）恰好包含全部 `compaction/*`、`team/*`、`subagent/*`、`tool-workflow/*`。

### 3.1 压缩：**两个不同机制 + 一份远比我预期完整的载荷**

| 机制 | 事件 | 载荷（实测） | 谁发 |
| --- | --- | --- | --- |
| 摘要压缩（cycle） | `compaction/start` | `{compactionId, turn, sourceCommandId?}` | 压缩后端 |
| | `compaction/summary` | 见下方全字段 | 压缩后端 |
| | `compaction/end` | `{compactionId, turn}` | 压缩后端 |
| 工具结果修剪（prune） | `compaction/prune` | `{shadowedRange, shadowedSeqs, shadowedTokenCount}` | `dsh-compaction-tool-result-pruner/lib/index.js:159` |

**实测 `compaction/summary` 的完整 data 字段**（`session-16e5940f-…`，第一次 dump 被我自己截断到 900 字符，重查后如下）：

```
keys = compactionId, summary, shadowedRange, shadowedSeqs, shadowedTokenCount,
       provider, model, maxTokens, usage, rawOutput, llmStreamCall
shadowedRange      = {start: 8, end: 460}
shadowedSeqs       = 167 个
shadowedTokenCount = 127035
provider/model     = x00995545 / glm-5.3
usage              = {inputTokens: 383, outputTokens: 3467, totalTokens: 158666, cacheReadTokens: 154816}
```

**这一条推翻了我先前两个判断，必须更正**：

1. ~~「普通用户拿不到摘要调用的 token 用量」~~ → **错**。`compaction/summary.usage` 直接带着调用用量，普通用户路径拿得到。
   （aeval 侧另有一条 broker ledger 对账路径，`atif_mapper.py:694-705`，那是 A 线的精确性口径，与 B 线无关。）
2. ~~「回收 token 只能从 prune 求」~~ → **错**。`summary.shadowedTokenCount`（本会话 127035）才是**被替换掉的历史规模**；prune 的 `shadowedTokenCount` 是**单个工具结果节点**的估价。

**关键事实**：

1. `compaction/prune` **不带 `compactionId`**，与 cycle 不一一对应。实测 `session-16e5940f`：cycle `8/8/8` 全闭合，prune **27** 次；`session-63322f41`：cycle `6/6/6`，prune 7 次。
2. prune **不在** `start..end` 窗口内：`session-16e5940f` 首批 prune 在 `seq=365/367`，首个 `compaction/start` 在 `seq=686`。
3. pruner README 原文：修剪不发起模型调用，**可能充分缓解 token 压力使摘要跳过** ⇒ 语义上 prune 先发生，且可能让摘要**不必**发生。
4. cycle 事件序列：`start → summary → user/message(自动生成的 compact-checkpoint) → end`，发生在某 `step/end` 之后、同一 turn 内。
5. **触发来源可判定**（原计划标为「待验证」，现已解决）：
   - 按需 `/compact`：有 `sourceCommandId`，且 `turn === null`（手动要求 idle）；
   - 自动：`turn` 为数字。
   - 但**压力触发 vs 上下文溢出触发不落在任何事件里**（只在 `ctx.logger.info` 里，`dsh-compaction-basic/lib/index.js:838-844`）⇒ 溢出型要自己关联 `agent/request-error`（`CONTEXT_WINDOW_EXCEEDED`）在同步内判断。
   - 触发阈值 `thresholdTokens = floor(min(contextWindow × 0.8, messageBudget − 65536))`（`:132`）**不在事件里**；「离阈值多远」要用 `ctx.tokenMeter` 的 `contextPressure` 投影（`{contextWindow, pressureTokens, projectedTokens}`）。

⇒ 「压缩频率」的正确口径是**压力事件（episode）**：`prune 遍次（零模型调用）` 与 `summary cycle（真调模型、有延迟、有用量）` **分开报，禁止相加**。

### 3.2 工具调用

`tool/call`：`{turn, step, callId, name, arguments(JSON 字符串)}`；`tool/result`：`{turn, step, message, error?{name,code,reason}, meta?}`，按 `callId` 配对。

**⚠️ 数量差 ≠ 未配对（此前结论已更正）**。实测 `tool/call=1478` / `tool/result=1505`（`session-16e5940f`），差额 27，而：

```
tool/result − tool/call = 27
compaction/prune          = 27   ← 恰好相等
tool/result 中 surfaceOp=replace = 27   ← 恰好相等
按 callId 去重后的 tool/result    = 1478  ← 与 tool/call 完全相等
```

⇒ **本会话未配对 = 0。那 27 条是 `compaction/prune` 产生的 surface 替换副本，不是缺配对。**
⇒ 配对前**必须先按 surface 去重**（`surfaceOp:{op:'replace',startSeq,endSeq}`），否则会报出「27 个未配对」这个**假发现**。
⇒ 替换副本数本身是有价值的信息，单列 `surfaceReplacements`。

**⚠️ 成/败状态是双源且不一致**。实测：带 `error` 字段 41 条，带 `message.isError` 43 条，且 `error ⊂ isError`（只有 `error` 的 0 条，只有 `isError` 的 2 条）。

⇒ **权威判失败用 `message.isError`**（43）；`error` 只补错误详情，**缺失不代表成功**。
⇒ 若误用 `error` 字段，会**漏报 2 个失败**，工具错误率系统性偏低。

**⚠️ 并发真实存在**：实测 19 个 step 内工具区间重叠（例：同一步两个 `bash` 重叠）⇒ 工具耗时**不可相加**（§4 记账原则第 1 条）。

### 3.3 Agent Team

实测 `session-63322f41-…`（232 条 team 事件），字段与官方 zod schema（`dsh-experimental-agent-team/lib/types/projection.js:46-91`）一致：

- `team/member`：`{version:2, teamId, member:{id, name, description, provider, context:'fresh'|'fork', phase:'provisioning'|'active'|'failed', error?}}`
- `team/task`：`{version:2, teamId, task:{id, revision, subject, description, status, ownerId?, blockedBy, writeScopes}}`
- `team/message/queued` / `delivered`：`{teamId, message:{id, senderId, senderName, targetId, content}}` / `{teamId, messageId, targetId}`
- `subagent/catalog`（追加到**父**会话，每个直接子会话一条）：`{childId, childCreatedAt, mode, label?}`
- `subagent/descriptor`（追加到**子**会话自己的日志）：`{version:3, mode, provider, label, …}`
- `tool-workflow/agent-start|agent-end`（父会话）：`{runId, seq, label, phase?, childId}` / `{runId, seq, outcome}`

**「分叉」的判据**（两处，都要覆盖）：

- 团队语义：`member.context ∈ {fresh, fork}`，由 `experimental-tool-agent-team/lib/index.js:290` 映射到不同 provider；
- 会话血统：子会话 header 的 `parentSession` / `origin:'subagent'` / `delegationDepth`（实测 `42758670-…` 首行即 `parentSession=session-63322f41-…, delegationDepth=1`）；
- provider 无关的 fork 证据：子 header 的 `isSeeded === true` **且** `inheritedEventCount > 0` **且** 子日志含 `session/end-seed {inherited:true}`。
- ⚠️ **fork 的种子事件从不在父会话总线上重放**（子会话构造期 seed），必须读子会话自己的日志/投影。

**能力边界**：父日志只给拓扑 + 消息流 + 任务板；`team/member.phase` 在实测里每个成员只出现初值一次。成员**实时忙闲**必须跨会话读子会话（这正是 Q1=B 的成本所在，§5.1）。

**信箱投递实测（可拆，但很小）**：`queued → delivered` 按 `message.id ↔ messageId` 配对，85 对，
等待 `min=43ms / 中位=120ms / P90=337ms / max=595ms / 合计=13.0s`，**>1s 的 0 条**。
⇒ 信箱排队**亚秒级，不是瓶颈**。团队真正的等待在 `blockedBy` 依赖与成员忙碌时长（量级分钟，且需读子会话）。

### 3.4 重试与等待（§8 对照后新增，实测确认是高价值信号）

| 事件 | 载荷（实测） |
| --- | --- |
| `llm/retry` | `{retryId, turn, step, provider, mode, policyKey, retry, maxRetries, delayMs, failure:{message, code}}` |
| `llm/retry-started` | 同族，标记这一轮尝试开始 |
| `agent/request-error` | host 侧 waterfall，压缩的「上下文溢出」触发点就是它 |
| `team/message/queued` → `team/message/delivered` | 消息投递滞后（Lead → 成员的排队时间） |

实测 `session-63322f41-…`（**这是同一台机器上真实发生的一次会话**）：

```
llm/retry = 10, llm/retry-started = 10
failure.code 分布 = {TRANSPORT: 10}          ← 单一失败模式，重试有意义
Σ delayMs = 32,478.6 ms ≈ 32.5 秒            ← 纯退避等待，用户全程在等
max retry index = 5
policyKey = ["normal",5,["EMPTY_RESPONSE","RATE_LIMIT","SERVER","TIMEOUT","TRANSPORT"],500,10000,0.1]
```

对照 `session-16e5940f-…`：`llm/retry = 0`。**同一台机器上两次会话，一个是 0 秒退避、一个是 32.5 秒退避。**

⇒ 结论：重试退避是**区分度极高、且当前三族完全看不到**的时延来源。不纳入等于面板上「一切正常」而用户已经等了半分钟。
注意：`command/run` 在两个会话里都是 0（手动 `/compact` 未出现），所以 §4 的 `summaryTriggerMix` 在本机样本里全是自动触发。

**退避藏在哪（实测，这是必须拆开的证据）**：机制是「失败 → 等一段 → 再试」，每轮各等一次（公式 `min(500 · 2^(retry−1), 10000) × jitter(±10%)`，`dsh-llm-retry/lib/types/index.js:33-38`）。
实测 `turn 7 / step 30`：**步骤墙钟 20.4 秒，其中 16.2 秒（80%）是纯退避等待**。
而 `sessionStats.llmMs` 的口径是 `step/start → assistant/message`，**这几轮退避全被算了进去** —— 即「等待」被记成了「模型耗时」，正是 §8 那篇文章警告的「排队时间被算进模型耗时，最后把锅甩错地方」。
另外 `dsh-llm-retry` README 明确：**每次重试都是另一次计费的提供方请求**，所以退避同时是时间成本和费用成本。
第二处（`turn 22 / step 60`，同样 5 轮）在日志末尾尚未收尾，其 16.4 秒连 `llmMs` 都统计不到 —— 属于「不可见的工作」。

---

## 4. 指标口径 v1（五族，均为 §2.5 骨架上的具名查询；⑤ 待确认）

字段名/公式/分母/边界先冻结成文档 + 期望值 JSON，再写代码（§6 M0）。
每条信号都要带 §2.5 的六个通用字段（范围/时间/参与者/关联事件/来源/是否推断+可信度）。

### ① 压缩族 `compaction`

| 字段 | 来源 / 公式 | 边界 |
| --- | --- | --- |
| `summaryCycles` | 去重 `compactionId` 且 `start` 有配对 `end` | 实测 8/8、6/6 全闭合 |
| `summaryCyclesOpen` | 有 `start` 无 `end` | 中断/崩溃要显式暴露，不吞 |
| `cyclesPerTurn` / `cyclesPer1kSteps` | `summaryCycles / closedTurns`、`×1000 / closedSteps` | 分母复用 `sessionStats` 口径（`step/end` 是权威，见 `dsh-session-stats/lib/projection.js` 开头注释） |
| `summaryLatencyMs` | Σ `(end.time − start.time)` | |
| **`compactionStallMs`** ⭐ | Σ 每次 cycle 所在的 `[step/end(N) → step/start(N+1)]` 间隙 | **用户可见代价**。实测 8 次归因 **100%**、合计 **541.7 秒 = 9.0 分钟**（§2.5）。与 `summaryLatencyMs` 应近似相等，差值即「组装 + 其它 pre-step 工作」 |
| **`compactionStallShare`** ⭐ | `compactionStallMs / 会话墙钟` | 压缩吃掉了用户多少时间的比例 |
| `assemblyGapMs` | `[turn/start→step/start(1)]` 与 `[step/end(N)→step/start(N+1)]` 的间隙，**扣除**区间内 `compaction/start→end` | 纯上下文组装 + pre-step 其它工作。**实测中位 30–40ms**，接近落盘抖动 ⇒ 标 `inferred`（§2.5 精度限制） |
| `summaryCallUsage` | `summary.usage.{input,output,total,cacheRead}` 累加 | 实测 `totalTokens=158666` |
| `summaryShadowedTokens` | Σ `summary.shadowedTokenCount` | 实测单次 127035 |
| `summaryShadowedNodes` | Σ `len(summary.shadowedSeqs)` | 实测单次 167 |
| `summaryTriggerMix` | `manual`（有 `sourceCommandId` 或 `turn===null`）vs `auto-pressure`（默认）vs `auto-overflow`（自关联 `agent/request-error`） | 溢出型不落事件，只能自关联；关联不上就报 `auto-unknown`，不编 |
| `prunePasses` | 相邻 `compaction/prune` 按 seq 连续归并成「遍次」 | prune 无 compactionId，只能按 seq 邻近归并 |
| `pruneShadowedTokens` / `pruneShadowedNodes` | Σ `prune.shadowedTokenCount` / Σ `len(shadowedSeqs)` | 与摘要族**分开报** |
| `avoidedByPrune` | 「prune 遍次之后、到下一个 cycle 之间无 cycle」的次数 | 反映修剪省掉的摘要次数 |
| `distanceToThreshold` | `contextPressure` 投影的 `{contextWindow, pressureTokens, projectedTokens}` | 阈值本身不可观测，只报压力值 |

### ② 工具循环族 `toolLoops`

**口径必须与 aeval 现有 `LoopDetection` 一致**（`aeval/src/aeval/verdict/trajectory/metrics.py:395`，`call_key` 在 `:83-108`）。
实时实现要逐字段移植 `call_key`（工具名 + 归一化参数），否则同一会话在面板上和在 aeval 报告里数字不同。

| 字段 | 公式 |
| --- | --- |
| `maxConsecutiveRepeat` | 同一 `call_key` 连续出现的最大长度 |
| `distinctRepeatedKeys` | 出现次数 ≥ 阈值的不同 key 数 |
| `pingPongPairs` | 形如 A,B,A,B 的相邻对计数 |
| `errorRetryLoops` | 一次 `looks_like_error(result)` 之后同一 `call_key` 再现的次数（错误模式表复用 `metrics.py:65`） |
| `unpairedCalls` | `tool/call` 与按 surface 去重后的 `tool/result` 按 `callId` 配对后的缺口 | **实测本 session 为 0**（1478 vs 去重后 1478）；去重前不看会误报 27 |
| `surfaceReplacements` | `tool/result` 中 `surfaceOp.op='replace'` 的条数 | 实测 27，与 `compaction/prune` 严格相等 |
| `loopStepShare` | `1 − distinct(stepKey)/steps` |

**有界内存硬要求**：投影 state 会进 checkpoint（`session-projection-cache` 会持久化），只保留最近 N=64 次调用的 ring buffer + 计数聚合，**不得**存全量调用历史。

### ③ 团队分叉族 `teamGraph`

| 字段 | 公式 |
| --- | --- |
| `members[]` | 由 `team/member` 去重（按 `member.id`）：`{id, name, context, provider, phase}` |
| `forkRatio` | `count(context=='fork') / members` |
| `delegationDepth` | 本会话 header（`init(header,…)` 直接可读） |
| `subagentSpawns` | `subagent/catalog` 去重计数 + `mode`（one-shot/continuable）分布 |
| `fanOutWidth` / `peakConcurrent` | 成员数 / 同时 `phase=='active'` 的峰值 —— **需跨会话**（Q1=B 的核心产出） |
| `memberActivity[]` | 每个成员的活跃区间、忙闲占比、闲置时长、最后活动 seq —— **需跨会话** |
| `criticalPathMs` | 从 Lead 派发到最后一个成员 settle 的墙钟路径 —— **需跨会话** |
| `messageFlow` | `{queued, delivered, pending = queued − delivered}`；可算消息投递滞后 |
| `taskBoard` | 任务数、`revision` 变迁次数（=状态变更数）、按 `subject` 标题 |
| `toolWorkflowAgents` | `tool-workflow/agent-start|agent-end` 配对数（与 Team 分开报） |

### ④ 重试与等待族 `retriesAndWaits`

| 字段 | 公式 | 边界 |
| --- | --- | --- |
| `retryAttempts` | `llm/retry` 计数，按 `(turn, step)` 归组 | 实测单会话 10 次 |
| `retryBackoffMs` | Σ `llm/retry.delayMs` | **实测 32.5 秒**，纯等待 |
| `retryFailureMix` | 按 `failure.code` 分组计数 | 实测全是 `TRANSPORT`——同一模式反复重试才有意义 |
| `retryExhausted` | `retry >= maxRetries` 的次数 | 实测撞到 `maxRetries: 5` |
| `retryPolicy` | 解析 `policyKey`（base/max delay、jitter） | 用于解释退避为什么这么长 |
| `queueWaitMs` | `team/message/queued.time → delivered.time`，配对靠 `message.id ↔ messageId`（`reference` 强度） | 成员信箱等待。**实测很小：85 对，中位 120ms、P90 337ms、max 595ms、>1s 的 0 条** ⇒ 可测但非瓶颈 |
| `blockedByWaitMs` | 团队任务因 `blockedBy` 未满足而不能启动的等待 | **团队真正的排队在这**（量级分钟）；成员忙碌时长需跨会话读子会话（Q1=B 的成本） |
| **`approvalWaitMs`** ⭐ | `approval/asked.time → approval/decided.time`，按 `id` 配对（`reference` 强度） | **等人**。实测 63,191 ms 与 **30,360,365 ms（8.4h）** 各一次 ⇒ 归入 `humanWaitMs`，**排除出 agent 延迟与分位数** |
| **`humanWaitMs`** | `approvalWaitMs` + `blockedWaitMs`（`turn/end.kind='blocked'` 等用户输入） | 独立统计类，**不与 `resourceWaitMs` 混算**（§2.5） |
| `resourceWaitMs` | `teamMailboxWaitMs` + `workflowSlotWaitMs` + `toolSlotWaitMs`（+ TTFT 内的提供方排队，不可分） | 与 `humanWaitMs` 分列 |
| `workflowSlotWaitMs` | `[tool-workflow/run-start, agent-start]` 与相邻 `agent-end → agent-start` 的散布推断（`acquireSlot` 在 emit 之前） | **标 `inferred`**：`agent-start` 在取槽之后才 emit，无法精确测 |
| `toolSlotWaitMs` | `maxParallelToolCalls`（默认 10）造成的槽位等待 | ❌ 落在 `[tool/call, tool/result]` 内部，**不可观测**；只报「该步是否超过 10 个并行调用」这一事实 |

#### ⭐ 状态与计划重写（**⑤ 族，待你确认是否纳入**）

数据源全部是 §2.5① 里已核实的事件（`todo/write` 全量快照、`goal/change` 带 `revision`、`deliverables/presented`、`workspace/changes`）：

| 字段 | 公式 | 说明 |
| --- | --- | --- |
| `planWrites` | `todo/write` 计数 | 实测 10 / 13 次 |
| `planRewrites` | 相邻快照**整份替换**的次数 | 实测 3/10——**单独看会误判**（§2.5①） |
| **`planRewritesAfterComplete`** | 重写时上一份**已完成** | 实测 2 → 正常分段 |
| **`planRewritesMidPlan`** ⭐ | 重写时上一份**未完成** | 实测 1 → **计划不稳定的真信号** |
| `planChurn` | Σ(新增 + 删除条目) | 实测 52；须按上面两项归因 |
| `planStalled` | 状态长期停在 `in_progress` 从未 `completed` 的条目 | 反映卡住的子任务 |
| `planOpenAtEnd` | 会话结束时仍非 `completed` 的条目 | |
| `goalRevisions` | `goal/change` 的 `revision` 最大值 | 实测每会话 2 次 |
| `deliverablesCount` | `deliverables/presented` 的 `files` 累计 | 实测 3 / 29 / 9 |
| `workspaceChangeTurns` | 有 `workspace/changes` 的 turn 数 | 实测 5 / 30 / 13（**只到 turn 粒度，无文件列表**） |

> **为什么单列一族**：`todo/write` 的 schema（无 turn/step 的全量快照）与工具族的配对模型完全不同，
> 混进 `toolLoops` 会让那一族的定义变浑浊。**若你认为族太多了，可退回为 ② 族的一个子维度。**

### 时延记账原则（来自 §8，**贯穿各族**）

1. **禁止跨并行 Span 求和**。父 Span 包含子 Span；并行工具/并行成员的耗时不能相加。
   ⚠️ 现有 `sessionStats` 的 `toolMs` 是「按 callId 配对求和」（`dsh-session-stats/lib/projection.js`），
   那是**全量总计**、不是关键路径贡献；两个工具并行各 3 秒，对总时延的贡献约 3 秒而不是 6 秒。我们的面板不得把它当「花了多久」呈现。
2. **关键路径单独算**：从任务开始到结束，沿真正推迟结束时间的链走。`criticalPathMs` 是团队族的产出（§4③），但这条原则适用于整棵轨迹。
3. **等待必须显式化**：退避、排队、等成员，三者都要有自己的字段；否则它们会被算进「模型耗时」或干脆消失在墙钟里。
4. **分位数按 N 决定，而不是一刀切**。原先写「live 不做分位数」过于绝对：**实测单会话可有 1450 个 step**，
   在**步粒度**上 P50/P95 完全撑得住。规则改为：
   - **步粒度（N 可上千）**：live 面板可给 P50/P95；N 小（如 <50）时只显示中位与最大值，不显示 P99；
   - **会话粒度（N = 用户会话数，通常很小）**：live 不做，属于 aeval 的 run 级；
   - aeval 侧当前 `src/aeval` 里**没有任何** percentile/quantile 实现，是真实缺口。
5. **速度之外必须有护栏**：任何「变快了」的结论都要同时看任务成功率、答案质量、安全与成本——
   aeval 的 `required` / `integrity` 指标（`security_metric_registry`，`presets.py:229-249`）正好是这套护栏，不该只做延迟对比。

---

## 5. 改动清单（文件级）

### 5.1 Layer 1 · 宿主侧：**投影单元 + 跨会话聚合器**（Q1=B）

```
# L1 原始事件：只取引用，不复制载荷
src/analytics/refs.ts          # L1 稳定引用 (sessionId, seq, type) + surface/log 区分
# L2 执行单元（粒度规则见 §2.5「粒度陷阱」）
src/analytics/units.ts         # turn / step / 模型调用 / 工具执行 / 压缩周期 / member / 子会话
# L3 关系与证据
src/analytics/relations.ts     # (sourceRef, relationKind, targetRef, strength, confidence)
src/analytics/signals.ts       # 六个通用字段（范围/时间/参与者/关联/来源/推断+可信度）
# 四族：骨架上的具名查询
src/analytics/compaction.ts    # 压缩族
src/analytics/tool_loops.ts    # 循环族（**注意：整族是 inferred，必须带 confidence**）
src/analytics/team_graph.ts    # 团队族（本会话拓扑）
src/analytics/retries.ts       # 【§8】重试/退避/排队等待
src/analytics/critical_path.ts # 【§8】关键路径记账（禁止跨并行 span 求和）
# 投影与聚合
src/analytics/schema.ts        # state / wire view 的 schema（严格、**只放 seq 句柄，不放载荷**）
src/analytics/definition.ts    # 组装 ProjectionDefinition（key: 'trajectoryAnalytics'）
src/analytics/aggregator.ts    # 【Q1=B】跨会话：子树发现 + 成员忙闲 + 关键路径
src/analytics_entry.ts         # 新 Cordis 行：inject = ['sessionProjections','sessions','agents']，apply 只做 register + 订阅
```

**跨会话聚合器的机制（已查实，可直接照做）**：

- 子树发现：遍历 `ctx.agents.list()`，按 `agent.session.header.parentSession` 匹配根会话 —— 官方 Team runtime 自己就是这么做的（`dsh-experimental-agent-team/lib/index.js:520-535` `liveChildrenByRoot`）；也可用 `ctx.subagents.listChildren`。
- 观测所有会话：`ctx.on('session/event', handler, { global: true })`（`{global:true}` 保证跨 scope 都能看到，参照 `dsh-api-session-controller/lib/index.js:1369`）。
- **HMR 纪律**（必须抄）：模块级 `WeakMap` 记录每个 `Session` 对象已消费的水位，`apply` 里再 `ctx.sessions.list()` 补扫一遍 —— 否则热重载后重复计数。范例 `dsh-session-telemetry/lib/index.js:30, 66-90`。
- **隔离纪律**：每个 handler 用 `contain()` 包裹（Cordis 的 `emit` 是抛错即停），一个 bug 不得饿死其他订阅者。同样的 `contain` 惯例 `dsh-session-telemetry` 已在用。
- **不要重建团队树**：`dsh-experimental-agent-team` 已经注册了 `agentTeam` 投影（key `agentTeam`，`stateVersion: 4`），并有客户端 chip。我们**读取它 + 增补派生分析**（扇出、fork 比、消息滞后、成员忙闲、关键路径），而不是另立一套 team 语义 —— 两套语义必然漂移。
- 成员的实时忙闲来自子会话自己的事件流（`session/event` 已覆盖），并结合 `agent/status`、`agent/error` 提升信息量。

**降级与状态**：profile 未挂 `sessionProjections` 时该行 fiber 保持 pending（官方 `session-stats` 就是这么做的），
并在 `src/control_status.ts` 的 `EvalControlStatus` 增补 `analytics: 'active' | 'unavailable'`，胶囊如实说明，不做静默旁路。

**打包约束**：这两个新入口在**宿主进程内**加载，必须走 peer、不得包成 standalone bundle ——
`scripts/pull-neutral.mjs` + `test/packaging.test.ts` 的既有不变量继续适用。

`cordis.patch.yml`：**追加第二行**（默认 patch 就带上，保证「装完就有」），与现有 `aeval-broker-transport` 行解耦。

### 5.2 Layer 2 · 客户端：分析标签页（Q3=A）

**定位一句话**：在对话视图环里加一个**分析页**，订阅宿主推送的投影，显示当前会话的实时计数 / 趋势 / **未知与未配对事件**，
并允许从分析项跳到官方 Trajectory 看原始记录。**不另造一个完整的轨迹浏览器**（见下方「判据」）。

- 现状：`client/client.js:25` 已经是 `window.__ModuleLoader__.load({id, factory})` 形态；已有 `conversation.composer.dock`（`:552`）与 `plugins.detail.section`（`:560`）两个 slot；且 `:405` 有 `setInterval(refresh, 30_000)` 的**轮询**。
- 新增：`ctx.slots.inject('conversation.view', () => ctx.slots.register({ name:'conversation.view', id:'eval-trajectory-analytics', order: … }, Component))`，`order` 要避开官方 Trajectory 的 `10`。
- **视图一 · 概览**：四族的趋势与异常提示 + **未知/未配对事件**（一等公民，见下）。
  live 会话的「趋势」是**按 turn 的序列**，不是分位数（单会话 N 太小，§4 记账原则第 4 条）；异常阈值必须来自 M0 冻结的规则，不编。
- **视图二 · 证据链**：点击任一指标 → 展开对应事件及前后关系（§2.5 的 `(sourceRef, relationKind, targetRef, strength, confidence)`）。
  - **边的强度要在 UI 上可区分**：`reference` 实线、`temporal` 虚线、`inferred` 虚线 + confidence 标注。例：
    ```
    调用(seq a) ──reference: callId──▶ 错误结果(seq b)
                                              │ inferred: call_key 相似 (confidence 0.6)
                                              ▼
                                        后续调用(seq c) ──reference──▶ 最终结果(seq d)
    ```
  - 跨会话证据（成员子会话）的取法见 §2.5 的待定决策 D1。

### 未知 / 未配对事件是一等公民（不是边角料）

理由都在既有证据里：

- DSH 读路径**拒绝**词汇表外的事件类型（除非信封带 `ignorable`）；
- aeval mapper 对未知类型 **fail closed**（`DshAtifConversionError`，不猜）；
- **实测的例子正好证明它必要**：`tool/call=1478` vs `tool/result=1505` 看似「27 个未配对」，
  实测却是**27 条 `compaction/prune` 的 surface 替换副本**，去重后正好 1478，**真实未配对 = 0**。
  如果面板只报数字，用户会得到一个**假发现**；有证据层才能说清「这 27 条是什么、从哪来」。
- 因此固定显示 `unknownEventTypes[]` / `unpairedCalls[]` / `surfaceReplacements[]` / `unresolvedRelations[]`，
  并让每一条都能点开看依据事件。**「未知」不是失败，是诚实**。

本仓库既有的纪律就是如此：`MetricOutcome.status=skipped`（宁可不判也不编）、`CompletenessStatus=unavailable`。
⇒ 面板必须有一块固定位置显示「我认不出来 / 我配不上对」，**把丢失显式化比假装完整更有价值**。
字段：`unknownEventTypes[]`（type → 计数 → 首个 seq）、`unpairedCalls[]`、`unresolvedRelations[]`（关联不上，如溢出型压缩）。

### 跳到官方 Trajectory：**能力分级**（更正 §7 R9 早先的表述）

官方 README 只说了「记录选择与时间线选择**位于 Trajectory 内部**，不提供锚点深链接」（`:104`）——那是 Trajectory **内部**的限制。
**会话外壳提供了**深链接口：`conversation.view` 是 session 作用域的 **list slot**，官方注入 session 级 hook `inspectCall`：

```js
const openView = (view, focus) => { if (!viewTabs().some(t => t.id === view)) return;
  activateView(sessionId, view); actions.openView(view, focus); };
const inspectCall = (callId) => { const t = inspectionTarget();
  if (t?.toolCallFocus !== undefined) openView(t.target, t.toolCallFocus(callId)); };
```

全局扫过：**`toolCallFocus` 只有 `dsh-client-ui-trajectory` 注册**，所以它是唯一能被「定位打开」的视图。

| 证据类型 | 能力 |
| --- | --- |
| 工具调用 / 工具结果 | `inspectCall(callId)` → **切过去并定位** |
| 压缩 / 团队消息 / 重试 / 未配对 | **没有 focus 描述符** → 只能切到 Trajectory 标签，用户自己找；退一步把 `seq` 做成可复制文本 |

⇒ UI 必须如实分级，**不能给非工具类证据承诺高亮**（假承诺比没有更糟）。

**M2 第一步要先验的实现假设**：`useInspectCall` 是否真的到达我们的 `conversation.view` 成员。
已确认该 hook 存在且被 `dsh-client-ui-conversation` 消费（`useInspectCall((value) => …)`），
但**未确认它能传给任意 list 成员**。验不通就退化为上表第二行。
另外：我们的分析页**不要**注册 `toolCallFocus`——不参与 inspection target 竞争，让它保持唯一。

### 「不另造轨迹浏览器」的判据

一句话：**只渲染「某个数字所依据的那些事件」，不提供沿日志上下移动的能力。**

| 不要造（Trajectory 全有） | 要造 |
| --- | --- |
| 全量事件列表、虚拟滚动、分页、搜索 | 一条关系链上被引用的那几个事件（有界，如 ≤5 条） |
| 原始 JSON 检视器、surface 替换的历史展示 | 边的强度 + confidence |
| live chunk 流、附件/图片灯箱 | 分级跳转入口（上表） |

**一旦加了翻页或搜索，就退化成第二个浏览器了。**

### 其余实现细节

- 数据：`useProjection('trajectoryAnalytics')`（会话域组件的标准 kit，见 `dsh-client-ui-renderer` 的 `standardProps`），**不要**新写轮询；若沿用 chip 且它需要实时值，也应改为投影读取而不是 `ctx.remote.pluginManager` 轮询。
- `package.json` 的 `dsh.client.inject` 目前是 `["@deepseek-ai/dsh-client-ui-conversation"]`，需补齐（对照 `@deepseek-ai/dsh-client-ui-trajectory/package.json`）：`@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-client-ui-renderer`、`@deepseek-ai/dsh-client-ui-session`、`@deepseek-ai/dsh-client-locale`。
- 客户端变更要**重建 Web 产物并刷新页面**才可见；只有改 `client/*.js` 且 `pnpm run dev:web` 在跑时才可能热更。
- 注意：**没有状态栏 slot**；最近的是 `sidebar.footer.action`。分析视图就按 Q3=A 走 `conversation.view`。

### 5.3 Layer 3 · aeval 离线对齐（**更正：不需要改 mapper**）

侦察结论：compaction / team / subagent 数据**今天就可从 metric 输入读到，且跨密封往返无损**，无需改 `atif_mapper.py`：

- `evidence.extras["dsh"]["events"]` —— 完整不可变原始日志，DSH 转写的 transcript **恒有**（`atif_mapper.py:787`；`base.py:374-377` 把整个 `atif.extra` 拷进 `TrajectoryEvidence.extras`）；
- `evidence.extras["dsh_preserved_events"]` —— `{eventIndex, type, class, raw}` 列表，**只在非空时存在**（`atif_mapper.py:793-794`，是 `"dsh"` 的**兄弟键**不在其内，必须 `.get(..., [])`）；
- `evidence.extras["dsh"]["inheritedEventCount"]`、`["header"]`、`["usage"]["dispatchedAuxiliaryCalls"]`。

已实测验证：`convert_dsh_read_to_atif → build_canonical_transcript → model_dump_json → model_validate_json` 后全部保留。

要实现的部分：

- 新指标类加到 `aeval/src/aeval/verdict/trajectory/metrics.py`（基类 `TrajectoryMetric:`110`；`evaluate(evidence: TrajectoryEvidence)`；返回 `MetricOutcome`；`_outcome` 私有构造在 `:124-140`，`quality.py:46-51` 已有跨模块导入先例）。
- 注册进 `aeval/src/aeval/verdict/trajectory/presets.py` 的新 `analytics_metric_registry()`（既有registry 见 `:110-249`，共 25 个 id）。套件声明走 `suites/<s>/families/<f>.yaml` 的 `metrics:`，加载期会校验 `severity` 与实现 `category` 一致（`assembly.py:107`）。
- 若要做「每 run 一个频率数」（而不是每试次判决），则加字段到 `TrajectoryStats`（`stats.py:84-110`）→ `collect_stats` → `_aggregate_trajectory`（`report.py:838-944`）→ `report.py:1874+` 与 `dashboard.py:916+`。
- 渲染：`render_trajectory_html`（`trajectory_panel.py:1400`）加 section，复用既有视觉语言（`TrialPanel` `:35`）。
- ⚠️ 已知限制：`ToolEvent` **没有** turn/时间戳/错误字段（`base.py:333-347`），`arguments` 非 dict 会被静默压成 `{}`（原始 JSON 只在 `ToolCall.extra["dsh"]["rawArguments"]`，`atif_mapper.py:509-510`），错误判定是文本启发式（`metrics.py:54-80`）。循环族若只用 `ToolEvent` 够用；压缩/团队族读原始日志。
- ⚠️ `aeval trajectory` 是 **store-keyed**，不接受原始 DSH 会话日志（`cli.py:1562-1660`）；本轮没有选 Q3 的 C 方案，因此不为普通用户新增 aeval CLI。

### 5.4 Layer 4 · 一致性闸门（Q2=A）

- **仓库里没有任何含 compaction/team 的 JSONL fixture**（`find tests suites -name '*.jsonl'` = 0）。做法：
  1. 用既有官方信封构造器 `tests/unit/agents/dsh/dsh_log.py:70-86` 的 `SessionLog.raw(etype, data, …)` 造合成日志（`compaction/start` 已有先例：`test_atif_mapper.py:97`，cycle 助手 `_compaction_cycle` 在 `:729-733`）；
  2. 再冻结 **2–3 个真实会话**为 fixture：一个 team 密集（`session-63322f41-…`）、一个压缩密集（`session-16e5940f-…`）、一个 prune-避免-摘要的样本。
- 期望值 JSON 落库，`dsh-eval-control/test/analytics/*.test.ts`（TS）与 `aeval/tests/**`（Python）都对着它断言。

---

## 6. 里程碑（每步都有可验收产物）

| # | 内容 | 产物 | 预估 |
| --- | --- | --- | --- |
| **M0** | **口径冻结**：`docs/analytics-metrics-v1.md` = §2.5 三层骨架 + §4 四族字段 + **L2 粒度规则**（R15）+ §2.5 六字段取值 + 冻结 fixture + 期望值 JSON + **目标 DSH 版本**（D2） | 文档 + fixture，§2.5/§4 不可再漂移 | 1–1.5 天 |
| **M1** | **L1/L2/L3 基座**（`refs.ts`/`units.ts`/`relations.ts`/`signals.ts`）+ **压缩族**打通 | 压缩族能给出「数字 → 点击 → 事件 + 关系」的完整链；`npm test` 全绿；standalone 回归不变 | 2 天 |
| **M2** | 客户端分析标签页：`conversation.view` 注册 + **概览 / 证据链两视图**（含深链到官方 Trajectory 并高亮 seq） | GUI 实机验证（重建 + 刷新路径写清） | 2 天 |
| **M3** | 循环族 + 本会话团队族 + **重试/等待族**（§3.4）；有界内存与 checkpoint 兼容性测试 | 单会话四族齐全。**循环族全族 `inferred`，正好检验证据链的置信度呈现** | 3 天 |
| **M4** | **跨会话聚合器**（Q1=B）：子树发现、成员忙闲、关键路径；HMR 游标与 `contain` 纪律；D1 的取法落地 | 多成员会话里能看到实时忙闲与关键路径 | 2–3 天 |
| **M5** | aeval 离线实现 + conformance 闸门 | 两条实现对 fixture 逐字段相等 | 1–2 天 |
| **M6** | 普通用户打磨：zh/en 文案、空状态、卸载即清理（投影是 fiber effect）、README/CHANGELOG、版本 `0.3.0` | 可发布包 | 1 天 |

> 为什么压缩族放在 M1 第一位：它的关系**最硬**——`compaction/summary.shadowedSeqs` 是显式列举（实测 167 条），
> 不依赖任何启发式，最适合用来验证「L3 关系 + 证据链」这条通路是通的。等基座被最硬的信号证明可用，再上启发式的循环族。

---

## 7. 风险

| # | 风险 | 处置 |
| --- | --- | --- |
| **R1** | **版本错位**：本机装的是 DSH **0.1.7-rc.1**，而插件 devDeps 与 aeval mapper 都 pin **0.2.0-rc.2**（peer range 恰好都放行）。**已实证词汇表不同**：同机两会话事件类型数 **34 vs 27**，`assistant/attempt` **11 vs 0**，`llm/retry` **10 vs 0**（§2.5 附） | M0 第一件事就是确定目标版本并逐字段核对；**D2 不定则期望值 JSON 无效**；若目标含 0.2.0-rc.2，两版都要进 conformance |
| R2 | `sessionProjections` 未必在所有 profile 挂载 | fiber pending + status 如实报 `unavailable`（§5.1） |
| R3 | 投影 state 进 checkpoint，可能无界增长 | 硬性 ring buffer + 聚合计数；`stateVersion` 变更规则写进 M0 文档 |
| R4 | 双实现漂移 | M0 冻结期望值 + M5 闸门；漂移即测试红 |
| R5 | 团队语义重复建设（官方已有 `agentTeam` 投影与 chip） | 只读取+增补派生分析，不另立 team 语义（§5.1） |
| R6 | 跨会话聚合读到别的会话（隐私边界） | 只沿 `parentSession` 血统向下、只取被授权会话；分析标签页默认只显示**统计量**，原文需显式展开 |
| R7 | HMR 重复计数 / 一个 handler 饿死其他订阅者 | 抄 `dsh-session-telemetry` 的 WeakMap 游标与 `contain` 包装（§5.1） |
| R8 | 数量差被误读成未配对（实测 27 = surface 替换副本，真实未配对 0） | **先按 surface 去重再配对**（§3.2）；`surfaceReplacements` 单列；不猜 |
| R9 | 与官方 Trajectory 标签页功能重叠 | 判据见 §5.2：**只渲染「某个数字所依据的那些事件」，不提供沿日志上下移动的能力**；一旦加翻页/搜索就退化成第二个浏览器。跳转按 §5.2 的能力分级，不给非工具类证据承诺高亮。M2 先验 `useInspectCall` 能否到达 list 成员 |
| R9b | 未知/配对异常被悄悄丢掉，或数字被误读成结论 | §5.2：`unknownEventTypes[]` / `unpairedCalls[]` / `surfaceReplacements[]` / `unresolvedRelations[]` 是一等公民；**实证：1478 vs 1505 的真实解释是 27 条 surface 替换副本，真实未配对 0** |
| R10 | 压缩语义歧义（prune vs cycle vs 溢出） | 已实测定死（§3.1）；三族分开报，禁止相加；溢出型关联不上就报 unknown |
| R11 | **把 §8 那篇文章过度套用**：引入 OTel/自建追踪体系 | **明确不做**。DSH 已自带 `dsh-session-telemetry` 与 `dsh-session-telemetry-otel`；再引一层会产生第二条真相源。我们只做派生分析层（§8「不能照搬」） |
| R12 | 把全量求和当成耗时（并行工具/并行成员） | §4「时延记账原则」写进 M0 契约，代码评审按此拒绝 |
| R13 | 面板呈现原文造成泄露 | 默认只显示统计量；**任何导出**（fixture、HTML 报告、遥测）走 `sessionTelemetry/record` waterfall 脱敏，且不携带原文 |
| R14 | 证据链把推断当事实呈现 | §2.5 强制 `strength ∈ {reference, temporal, inferred}`，`inferred` 必须显示 confidence；本仓库已有先例可循（`atif_mapper` 的 fail-closed 精确性对账、`MetricOutcome.status=skipped` 宁可不判） |
| R15 | L2 执行单元粒度不冻结 → 双实现必漂 | §2.5「粒度陷阱」写进 M0 契约；用 `llm/retry` 5 次尝试做首个判例 |
| **R17** | **把「等人」混进延迟统计** → 一次 8.4 小时午休毁掉所有分位数 | §2.5：`humanWaitMs` 与 `resourceWaitMs` **强制分列**；`approvalWaitMs`/`blockedWaitMs` 排除出 agent 侧延迟与 P50/P95 |
| **R18** | 把**不可观测的排队**（提供方、Workflow 槽位、工具槽位）当成可测并编数字 | §2.5 全清单逐条标注可观测性：提供方=融合进 TTFT；Workflow 槽位=`inferred`；工具槽位=只报事实不报时长 |
| **R19** | 以为「检索轨迹」只是隐藏，去挖不存在的检索层 | §2.5：DSH **没有**记忆/知识检索层（包层面 0 个、事件层面仅 1 个）；只做工具语义分类，检索内部与 skill 选择明确声明不可观测 |
| **R20** | 把**宿主持久化层的读**当成可观测去挖 | §2.5：**读结构性不可得**——load/resume 在第一条例事件之前完成，官方词汇表无任何 `session/load|resume`。写侧部分可得；争用类信号只在 API 层 |
| **R21** | 反向错误：把 **agent 状态**（todo/goal/产物）当成不可观测而漏掉 | §2.5①：这些全是事件且为**全量快照**，实测 `todo/write` 10–13 次、`goal/change` 2 次、`deliverables/presented` 3–29 次 |
| R16 | 证据链把关系载荷塞进投影 state → checkpoint 爆 | §2.5：**只存 seq 句柄**；wire view 有界；客户端用句柄解析 |

---

## 8. 外部方法论借鉴：Agent 延迟治理 / 分布式追踪

来源：一篇讲「线上 Agent 响应变慢怎么定位」的文章（`https://mp.weixin.qq.com/s/1Ks_Zz0BCm0LyvuwM1ecnA`，微信有反爬，正文经 curl 取得）。
它的框架是**生产环境延迟治理**（Trace/Span、TTFT、P50/P95/P99、关键路径、六类瓶颈、优化与护栏），我们的场景是**轨迹分析**。
两者不是一回事，所以逐条判定「能用 / 不能照搬」，避免整篇生搬。

### 能直接用上的（已落进 §3.4 与 §4）

| 文章的论点 | 我们的落点 | 实测支撑 |
| --- | --- | --- |
| 第六类瓶颈「重试」：失败调用只花 1 秒，但多轮退避会让总时延突然拉长 | **新增第 ④ 族**：`retryAttempts` / `retryBackoffMs` / `retryFailureMix` / `retryExhausted` | 实测一次会话 **Σ delayMs = 32.5 秒**、10 次重试、全部 `TRANSPORT`、撞到 `maxRetries=5`；另一次会话 0 次 —— 区分度极高 |
| 第一类瓶颈「排队」：没有单独的 queue Span，排队时间会被算进模型耗时 | `queueWaitMs`（团队信箱）+ `blockedByWaitMs`（依赖等待）；**提供方排队承认不可分**（§2.5 TTFT） | 实测信箱 85 对，中位仅 **120ms**（可测但非瓶颈）；团队真实排队在 `blockedBy` 与成员忙碌 |
| 「并行 Span 耗时不能直接相加，要找关键路径」 | **时延记账原则**（§4）：禁用全量求和冒充耗时；`criticalPathMs` | `sessionStats.toolMs` 是配对求和，不是关键路径贡献 |
| 第五类瓶颈「编排」：单个 Span 不慢但 Trace 很长 —— 步骤膨胀、重复调用、过度反思、该并行却串行 | 正是**工具循环族**的语义：文章原文「同一个工具被连续调用多次，可能不是工具慢，而是 Agent 没利用上一次结果」；「该并行却串行」也有了实证 | 实测 `tool/call=1478`；**19 个 step 内工具区间重叠**（真并行存在） |
| 「用 Trace 上下文串起跨进程/跨服务/子 Agent」 | 正是 Q1=B 的跨会话聚合器：`parentSession` + `delegationDepth` + `teamId` + `childId` 就是 DSH 版的 trace 传播 | 实测子会话 header 带血统 |
| P95/P99 而非平均值 | 只在 **run 级**引入（`aeval` 目前**零** percentile 实现，是真缺口） | 单会话 N 太小，live 面板不做 |
| 优化后要有护栏：成功率、质量、安全、成本不能退化 | 复用 aeval 的 `required`/`integrity` 指标当护栏（`security_metric_registry`） | 已有能力，只需在 M5 绑定到性能对比 |
| 脱敏：记录长度/哈希/分类标签，而不是完整 Prompt 与原文 | 面板默认只显示统计量；任何**导出**走 `sessionTelemetry/record` waterfall | 该 waterfall 默认不挂规则、fail-closed，权威日志永不改写 |

### 不能照搬的

1. **不要引入 OpenTelemetry。** DSH 已经自带 `dsh-session-telemetry`（`live`/`on-demand` 两种捕获，`ctx.sessionTelemetry`）与 `dsh-session-telemetry-otel`。
   文章是从零建追踪体系，我们已经有权威事件日志 + 投影 seam；再叠一层 OTel 会造出**第二条真相源**，且与 `evalControlStatus` / 投影的既有语义打架。
   （若将来真有人要 OTel，直接用那个现成插件，不要自己接。）
2. **六类瓶颈是「延迟治理」分类，不是「轨迹分析」分类。** 我们四族问的是 **agent 行为**（压缩/循环/分叉/重试），
   文章问的是 **时间去哪了**。两者的交集是「重试 + 排队 + 编排」，另外三类（模型、检索、工具下游）在 DSH 这一层看不到下游实现，硬套会造出无法证伪的字段。
3. **「先用指标圈定异常切片，再对比慢/正常 Trace」是运维事故流程**，需要历史基线与多条对照样本；
   普通用户看的是**自己这一次会话的当下**，没有基线可比。这套只能落到 aeval 的 run 级报告，不能塞进 live 面板。
4. **分位数与采样**（文章提到按错误状态/重要度/耗时保尾抽样）只在将来做**多会话/车队级聚合**时才需要；本轮 Q1=B 只沿 `parentSession` 向下，不跨用户采样。

### 一句话

文章的价值不是「再建一套追踪」，而是给了我们的行为指标一个**诊断目的**，并暴露了三个本该有却漏掉的东西：**退避等待、排队等待、关键路径**。

---

## 9. 下一步

直接开工 **M0**：把 §2.5 的三层骨架与 §4 的四族字段表落成 `docs/analytics-metrics-v1.md`，
用真实会话冻结 fixture 与期望值 JSON，并在同一份文档里定下 §2.5 的 L2 粒度规则（R15）、六个通用字段的实际取值（R14/R16）。

这一步不写生产代码，但决定后面所有实现的正确性判据。开工前需要 D1（跨会话证据取法）与 D2（目标 DSH 版本）两个答案。
