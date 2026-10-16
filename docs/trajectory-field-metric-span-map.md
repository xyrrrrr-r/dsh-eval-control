# 轨迹字段 → 信息 → 指标 → Span 全映射

> **本文性质**：字段形态和计数来自本机真实会话日志核对；语义解释还需服从目标 DSH 版本的类型定义与运行时不变量，实测样本不能代替跨版本契约。
> 证据来源：60 个会话；主证据 `session-63322f41`（34 类事件、3683 条）与 `session-16e5940f`（27 类）。
> 标记：✅ 可精确测量 ｜ 🟡 受限/需推断 ｜ ❌ 不可得
>
> 配套文件：`PLAN-live-trajectory-analytics.md`（架构与口径）；本文只解决**「字段能不能变成指标」**。
> 规范配套：[`trajectory-metrics-contract.md`](trajectory-metrics-contract.md) 冻结规范化分类、关系、指标口径与证据等级。

## 0. 规范化分类与记录纪律

本映射按事件列举字段；产品与离线复算按以下两条正交分类轴归档，避免把来源、指标和失败结论混在一个标签里。

### 0.1 执行域

| 域 | 内容 | 常见 DSH 证据 |
| --- | --- | --- |
| `context` | 上下文请求、注入、压缩、修剪 | `request/context`、`user/message.source.kind`、`compaction/*` |
| `model` | 模型请求、流式输出、用量、重试 | `step/*`、`assistant/message`、`llm/retry*` |
| `tool` | 工具调用、结果、错误与耗时 | `tool/call`、`tool/result` |
| `planning_state` | todo、goal、工作区变化与交付物 | `todo/write`、`goal/change`、`workspace/changes`、`deliverables/presented` |
| `coordination` | agent/team 成员、消息、任务与派生会话 | `team/*`、`subagent/*`、`agent/inbox/spliced` |
| `human_control` | 审批、用户插话、等待与终止 | `approval/*`、用户来源的 inbox 事件、`turn/end` |
| `outcome` | 轮次/会话结束状态与结果证据 | `turn/end.reason`、可验证的任务/环境结果 |

### 0.2 证据等级

| 等级 | 含义 | 示例 |
| --- | --- | --- |
| `observed` | 字段直接记录的事实 | `turn/end.reason.kind='completed'`、`message.isError=true` |
| `derived` | 按冻结公式从明确事件计算 | `callId` 配对后的工具耗时、两个关联事件的时间间隔 |
| `inferred` | 基于重叠或启发式推测，存在其他解释 | 等待区间与 `bash` Span 重叠，可能受到该工具影响 |
| `unavailable` | 事件未记录，不能可靠恢复 | 检索召回数、模型选择 skill 的理由 |

每条规范化记录需保留 `sessionId`、actor/turn/step 范围、事件引用、来源版本、公式版本、证据等级和缺失原因。`inferred` 不得写成确定根因；`unavailable` 不得填零。

---

## 1. 轨迹文件的原样结构

### 1.1 物理形态

```
~/.dsh-beta/sessions/<project-slug>/<sessionId>/session.v4.jsonl.zstd
```

- **zstd 压缩的 JSONL**（不是纯文本，**不能 `tail`**，必须整文件解压）
- **第 1 行 = 文件头**（**没有 `seq`**，解析时必须先过滤）
- 第 2 行起 = 事件，一行一事件

### 1.2 文件头字段（第 1 行，实测样本）

```json
{"type":"session","version":4,"id":"session-63322f41-…","createdAt":1791803808979,
 "cwd":"/Users/xxxxxxyr/Documents/agenteval","isSeeded":false,
 "delegationDepth":0,"agentPreset":"standard"}
```

| 字段 | 实测取值 | 可解析信息 | 指标 | Span |
| --- | --- | --- | --- | --- |
| `id` | `session-<uuid>` | 会话标识 | 跨会话聚合主键 | `session` |
| `version` | `4` | 日志格式版本 | 兼容性门禁 | — |
| `createdAt` | ms 时间戳 | 会话创建时刻 | 会话总时长 | `session` |
| `cwd` | 工作区绝对路径 | 项目归属 | 按项目分组 | — |
| ⭐ `delegationDepth` | 样本主会话 `0`、子会话 `1` | 会话记录的委派层级；单凭此字段不判断 fork/fresh 或完整树深 | `delegationDepth` | 无需 span，头里直接可得 |
| `isSeeded` | `false` | 是否种子会话 | 排除种子会话 | — |
| `agentPreset` | `standard` | 预设 | 按预设分组 | — |

> `delegationDepth` 是会话层级的早期信号；样本中主/子会话取值不同，但分类为子会话或 fork 还应联合 `parentSession`/origin、种子事件和 team member 的 `context`。

### 1.3 事件信封字段（实测只有 5 个键）

| 字段 | 类型 | 实测 | 可解析信息 | 指标 | Span |
| --- | --- | --- | --- | --- | --- |
| `seq` | int | 单调递增 | **事件唯一句柄** | 所有证据引用的锚点 | 一切 span 的边界 |
| `time` | int ms | `Date.now()` 追加时刻 | 事件墙钟时刻 | 所有时延指标 | 一切 span 的起止 |
| `type` | str | 封闭词汇表 **59 类** | 事件语义 | 分族入口 | — |
| `data` | obj | 事件载荷 | 见 §2 | 见 §3 | — |
| `surfaceOp` | str \| obj | 见 §1.4 | 是否被复制/替换 | 去重、副本识别 | — |
| `sourceEventSeqs` | int[] | 见 §1.5 | surface 事件的显式派生来源引用 | 溯源边；不代替语义配对键 | — |

**实测信封形状分布**（`session-63322f41`，共 **3683** 条事件）：

| 信封形状 | 条数 | 占比 |
| --- | --- | --- |
| `[data, seq, time, type]` | 2333 | 63.3% |
| `[data, seq, sourceEventSeqs, surfaceOp, time, type]` | 693 | 18.8% |
| `[data, seq, surfaceOp, time, type]` | 657 | 17.8% |

⇒ **1350 条（36.7%）带 `surfaceOp`**，解析时不能当边角料忽略。

### 1.4 ⭐ `surfaceOp` 的真实形态与两种用途

我此前把它描述为 `{op:'replace',startSeq,endSeq}` 并一句话归因给 prune——**两处都错**。实测三态：

| 形态 | 条数（63322f41） | 含义 |
| --- | --- | --- |
| **`'append'`（字符串）** | **1337** | 正常追加到会话表面 |
| `{op:'replace', startSeq, endSeq}` | **13** | **替换**——分两种用途，见下 |
| 无 `surfaceOp` | 2333 | — |

`replace` 的 `startSeq/endSeq` 是**被替换的旧区间**，**事件自身的 `seq` 永远在区间之外**（新位置）。两种用途：

**A. 单点重发**（`startSeq == endSeq`，跨度 0）——把某个早先的事件在新位置重新发布：

| 触发者 | 事件类型 | 因果验证 |
| --- | --- | --- |
| **`compaction/prune`** | `tool/result` | 63322f41：prune 7 → 单点重发 **7/7** 命中 `prune.shadowedSeqs`<br>16e5940f：prune 27 → **27/27** 命中 |
| **系统提示更新** | `system/message` | seq=5557 替换 `[7,7]`（首个系统提示）；seq=6017 替换 `[5557,5557]`（替换前一版） |

⇒ 这解释了两个样本中 `tool/result` 数量多出的 7/27 条是 surface 重写副本，**数量不一致本身不能说明存在未配对调用**。
未配对数必须按 `callId` 配对，并从唯一调用耗时统计中排除结果重写；`sourceEventSeqs` 用于记录重写的派生来源。

**B. 区间替换**（大跨度）——用一条事件替换整段历史，**这才是压缩真正改动会话表面的动作**：

| 触发者 | 事件类型 | 因果验证 |
| --- | --- | --- |
| **`compaction/summary`** | `user/message` | 63322f41：6 次压缩 → 6 条区间替换，`shadowedRange` **6/6 逐位相同**（样本 `(9,488)` ↔ `(9,488)`）<br>16e5940f：8 次 → **8/8**（样本 `(8,460)` ↔ `(8,460)`） |

**⭐ 结构性结论：压缩有两条事件足迹**

1. `compaction/{start, summary, end}` —— **记录**这次压缩（6/8 条）
2. 一条带 `surfaceOp=replace` 的 `user/message` —— **真正把旧区间换成摘要**（6/8 条），
   其 `sourceEventSeqs` 列出被替换的**全部 surface 事件 seq**

⇒ **只数 `compaction/*` 会漏掉表面变更；只数 `replace` 会漏掉压缩记录。两者必须成对理解。**

### 1.5 ⭐ `sourceEventSeqs` = surface 事件的显式派生来源引用

- **在这批样本中只出现在 `tool/result`（687 条全部）与 `user/message`（6 条）**，别的事件类型没有；这是样本观察，不是跨版本保证
- 实测：`seq=18` 的 `tool/result` 携带 `sourceEventSeqs=[17]`，而 `seq=17` 正是 `tool/call`
- 指向类型统计（前 300 条）：`tool/call` 298、`tool/result` 2（链式）

⇒ **工具语义配对应以 `callId` 为主**（结果的 `message.source.callId` 对应调用的 `callId`）；
`sourceEventSeqs` 表示当前 surface 事件派生自哪些较早事件，是独立的溯源关系，不应泛化为一对一调用配对。
统计调用次数/耗时时还必须识别 `surfaceOp=replace` 的结果重写，避免把修剪后的重发结果算成新调用。

---

## 2. 逐事件字段清单（六组）

### 2.1 时延与结构

| 事件 | 实测次数 | 载荷键 | 关键字段 |
| --- | --- | --- | --- |
| `turn/start` | 26 | `{turn}` | — |
| `turn/end` | 26 | `{turn, reason}` | ⭐ `reason.kind` ∈ `completed\|aborted\|blocked\|error\|max-tokens\|interrupted\|forked` |
| `step/start` | 553 | `{turn, step}` | ⚠️ **载荷无 status** |
| `step/end` | 553 | `{turn, step}` | ⚠️ **载荷无 status**——成败必须从 `turn/end.reason.kind` 推 |
| `assistant/message` | 552 | `{turn, step, message, stream, usage}` / `+interrupted` | ⭐ `stream` 在 **1450/1450** 条中都有；`usage` 完整 |
| `assistant/attempt` | 11 | `{turn, step, stream}` | ⚠️ **只在失败/中止时追加**，不是「一次提供方请求」 |
| `request/header` | 14 | `{header:{config,tools}, reason}` | `reason` ∈ `initial\|series`；**是纪元头记录，不是每请求边界** |
| `request/context` | 1 | `{provider, model, contextWindow}` | ⭐ **`contextWindow: 262144`** |
| `system/message` | 1 / 全机 80 | `{turn, step, message}` | 基础系统提示**全文**（实测 9626/9630 字符），仅 turn 的 `step=1` |
| `user/message` | 110 | `{content, id, role, source}` | ⚠️ 键是 `content` 不是 `message`；`source.kind` |

### 2.2 工具

| 事件 | 实测次数 | 载荷键 | 关键字段 |
| --- | --- | --- | --- |
| `tool/call` | 680 | `{turn, step, callId, name, arguments}` | `callId` 配对键；`arguments` 是 JSON 字符串 |
| `tool/result` | 687 | `{turn, step, message}` / `+meta` | 全部带 `sourceEventSeqs` 溯源引用；按 `message.source.callId` 配对；`message.isError` 是样本中更完整的失败信号（`error` 字段有漏报） |

### 2.3 Agent Team

| 事件 | 实测次数 | 载荷键 | 关键字段 |
| --- | --- | --- | --- |
| `team/member` | 4 | `{member, teamId, version}` | `member = {id, name, description, provider, context, phase}`；`phase` 实测仅出初值一次 |
| `team/task` | 58 | `{task, teamId, version}` | ⭐ `task = {id, revision, subject, description, status, blockedBy, writeScopes}`——**全量快照** |
| `team/message/queued` | 85 | `{message, teamId, version}` | `message = {id, senderId, senderName, targetId, content}` |
| `team/message/delivered` | 85 | `{messageId, targetId, teamId, version}` | 配对：`queued.message.id ↔ delivered.messageId` |
| `subagent/catalog` | 2 | `{version, childId, childCreatedAt, mode, label}` | ⭐ **`childCreatedAt`** |
| `agent/inbox/spliced` | 174 | `{target, start, inserted}` / `+removedCount` | `target:'next-turn'`；`inserted[].source.{kind, rpcId, clientTimeZone}` |
| `tool-workflow/run-start·agent-start·agent-end·run-end` | 本机 0 | — | 主 agent 未用；`acquireSlot` 在 `agent-start` 之前 |

**`team/task` 实测分布**：`status` = pending 20 / in_progress 20 / completed 18；**`blockedBy` 非空 12 次**（样本 `['task-2']`）；`revision` 最大 **5**。

### 2.4 ⭐ 注入通道与收件箱（`user/message` + `agent/inbox/spliced`）

**这是本文件此前判断错的地方**：我说过「动态状态注入无事件」。实测**注入是可观测的**。

#### 2.4.1 `user/message.source.kind` = 注入通道分类器

`user/message` 载荷 = `{content, id, role, source}`。`source.kind` 实测分布（`session-63322f41`，110 条）：

**九种来源，分两大类**：**6 种经收件箱**（有等待）＋ **3 种直接注入**（无等待）。

##### A. 经收件箱的 6 种（`inserted[].source.kind` 实测只有这 6 种）

| kind | n | `source` 附带字段 | 含义 | 实测正文开头 |
| --- | --- | --- | --- | --- |
| `user` | 22 | `rpcId`、`clientTimeZone` | **真人插话** | `我想在dsh社区推广我的dsh评测插件…` |
| `team-message` | 40 | `teamId`、`messageId`、`senderName` | **队友发来的消息** | `Team message … from aeval-core → lead：关于「缺 DSH profile peer 检查」——已实现…` |
| `subagent-settled` | 20 | `form:'notice'`、`summary` | **子 agent 结束通知** | `Background subagent bf89b210… finished and will do no further work unless you send it more. Its closing message: …` |
| `tool-jobs` | 5 | `form:'notice'`、`summary` | **后台任务（jobs）状态通知** | `background job bash-7990 (bash: … rsync -a …)` |
| `goal` | 2 | `goalId`、`revision`、`round` | **目标轮次注入** | `<goal_round> Objective: "把 dsh-eval-control 的…"` |
| `tool-goal` | 1 | `form:'notice'`、`summary` | **目标完成通知** | `<goal_complete> Objective: "…"` |

⇒ 归三类：**人**（`user`）／ **协作对象**（`team-message`、`subagent-settled`）／ **系统自动化**（`goal`、`tool-goal`、`tool-jobs`）。

##### B. 不走收件箱、直接注入的 3 种

| `source.kind` | n | 附带字段 | 是什么 | 内容实测 |
| --- | --- | --- | --- | --- |
| `runtime-context` | 7 | `form:'snapshot'`、`sections[]` | 环境策略块 | 476 字符：`Current runtime context. This snapshot supersedes earlier…` + 文件策略 + 沙箱 + cwd。**不含 todo/goal** |
| `skill-catalog` | 7 | `form:'catalog'`、`entries[]` | ⭐ **技能目录注入** | 1060–1197 字符：`<system-reminder>A skill is a reusable…<available_skills>- archify: …`；变更时是 `The available skill catalog changed. This complete catalog replaces…` |
| `compact-checkpoint` | 6 | `compactionId` | ⭐ **压缩检查点回注** | **11,548 / 17,815 字符**：`This is an automatically generated checkpoint condensing an earlier span…`，**含 `todo` / `in_progress`** |

⇒ **注入事件真的存在**：
- 技能目录**内容**（含变更通知）**可见** —— 只有「模型为何选某个 skill」不可见；
- 环境策略、压缩检查点**可见**；
- todo 状态**没有专用注入事件**，但会**随 `compact-checkpoint` 文本一同回注**。

⚠️ **A 类才有 inbox 插入事件**——因此 `inboxInsertToUserEventMs` 只覆盖这 6 种，分母不要用全部 110 条 `user/message`。

#### 2.4.2 `agent/inbox/spliced` = agent 收件箱的每一次变更

载荷 `{target, start, inserted[{content, id, role, source}], removedCount?}`，实测 174 次：

| 维度 | 实测分布 |
| --- | --- |
| `target` | **`next-step` 126** / `next-turn` 48 |
| `inserted` 条数 | **1（90 次，插入）** / **0（84 次，移除）** |
| `removedCount` | 84 次有值：1（78） / 2（6） |
| `start` | 0（168 次） / 1（6 次） |
| `inserted[].source.kind` | `team-message` 40 / `user` 22 / `subagent-settled` 20 / `tool-jobs` 5 / `goal` 2 / `tool-goal` 1 |

⇒ **它是「插入 / 移除」的双向记录**，不是单纯入队：
- **插入**（`inserted` 非空）= 消息进入收件箱，等待被消费
- **移除**（`inserted` 空 + `removedCount`）= inbox 发生了移除（仅有数量，**不带 id**）；不能据此确认具体消息何时被 agent 读取或消费

#### 2.4.3 ⭐ 由它得到一个**事件间隔**：收件箱插入到消息事件

`inserted[].id` **90/90** 能与 `user/message.id` 精确配对（`id` 相同即同一条消息）⇒

```
inboxInsertToUserEventMs = user/message.time − agent/inbox/spliced.time
```

**完整分位（n=90，线性插值）**：

| 分位 | 值 | 人话 |
| --- | --- | --- |
| min | 34 ms | — |
| P50 | **74 ms** | 通常瞬间 |
| P75 | 4,964 ms | 5 秒 |
| P90 | 42,168 ms | 42 秒 |
| **P95** | **280,852 ms** | **4.7 分钟** |
| **P99** | **602,311 ms** | **10.0 分钟** |
| max | **652,752 ms** | **10.9 分钟** |
| 均值 | **35,442 ms** | ⚠️ **是中位数的 479 倍** |
| 标准差 | 121,383 ms | **比均值还大** ⇒ 极重尾 |

超过 1s：**36/90（40%）**｜超过 60s：**6/90（6.7%）**｜**总等待 3,189.8 秒 = 53 分钟**（单会话）。

##### ⚠️ 但 P95/P99 在 n=90 时**不能当指标报**

| 分位 | 插值位置 `(n−1)p` | 实际含义 |
| --- | --- | --- |
| P95 | `0.95×89 = 84.55` | 第 84–85 位 ⇒ **「最坏六条」的代表** |
| P99 | `0.99×89 = 88.11` | 第 88–89 位 ⇒ **基本就是最大的那一条** |

⇒ **P99 在 n=90 时不是分位数，是「最坏一条」的别名。**
**要报 P95/P99 必须先把 n 做大——这正是 Q1=B 跨会话聚合器存在的理由。**

**按来源（P50 / P90 / P95 / max，ms）**：

| kind | n | P50 | P90 | P95 | max |
| --- | --- | --- | --- | --- | --- |
| `team-message` | 40 | 70 | 72,518 | 340,326 | 596,077 |
| `user` | 22 | 48 | 147 | 174 | **652,752** |
| `subagent-settled` | 20 | **5,836** | 20,669 | 54,120 | 589,870 |
| `tool-jobs` | 5 | 3,171 | 18,948 | 23,437 | 27,925 |
| `goal` | 2 | 48 | 48 | 48 | 48 |
| `tool-goal` | 1 | 40 | 40 | 40 | 40 |

##### ⚠️ 混杂警告：不要按 `target` 切分

| kind | target | n | P50 |
| --- | --- | --- | --- |
| `user` | next-turn | 22 | 48 ms |
| `team-message` | next-step | 40 | 70 ms |
| `subagent-settled` | next-step | 20 | 5,836 ms |
| `tool-jobs` | next-step | 5 | 3,171 ms |

**`kind` 与 `target` 是绑定的**（用户↔`next-turn`，队友/子 agent↔`next-step`），
所以按 `target` 切分只是 `kind` 的**混杂代理**，会得出「`next-turn` 快、`next-step` 慢」的假结论。

#### 2.4.4 ⚠️ 由此**更正**一个早先结论：Team 排队有两跳，我只测了第一跳

| 跳 | 边界 | 实测 |
| --- | --- | --- |
| ① 投递到成员信箱 | `team/message/queued` → `delivered` | 中位 **120ms**，max 595ms |
| ② **插入到对应消息事件** | `agent/inbox/spliced` → `user/message` | 中位 **74ms**，**P90 42.2s，max 652.8s**；不直接等同于模型读取/消费时延 |

我早先说「Team 信箱排队实测很小 ⇒ 可测但非瓶颈」——**只看了第①跳**。
第②跳才是用户可感知的等待：**agent 跑到一半时插话，最长等了 10.9 分钟才被看到**。

#### 2.4.5 ⭐ 长尾样本中的时间重叠：涉及**长时间运行的工具**

把每条 inbox 插入到消息事件的间隔与所有 `toolCall` 区间做时间重叠分析（680 个可用 span）：

| 分组 | 与工具调用重叠比例（中位） |
| --- | --- |
| 等待 **>1s** 的 36 条 | **52%** |
| 等待 **≤1s** 的 54 条 | **1%** |

**最长 6 条里 5 条与工具 Span 重叠 100%**（这是相关性观察，不足以单独确认因果）：

| 等待 | 来源 | target | 被工具覆盖 | 阻塞工具 |
| --- | --- | --- | --- | --- |
| 652.8 s | `user` | next-turn | 81% | `send_message`、**`wait_agent`**、`bash` |
| 596.1 s | `team-message` | next-step | **100%** | **`bash`** |
| 589.9 s | `subagent-settled` | next-step | **100%** | **`bash`** |
| 370.2 s | `team-message` | next-step | **100%** | **`job_output`** |
| 338.8 s | `team-message` | next-step | **100%** | **`job_output`** |
| 210.1 s | `team-message` | next-step | **100%** | **`wait_agent`** |

**候选机制**：收件箱消息在步/轮边界被 claim；若相邻时段有长工具，事件间隔可能与其重叠：

> **`inboxInsertToUserEventMs` 可能与长工具时段重叠**；仅凭时间重叠不能证明工具是因果阻塞源。

**两个反直觉发现**：

1. ⭐ 有一条长间隔与 **`wait_agent`** Span 重叠；它提示可单独展示该工具的协作等待信号，但不能断言 `wait_agent` 是 inbox 间隔的唯一原因。
2. ⚠️ **我早先的因果解释是错的**：我说「`next-turn` 要等 turn 结束所以更久」，
   数据正好相反（`next-turn` P50=48ms < `next-step` P50=2,578ms）。
   样本中长工具重叠是候选解释；`target` 与来源类型混杂，不能据此确立普遍因果机制。

⇒ **指标应带重叠信息**，避免把「消息事件间隔期间有一个 10 分钟的 bash」直接归因为调度器延迟：

| 字段 | 作用 |
| --- | --- |
| `inboxInsertToUserEventMs` | 两条事件之间的观测间隔，不承诺等价于模型实际读取延迟 |
| `overlappingToolNames[]` | 与该区间有时间重叠的工具 Span |
| `toolOverlapShare` | 工具 Span 并集覆盖该间隔的比例；并行 Span 先取并集，不重复累加 |
| `inboxIntervalBySource` | 按来源分类的事件间隔分布 |
| `waitAgentOverlapMs` | 与 `wait_agent` Span 重叠的时长；证据等级 `inferred`，不命名为因果等待 |

### 2.5 状态与计划

| 事件 | 实测次数 | 载荷键 | 关键字段 |
| --- | --- | --- | --- |
| `todo/write` | 111 | `{todos}` **仅此一键** | `TodoItem = {content, status}`——**无 id、无优先级、无时间、无 turn** |
| `goal/change` | 20 | `{kind, version, operation, goal, roundsStarted, createdAt, updatedAt}` | `goal = {id, revision, objective, phase, maxGoalRounds}` |
| `deliverables/presented` | 114 | `{turn, callId, files}` | `files[] = {path, description}`；⭐ `callId` 是**显式**关系边 |
| `workspace/changes` | 182 | `{turn}` **仅此一键** | ⚠️ **不说改了哪些文件** |
| `model/selection` | 27 | `{provider, model}` 23× / `+reasoningEffort` 4× | 模型切换轨迹 |
| `permission/preset` | 34 | `{preset}` | 实测含 `danger-full-access` |
| `sandbox/mode` | 64 | `{mode}` 27× / `{mode, source}` 37× | ⭐ `source:'delegation'` = 子会话继承父沙箱 |

### 2.6 压缩（两个机制，**不得相加**）

| 事件 | 实测 | 载荷键 |
| --- | --- | --- |
| `compaction/start` | 6 / 8 | `{compactionId, turn}`（`sourceCommandId?`） |
| `compaction/summary` | 6 / 8 | `{compactionId, summary, shadowedRange, shadowedSeqs, shadowedTokenCount, provider, model, maxTokens, usage, rawOutput, llmStreamCall}` |
| `compaction/end` | 6 | `{compactionId, turn}`（`error?` 本会话未出现） |
| `compaction/prune` | 7 / 27 | `{shadowedRange, shadowedSeqs, shadowedTokenCount}`——**无 compactionId** |

- `shadowedRange = {start, end}`（实测 `{start:8,end:460}`）
- `shadowedSeqs` 长度 ≠ `end−start`（实测 167 条 vs 452 区间）
- `shadowedTokenCount / usage.totalTokens` 可命名为 `reclaimedTokensPerCallToken`（本次压缩调用每消耗 1 token 对应覆盖的历史 token 数）；它是调用 token 效率，**不是压缩比**。缺少可比的压缩前后 token 总量时不报告 compression ratio。

### 2.7 等待与重试

| 事件 | 实测 | 载荷键 |
| --- | --- | --- |
| `llm/retry` | 10 | `{delayMs, failure, maxRetries, mode, policyKey, provider, retry, retryId, step, turn}` |
| `llm/retry-started` | 10 | `{retry, retryId, step, turn}`——**按 `retryId` 配对** |
| `approval/asked` | 2 | `{id, toolName, callId?, reason?}` |
| `approval/decided` | 2 | `{id, outcome}`——**按 `id` 配对** |
| `approval/policy` | 1/会话 | `{policy}`——实测 `"ask"` |

`policyKey` 实测 = `["normal",5,["EMPTY_RESPONSE","RATE_LIMIT","SERVER","TIMEOUT","TRANSPORT"],500,10000,0.1]`
⇒ `[mode, maxRetries, 可重试码, initialDelayMs, maxDelayMs, jitterRatio]`。

---

## 3. 四段映射链（核心）

> 读法：**原始字段 → 可解析信息 → 指标 → 落在哪个 Span**。

### 3.1 时延与结构

| 原始字段 | 可解析信息 | 指标 | Span |
| --- | --- | --- | --- |
| `step/start.time` ↔ `assistant/message.stream[].time` 首 chunk | step 开始到首 chunk 的间隔；日志无独立 provider-send 边界 | `stepStartToFirstChunkMs` | `llmRequest` |
| `assistant/message.stream[]` 首末 `time` | 流式输出跨度，不等同于纯模型解码耗时 | `streamSpanMs` | `llmRequest` |
| `stream[].usage` / `assistant/message.usage` | 输入/输出/缓存 token | `tokenIn/Out/CacheRead` | `llmRequest` |
| `step/end.time` → 下一步 `step/start.time` | 步间墙钟间隔（可能含组装、调度或其他未观测等待） | `interStepGapMs` | `interStepGap` |
| `turn/start.time` → 首个 `step/start.time` | 首步启动前间隔，组成原因未必可拆 | `turnToFirstStepGapMs` | `turn` |
| `turn/end.reason.kind` | 轮次结局 | `turnOutcomeMix` | `turn` |
| ⚠️ `step/end` **无 status** | 步骤成败**不在事件里** | 回落 `turn/end.reason.kind` | — |

**实测**：`[step/end(N)→step/start(N+1)]` n=1415，min 11 / 中位 30 / P90 37 / **max 118737 ms**。

### 3.2 工具

| 原始字段 | 可解析信息 | 指标 | Span |
| --- | --- | --- | --- |
| `tool/call.callId` ↔ `tool/result.message.source.callId` | 工具调用语义配对；结果重写按 `surfaceOp` 去重 | `unpairedCalls`（按该规则复核样本） | — |
| `tool/result.sourceEventSeqs` | 派生来源引用；与调用配对关系分别保存 | `toolResultLineageRefs` | `toolCall` |
| `tool/call.name` | 工具身份 | ⭐ **检索类语义分类** | `toolCall` |
| `[tool/call, tool/result]` | call 事件到结果事件的墙钟跨度，含运行时调度等可能开销 | `toolCallElapsedMs` | `toolCall` |
| 同 step 多个 `toolCall` 区间重叠 | 并行度（实测 19 步重叠） | `toolConcurrency` | `step` |
| `tool/result.message.isError` | ⭐ **失败权威来源**（`error` 字段漏 2 例） | `toolFailureRate` | `toolCall` |
| `(name, arguments)` 去重序列 | 重复调用 | `loopDetected`、`repeatToolReminder` | `step` |

### 3.3 Agent Team

| 原始字段 | 可解析信息 | 指标 | Span |
| --- | --- | --- | --- |
| 文件头 `delegationDepth` | 会话记录的委派层级 | `delegationDepth`（不可单独判定 fork/fresh） | — |
| header `parentSession`/origin、种子事件及成员 `context` | 父子血缘、继承/分叉证据 | `childLineage`、`forkContextMix`（证据不足时 unknown） | — |
| `team/member.member.{id,name,phase}` | 成员身份与阶段 | `membersSpawned` | `member` |
| `team/message/queued.message.id` ↔ `delivered.messageId` | **信箱投递等待**（第①跳） | `mailboxWaitMs`（实测中位 **120ms**、max 595ms） | `mailboxWait` |
| ⭐ `agent/inbox/spliced.inserted[].id` ↔ `user/message.id` | inbox 插入事件到对应消息事件的间隔（第②跳，**90/90 样本可配对**） | **`inboxInsertToUserEventMs`**（样本中位 **74ms**；小样本 P95/P99 不稳定） | `inboxInsertToUserEvent` |
| 间隔与 `toolCall` 区间求交 | 与工具 Span 的时间重叠，不直接证明阻塞因果 | **`overlappingToolNames`**、**`toolOverlapShare`**（样本观察） | `inboxInsertToUserEvent` |
| `tool/call.name=='wait_agent'` 的重叠 | 与 `wait_agent` Span 重叠的时间 | **`waitAgentOverlapMs`**（证据等级 `inferred`） | `inboxInsertToUserEvent` |
| `user/message.source.kind` | 消息来源分类 | `inboxIntervalBySource`（6 种带 inbox 插入的来源） | `inboxInsertToUserEvent` |
| `agent/inbox/spliced.target` | 插入目标（⚠️ 与 `kind` 混杂，勿单独作因果解释） | `inboxTargetMix` | `inboxInsertToUserEvent` |
| `team/task.task.{id,revision,status}` | 任务状态快照 | `taskStateMix`、`taskRevisions`（max **5**） | `teamTask` |
| `team/task.task.blockedBy` + 两次快照 `time` | ⭐ **依赖等待**（实测 12/58 非空） | `blockedByWaitMs` | `taskDepWait` |
| `subagent/catalog.childCreatedAt` ↔ 子会话首事件 `time` | ⭐ **子 agent 供给延迟** | `childProvisionMs` | `childProvision` |
| `sandbox/mode.source=='delegation'` | 继承关系 | `forkInheritance` | — |
| `deliverables/presented.callId` | 产物 ↔ 工具调用 | `deliverableProvenance` | `toolCall` |
| `agent/inbox/spliced.target=='next-turn'` | 用户消息排队 | `steeringQueueDepth` | — |

### 3.4 状态与计划

| 原始字段 | 可解析信息 | 指标 | Span |
| --- | --- | --- | --- |
| `todo/write.todos`（全量快照） | 计划状态 | `planWrites` | `planSnapshot` |
| 相邻快照差集 | 新增/删除条目 | `planChurn` | `planSnapshot` |
| 差集 + **上一份是否 completed** | ⭐ 分段 vs 推翻 | **`planRewritesAfterComplete`** vs **`planRewritesMidPlan`** | `planSnapshot` |
| `goal/change.goal.revision` | 目标变更次数 | `goalRevisions` | `goal` |
| `goal/change.goal.{phase, roundsStarted, maxGoalRounds}` | 目标进度 | `goalProgress` | `goal` |
| `workspace/changes.turn`（**仅 turn**） | 哪些 turn 动了文件 | `workspaceChangeTurns` | `turn` |
| `deliverables/presented.files[].path` | 交付物 | `deliverablesCount` | — |

**实测归因**（`session-16e5940f`，10 次写入）：

| 类型 | 次数 |
| --- | --- |
| 纯状态更新（内容不变，只改 status） | **5** |
| 整份重写/生成 | 3 |
| 首次建立 / 小幅追加 | 1 / 1 |

3 次重写中 **2 次发生在上一份全部完成之后**（正常分段），**1 次在未完成时推翻**（真信号）。

### 3.5 压缩

| 原始字段 | 可解析信息 | 指标 | Span |
| --- | --- | --- | --- |
| `compaction/start.compactionId` ↔ `end.compactionId` | 压缩周期 | `compactionCycles` | `compaction` |
| `[start, end]` | 压缩墙钟 | `compactionMs` | `compaction` |
| `shadowedRange` / `shadowedSeqs` | 遮蔽范围 | `shadowedSeqs` | `compaction` |
| `shadowedTokenCount` | 回收 token | `tokensReclaimed` | `compaction` |
| `shadowedTokenCount / usage.totalTokens` | 被覆盖 token 数 / 本次压缩调用总 token 数；作为调用 token 效率，不称压缩比 | `reclaimedTokensPerCallToken` | `compaction` |
| `usage` | 压缩本身的开销 | `compactionCost` | `compaction` |
| ⭐ `compaction` 区间落在步间/首步启动前间隔内 | 压缩 Span 对该间隔的覆盖时长/比例；不宣称整段间隔都是组装耗时 | `compactionInGapMs`、`compactionGapShare` | `interStepGap` / `turn` |
| `compaction/prune`（**无 compactionId**） | **另一机制** | `pruneCycles`（**不得与 cycles 相加**） | — |

**实测归因 100%**：8 次 `compaction/start` **全部**落在组装间隙内，逐条
50,630/50,583、41,992/41,946、44,180/44,131、71,044/70,988、67,641/67,582、74,084/74,030、**118,737/118,681**、73,417/73,372 ms
⇒ **单会话总 541.7s = 9.0 分钟**，而该会话 `llm/retry = 0`。

### 3.6 等待与人工

| 原始字段 | 可解析信息 | 指标 | Span |
| --- | --- | --- | --- |
| `llm/retry.delayMs` | 退避时长 | `retryBackoffMs`（实测 **32.5s**） | `retry` |
| `llm/retry.retryId` ↔ `retry-started.retryId` | 重试周期 | `retryAttempts` | `retry` |
| `llm/retry.failure.code` | 失败分类 | `retryFailureMix`（实测全 `TRANSPORT`） | `retry` |
| `llm/retry.policyKey` + `maxRetries` | 策略解析 | `retryExhausted` | `retry` |
| ⭐ `approval/asked.id` ↔ `decided.id` | **等人时长** | **`approvalWaitMs`** | `approvalWait` |
| `approval/decided.outcome` | 审批结果 | `approvalOutcomeMix` | `approvalWait` |
| `turn/end.reason.kind=='blocked'` | 等用户输入 | `blockedWaitMs` | `turn` |

**实测**：审批等待 **63,191 ms** 与 **30,360,365 ms（8.4h）** 各一次 ⇒ 归入 **`humanWaitMs`**，
**排除**出 agent 侧延迟与分位数（一次午休否则毁掉所有 P50/P95）。

---

## 4. Span 定义表

统一形状：`spanRef = (sessionId, kind, key, startSeq, endSeq)`。

| Span kind | 边界（起 → 止） | key | 可否嵌套 |
| --- | --- | --- | --- |
| `session` | 文件头 `createdAt` → 末事件 `time` | `sessionId` | 含全部 |
| `turn` | `turn/start` → `turn/end` | `turn` | 含 step |
| `step` | `step/start` → `step/end` | `turn.step` | 含 llmRequest + toolCall |
| `llmRequest` | `step/start` → `assistant/message` | `turn.step` | 含 retry |
| `retry` | `llm/retry` → `llm/retry-started` | `retryId` | 在 llmRequest 内 |
| `toolCall` | `tool/call` → `tool/result`（按 `callId`；surface 重写去重） | `callId` | 在 step 内，可并行 |
| `turnToFirstStepGap` / `interStepGap` | `turn/start`→`step/start(1)`，或 `step/end(N)`→`step/start(N+1)` | 目标 step | 在 step 之外；不预设间隔由上下文组装独占 |
| `compaction` | `compaction/start` → `compaction/end` | `compactionId` | 样本中嵌在步间间隔内 |
| `mailboxWait` | `team/message/queued` → `delivered` | `messageId` | 跨成员（第①跳） |
| `inboxInsertToUserEvent` | `agent/inbox/spliced`（插入）→ `user/message`（同 `id`） | `message.id` | 事件间隔；不宣称模型已读取 |
| `approvalWait` | `approval/asked` → `decided` | `approvalId` | 跨用户 |
| `teamTask` | `team/task` 两次快照之间 | `taskId` | 跨成员 |
| `taskDepWait` | `blockedBy` 非空 → 转 `in_progress` | `taskId` | 在 teamTask 内 |
| `childProvision` | `subagent/catalog.childCreatedAt` → 子会话首事件 | `childId` | 跨会话 |
| `planSnapshot` | 单点事件（无时长） | 序号 | — |

**时延记账纪律**（贯穿全部指标）：

1. **禁止跨并行 Span 求和**——父含子，并行不可加（实测 19 步工具区间重叠）；计算重叠覆盖率时先取区间并集。
2. **父 Span 时长不得与子相加**。
3. **`humanWaitMs` 与 `resourceWaitMs` 强制分列**。
4. `compaction` 作为独立事件/Span 计一次；可报告其对相关 gap 的覆盖时长，不把整个 gap 归入压缩，也不重复计入模型请求时长。

---

## 5. ❌ 不可观测清单（附原因，不要再去挖）

| 项 | 原因 |
| --- | --- |
| provider 实际排队时长 | 无 provider-send 与 provider-queue 边界事件；`step/start` 到首 chunk 只能作为代理跨度，不能称为纯 TTFT 或拆出 provider 排队 |
| 工具并发槽位等待 | `maxParallelToolCalls`（**默认 10**）在 `[tool/call, tool/result]` **内部** |
| Workflow/PTC 槽位等待 | `acquireSlot()` 在 `tool-workflow/agent-start` **emit 之前** |
| 会话写锁争用 / 转向队列 | `session/writer-held`、`agent-busy`、`conflict`、`queue-item-not-found`、`steer-unavailable` 是 **API 错误码，不落日志** |
| 宿主持久化**读** | load/resume 在**第一条例事件之前**完成；官方 59 类无 `session/load\|resume` |
| 检索内部（命中数、排序、相似度、rerank、召回率） | 检索是**工具**，只返回最终文本 |
| **skill 目录的「选择理由」** | ⚠️ 目录**内容**其实可见（`user/message.source.kind='skill-catalog'`，7 条）；不可见的是**模型为何挑中某一个** |
| **todo/goal 的专用注入事件** | ⚠️ 没有专用事件，但状态会**随 `compact-checkpoint` 文本回注**（6 条，含 `todo`/`in_progress`）；环境块由 `runtime-context` 注入 |
| 收件箱移除的**具体是哪些消息** | 移除事件只带 `removedCount`（1/2），**不带 id** ⇒ 不能将移除事件与具体消息或消费时刻配对；可单独关联插入 ID 与同 ID 的 `user/message` 事件 |
| 上下文阈值 `thresholdTokens` | 仅在 `dsh-compaction-basic/lib/index.js:838` 打日志。**但 `contextWindow` 可得（262144）**，故 0.8× 上界可算 |
| 压缩触发原因（压力 vs 溢出） | 不在任何事件；只能自关联 `agent/request-error` |
| 步骤级成败 | `step/end` 载荷只有 `{turn, step}` |

---

## 6. 反例留档（防止重复推导）

本会话中以下结论曾被实测**推翻**，写在此处以避免再次走进同一条路：

| 曾以为 | 实测真相 |
| --- | --- |
| `tool/call=1478` vs `tool/result=1505` ⇒ 27 个未配对 | 27 条是 `surfaceOp=replace` 的**结果重写**；数量差不等于未配对数。按 `callId` 语义配对，并在调用/耗时统计中排除重写副本；`sourceEventSeqs` 另作派生来源边 |
| `assistant/attempt` = 一次提供方请求 | **只有失败/中止轮才追加**（553 step → 11 attempt） |
| 上下文构建 = `[step/start, request/header)` | `request/header` 是**纪元头记录**（14 次 vs 553 step）；组装区间是 `[step/end(N), step/start(N+1))` |
| 上下文组装不可拆 | **可拆**，且压缩的 9 分钟就藏在里面 |
| 状态存储整行 ❌ | agent 状态（todo/goal/产物）**完全可见**；只有宿主持久化的**读**不可得 |
| 整份重写计划 = 计划不稳定 | 3 次中 **2 次是上一份完成后的正常分段** |
| `todo/write` 是「任务记忆」 | DSH **无记忆层**；它是**计划外化**，7/10 是纯状态流转 |
| `request/header` 里 17 次 todo 字样 = 状态注入 | **假阳性**：全在工具定义的 `status.enum` 与描述里 |
| 分位数只能在 run 级 | step 级 n 可达 1415，**粒度依 N 而定** |
| `surfaceOp=replace` 是「prune 造成的副本」 | 分**两种用途**：单点重发（prune 造成，7/7 与 27/27 命中 `shadowedSeqs`）与**区间替换**（压缩造成，6/6 与 8/8 匹配 `shadowedRange`） |
| Team 信箱排队「实测很小 ⇒ 非瓶颈」 | **只测了第①跳**（queued→delivered，中位 120ms）。第②跳是插入至对应消息事件的间隔，样本 P90 42.2s、max 652.8s；不直接等同于模型消费时延 |
| `next-turn` 消息要等 turn 结束 ⇒ 更久 | 样本中 `next-turn` P50=48ms < `next-step` 2,578ms；来源类型与 target 混杂。长工具重叠是候选解释，不是因果证明 |
| 小样本 P95/P99 可直接作为稳定基线 | n=90 时 P99 近似最大值、P95 由最坏少数样本主导；优先展示样本数、分布和原始区间，跨会话聚合后再评估分位数稳定性 |
| 动态状态注入不可观测 | **注入可观测**：`user/message.source.kind` = 注入通道分类器（`runtime-context` 7 / `skill-catalog` 7 / `compact-checkpoint` 6） |
| `agent/inbox/spliced` 只是「用户消息排队」 | 是**双向**记录：90 次插入 + 84 次移除；来源含 `team-message` 40 / `subagent-settled` 20，**不只是用户** |

---

## 7. 精度与版本限制

1. **`time` 精度**：`Date.now()` 毫秒；亚毫秒不可分辨 ⇒ 极短 span（如结果整理实测中位 1ms）**测得出但无分析价值**。
2. **统计口径依 N 而定**：`N < 30` 不出分位数，只出 min/中位/max。
3. **版本差异是硬约束**：同一台机器，`session-63322f41` 有 **34** 类事件、`session-16e5940f` 只有 **27** 类；
   `assistant/attempt` 11 vs 0，`llm/retry` 10 vs 0。**所有指标必须标注所依据的 DSH 版本。**
4. **事件词汇表封闭**：读路径拒绝未知类型（除非 `ignorable: true`）⇒ **绝不自造事件类型**；
   未知类型一律进 `unknownEventTypes[]`。
5. **投影状态必须有界**：`checkpoint(session)` 会持久化投影状态，故指标状态不得随会话长度无界增长；
   明细放 `evidence`，状态只留句柄。
