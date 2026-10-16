# 轨迹规范化与跨实现 Fixture 契约 v1

> 目的：规定 DSH 实时分析（TypeScript）与 aeval 离线复算（Python）共用的数据模型、转换边界、fixture 组织方式和逐字段一致性规则。本文是插件侧的设计/接入说明；共享契约的正式维护归属在 aeval。
> 指标 ID、公式、用户解释及证据边界以 [`trajectory-metrics-contract.md`](trajectory-metrics-contract.md) 为唯一语义来源；本文件规定两端如何把 DSH 事实转换成可复算输入和输出。
> 目标运行时：DSH `0.2.0-rc.2`。本契约不把该版本的字段形状外推到其他版本。

## 1. 两端共同遵循的转换流程

```text
DSH committed events + session headers + sealed evidence metadata
                         │
                         ▼
                RawEventEnvelope
                         │ normalize (same rules)
                         ▼
              NormalizedTrajectory v1
                         │ metric fold (same semantics)
                         ▼
             MetricSnapshot v1 + quality
```

TS 和 Python 可以有不同的解析器与内部数据结构，但必须在上述两个边界逐字段相同：

1. 输入边界：同一 DSH 版本、同一 session 头信息、同一事件前缀形成相同规范化轨迹。
2. 输出边界：同一规范化轨迹和指标契约版本形成相同指标快照，包括状态、值、单位、分母、覆盖情况、证据引用和质量标记。

规范化不是另一份“官方事件日志”，也不覆盖原始事件。原始事件仍是证据；规范化记录只保留指标所需的有类型事实和原始引用。

## 2. 输入事件包

Fixture 的顶层结构固定为：

```json
{
  "fixtureVersion": 1,
  "fixtureId": "tool-error-retry-basic",
  "source": {
    "dshVersion": "0.2.0-rc.2",
    "sessionSchema": "session.v4",
    "metricContractVersion": "1.1",
    "normalizationVersion": "1",
    "redaction": "synthetic"
  },
  "sessions": [
    {
      "sessionId": "s-root",
      "header": { "parentSessionId": null, "depth": 0 },
      "complete": false,
      "observedThroughSeq": 3,
      "events": []
    }
  ],
  "options": { "asOfTimeMs": 4000 },
  "expected": {
    "normalized": {},
    "metrics": {}
  }
}
```

### 输入约束

- `events` 是 DSH 官方 reader 得到的事件对象数组，保留原始字段，不先转成 ATIF 再丢失 DSH 扩展字段。
- 每个事件至少有 `seq`, `time`, `type`, `data`。事件在单个 session 内按 `seq` 升序输入；seq 缺口、重复、逆序属于 fixture 错误或被测质量异常，不能静默排序修复。
- `time` 按目标 DSH 版本的官方定义解释。规范化统一输出整数毫秒；若输入精度更细，按十进制四舍五入到最近 1 ms，恰好半毫秒时远离零。禁止使用本地时区或浮点秒参与跨语言比较。
- `complete` 表示 fixture 是否包含该 session 截止结束的全部事件；`observedThroughSeq` 是输入前缀水位。缺失结束事件不能被误认为结束时的零耗时。
- 多 session fixture 按 `sessions[].sessionId` 字典序输出；每个 session 内事件仍按 seq 顺序。跨 session 同时间事件只按 `(timeMs, sessionId, seq)` 稳定排序展示，排序不代表因果。
- 事件载荷必须合成或脱敏。默认不得将真实 prompt、工具参数、工具输出正文、用户文件路径、token 或凭据放入共享 fixtures。
- `options.asOfTimeMs` 只允许用于实时前缀快照；表示观测时点，不得用来伪造 span 结束事件。没有该值时，不计算“当前忙闲”之类依赖当前时点的字段。

## 3. 规范化轨迹对象

规范化输出采用 aeval-owned `CanonicalTrajectory` v1 稳定 JSON；它序列化在 `extra.aeval.trajectory`（或以后等价 sidecar）中。原始事件仅作为 fixture 输入和 `extra.dsh.events` 证据，不复制到 canonical 输出的 `events[]`。所有对象的字段集合由版本控制，未支持的可选字段省略，不能在一端输出 `null`、另一端省略。字段、对象边界和实体端点规则以 aeval 的 [CANONICAL-TRAJECTORY-CONTRACT-v1.md](../../aeval/docs/internal/CANONICAL-TRAJECTORY-CONTRACT-v1.md) 与模型实现为准。

```json
{
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
```

`metricContractVersion` 属于每个指标结果 envelope，不是 canonical source 的字段；规范化 schema 与指标公式版本分别演进。

### 3.1 Session 与 EventRef

Session 记录包含 `sessionId`, `parentSessionId?`, `agentId?`, `teamId?`, `complete`, `observedThroughSeq?`。只有 header/lineage 中明确提供的 parent 才建立父子关系；depth 不足以推导 parent。parent 可在本 artifact/session 子树之外，此时只保留显式 ID，不补建缺失 session。

所有证据引用使用：

```json
{ "sessionId": "s-root", "seq": 3 }
```

不能只用 seq，因为 seq 只在 session 内唯一。每个 canonical fact 最少包含 `factId`, `kind`, `domain`, `timestampMs`, `eventRefs`, `evidenceLevel`；只复制指标实际需要的安全字段。事件正文、参数等不自动进入该对象。

### 3.2 Typed facts

规范化事实使用显式 `kind` 和执行 `domain`，不得根据字段是否存在猜测种类：

| 事实类型 | `attributes` 最小字段（另含通用 fact 字段） | 主要来源/配对规则 |
| --- | --- | --- |
| `tool_call` | `callId`, `toolName`, `turn`, `step` | `tool/call`; 不复制 arguments |
| `tool_result` | `callId?`, `isError?`, `turn`, `step` | `tool/result.message.source.callId` 与 `message.isError`; surface replacement 副本按 source event identity 去重 |
| `compaction_start` | `compactionId`, `turn?` | `compaction/start` |
| `compaction_summary` | `compactionId`, `shadowedTokenCount?`, `inputTokens?` | `compaction/summary`; raw summary 内容不得复制 |
| `compaction_end` | `compactionId`, `errorPresent` | `compaction/end`; 只记是否有 error，不保留原始错误文本 |
| `prune` | `shadowedTokenCount?` | `compaction/prune`; 与摘要压缩分开统计 |
| `model_retry` | `retryId`, `turn`, `step`, `retryNumber?`, `delayMs?` | `llm/retry*`; failure message 仅按契约需要转成白名单类别 |
| `team_member_snapshot` | `teamId`, `memberId`, `memberName?`, `phase?` | `team/member`; 保存 whole-state 快照，按版本化 reducer 产生变化 |
| `team_task_snapshot` | `teamId`, `taskId`, `subject?`, `status?`, `blockedBy[]` | `team/task`; subject 属允许的 UI 摘要，不能从文本推依赖 |
| `team_message_queued` | `messageId`, `senderId?`, `targetId?` | `team/message/queued`; message body 不复制 |
| `team_message_delivered` | `messageId`, `targetId?` | `team/message/delivered`; 以 message ID 配对 |

对无法识别的事件，不生成 Typed fact；记录 `unknown_event_type` 质量项，保留其 `EventRef` 与原始类型名。关键字段缺失时生成 `missing_required_field`，受影响指标进入 unavailable/incomplete，不按 0 处理。每项 fact 的 `eventRefs` 必须回指原始事件；fact ID 在同一规范化版本中稳定且唯一。

### 3.3 Span

```json
{
  "spanId": "tool:s-root:call-1",
  "sessionId": "s-root",
  "domain": "tool",
  "kind": "tool_call",
  "key": "call-1",
  "startRef": { "sessionId": "s-root", "seq": 2 },
  "startTimeMs": 2000,
  "status": "open",
  "evidenceLevel": "derived"
}
```

`status` 只能是 `open`, `closed`, `incomplete`。闭合 span 增加 `endRef` 与 `endTimeMs`。打开的活动单元是截至当前输入仍没有合法结束事件；输入已 complete 但结束缺失时标记 `incomplete`。若出现重复 start、孤立 end、时间倒退或跨 session 错配，记录质量项并按指标契约指定规则处理，不采用“最后写入覆盖”。

工具调用仅按唯一 `callId` 配对；Team 消息仅按唯一 `messageId` 配对；压缩生命周期仅按 `compactionId` 配对。ID 作用域均为 session，除非 DSH 明确保证跨 session 唯一。不得只按工具名或相近时间合并事实。

### 3.4 Relations

关系端点可以是事件引用或 canonical entity 引用（每端恰选其一）。事件间关系格式：

```json
{
  "fromRef": { "sessionId": "s-root", "seq": 1 },
  "relationType": "invokes",
  "toRef": { "sessionId": "s-root", "seq": 2 },
  "evidenceRefs": [{ "sessionId": "s-root", "seq": 1 }, { "sessionId": "s-root", "seq": 2 }],
  "evidenceLevel": "derived"
}
```

只可生成指标契约登记的关系类型。Team task entity 间的 `blocked_by` 必须由显式依赖字段支撑；`overlaps` 只表示时间区间相交，不能转成阻塞或因果。`delegates_to` 需显式 lineage；跨 session 活动重叠不建立委派边。

实体间依赖关系示例：

```json
{
  "fromEntity": { "entityType": "task", "entityId": "task-2" },
  "relationType": "blocked_by",
  "toEntity": { "entityType": "task", "entityId": "task-1" },
  "evidenceRefs": [{ "sessionId": "s-root", "seq": 8 }],
  "evidenceLevel": "observed"
}
```

## 4. 指标结果 envelope

每个指标每个分析对象输出一个统一 envelope：

```json
{
  "metricId": "tool.call_elapsed_ms",
  "subject": { "sessionId": "s-root" },
  "status": "available",
  "value": { "count": 1, "total": 1200, "unit": "ms", "samples": [1200] },
  "coverage": { "observed": 1, "expected": 1, "ratio": 1.0 },
  "denominator": { "value": 1, "unit": "calls" },
  "evidenceRefs": [{ "sessionId": "s-root", "seq": 1 }, { "sessionId": "s-root", "seq": 2 }],
  "qualityRefs": [],
  "evidenceLevel": "derived",
  "contractVersion": "1.1"
}
```

固定字段为 `metricId`, `subject`, `status`, `value`, `coverage`, `denominator`, `evidenceRefs`, `qualityRefs`, `evidenceLevel`, `contractVersion`。无适用分母时 `denominator` 仍输出 `{ "value": null, "unit": "..." }`；value 不可用时 `value: null`，不得用 0 代替。

`status` 枚举：

| 状态 | 含义 |
| --- | --- |
| `available` | 输入完整到足以按契约计算；0 是有效测量值 |
| `partial` | 有部分有效样本，但覆盖不完整；必须带 coverage 和质量引用 |
| `incomplete` | 指标受 open/incomplete span 或缺失生命周期边界影响，不能当完整结果解释 |
| `unavailable` | 版本/字段/证据不足，无法计算；value 为 null 并给出原因 |
| `unsupported` | 当前规范化器明确不支持该 DSH 版本或事件语义；value 为 null |

数值约定：计数和毫秒为整数；比例/率内部以十进制值计算，序列化为最多 6 位小数并去掉末尾零；NaN/Infinity 禁止。数组的排序规则由指标定义固定，缺省按引用 `(sessionId, seq)` 排序。不得比较语言自带浮点打印结果。

## 5. 仓库职责与 Fixture 目录

aeval 是评测底座和共同规范化轨迹语义的所有者。跨后端的数据模型、指标结果 envelope、golden fixture 输入及期望输出由 aeval 维护；插件实现 DSH 原始事件到共同模型的 TypeScript adapter，并在开发/CI 中消费 aeval 发布的契约与 fixture。权威内容不从插件仓库反向同步到底座。

仓库职责边界：

| 内容 | 权威维护方 | 另一侧职责 |
| --- | --- | --- |
| 规范化轨迹 schema、稳定指标 envelope、golden fixture 输入与 expected | aeval | 插件读取并按版本实现，不另建 golden |
| 指标 ID、跨后端公式、缺失/状态/证据规则 | aeval 的共同契约；产品展示文案由插件引用 | 插件不得定义语义不同的同名指标 |
| DSH 原始事件字段映射、DSH 版本适配与实时 projection glue | dsh-eval-control | aeval 的 DSH adapter 可按共同 schema 独立实现 |
| 普通用户 UI、DSH session 子树发现和授权处理 | dsh-eval-control | aeval 离线读取 sealed evidence 并复算 |

正式文件位置约定为 aeval 仓库：

```text
aeval/docs/internal/trajectory-normalization-fixture-contract.md
aeval/tests/fixtures/trajectory_contract/v1/
  manifest.json
  events/...
  expected/...
```

本插件仓库中的同名文档是插件开发和设计评审使用的对齐副本，不能作为独立 authority。对齐合入时更新本文并记录对应的 aeval commit 和契约版本；若两侧文档不一致，以 aeval 固定版本的契约为准，并通过同步差异修正插件副本。不得让两端各自维护同名但内容不同的权威样本。

插件测试消费 fixture 的推荐方式是开发/CI 环境按锁定的 aeval git revision 检出或下载 fixture bundle；插件发布包和普通用户安装过程不依赖 aeval，也不携带评测数据。插件侧锁定清单记录 `aevalCommit`, `fixtureManifestSha256`, `normalizationVersion`, `metricContractVersion`, `dshVersion`。升级顺序是：aeval 先更新 schema/fixture 和 hash 并合入；插件再更新 aeval revision pin，实现 adapter 并通过共同 golden；若 CI 无法跨仓库取文件，可由 aeval 在同一 commit 发布带 manifest/hash 的 fixture bundle，插件只锁该 bundle 版本。这里的同步是 aeval → 插件测试环境的消费关系，不是两边复制后各自修改。

aeval 权威 fixture 的建议目录：

```text
aeval/tests/fixtures/trajectory_contract/v1/
  manifest.json
  events/
    single-session-basic.json
    compaction-multiple-cycles.json
    tool-error-retry.json
    team-fanout-messages.json
    team-busy-idle-concurrency.json
    dependency-critical-chain.json
    open-prefix-and-incomplete.json
    unknown-event-and-missing-fields.json
    fork-lineage-multisession.json
  expected/
    <fixture-id>.normalized.json
    <fixture-id>.metrics.json
```

`manifest.json` 为每个 fixture 登记 `fixtureId`, `input`, `expectedNormalized`, `expectedMetrics`, `dshVersion`, `metricContractVersion`, `normalizationVersion`, `sha256`, `purpose`, `redaction`。任何 fixture 修改都必须更新 aeval 中的 hash 和期望输出；插件只更新锁定 revision 并验证，不维护第二份 expected。

必须覆盖：

1. 常规 turn/step/tool 闭合路径；
2. 多次压缩、summary 缺失、open start、error end、prune 与摘要压缩并存；
3. 工具显式错误后重复调用、成功/再次失败、孤立结果、重复结果和 surface replacement；
4. retry event 有/无 retry-started、后续结果有/无；
5. Team 多成员、多层子 session、queued/delivered、whole snapshot 更新、显式 blockedBy、依赖环；
6. busy/idle/unknown 状态转换、并发峰值、session 不可访问与子树证据缺口；
7. 仅包含事件前缀的实时 fixture，与相同 session 完整版的前缀切片；
8. seq/time 异常、未知事件类型、必需字段缺失、无 usage、重复 ID；
9. 空事件 session、fork inherited prefix、不同 session 相同 seq。

每个事件前缀必须有 `expectedNormalized` 和 `expectedMetrics`，特别覆盖尚未闭合的 turn、tool、compaction、Team task。完整 session fixture 不能替代 prefix fixture。

## 6. 逐字段对齐算法

CI/本地一致性 runner 对每个 fixture 运行 TS 与 Python 两种实现，先校验各自结果符合共同 schema，再比较 canonical JSON：

1. 对象 key 按 UTF-8 字典序排序后编码；数组按本契约/指标定义规定的稳定顺序；UTF-8、LF、无 BOM。
2. 比较所有字段，不忽略 `null`、空数组、状态、单位、覆盖率、denominator、证据引用或质量原因的差异。
3. 数字按 §4 的规范化精度先转换再比较；禁止宽松 epsilon 比较隐藏真实口径差异。
4. error/unavailable reason 用稳定 machine code（例如 `missing_end_event`, `unsupported_dsh_version`, `missing_usage`）；人类说明可以各自本地化，但不参加字段比较。
5. 任何 diff 均失败，并报告 JSON Pointer 路径、fixture ID、metric ID、TS 值和 Python 值。不得用总分或汇总误差掩盖单字段偏差。
6. 检查所有输入前缀：将完整 fixture 截断到每个 seq 水位后分别复算；实时 projection 在同一水位的 snapshot 必须匹配 Python 对同一前缀的结果。

规范化结果还应验证不含禁止字段：原始 prompt/message body、tool arguments、tool result body、绝对路径、凭据。安全字段 allowlist 与 metric reducer 一起版本化。

## 7. 版本与变更治理

- DSH 版本、事件 schema、规范化器版本、指标契约版本分别标识；任一变化不得默认为兼容。
- 新 DSH 版本先新增独立 fixture/version 目录，比较官方 reader 输出形状，再更新映射；不得用旧版本 fixture 证明新版本支持。
- 规范化字段增删、配对算法、排序、舍入、隐私 allowlist 改动都需 bump `normalizationVersion`。
- 指标公式、分母、缺失策略或 evidenceRefs 改动需升级指标契约版本，并更新所有受影响 fixture expected。
- 修复一个实现以匹配既有契约时，只改实现；不能顺手更改另一端或 golden expected 来让 diff 变绿。
- Runtime-only 指标也使用同一个 envelope；离线一侧必须返回稳定 `unavailable` code，不能省略该 metric。

## 8. 与现有文档的分工

- [`trajectory-metrics-contract.md`](trajectory-metrics-contract.md)：指标的产品语义与公式权威来源。
- [`trajectory-field-metric-span-map.md`](trajectory-field-metric-span-map.md)：DSH 原始字段到分类/事实的来源映射和覆盖分析。
- [`PLAN-live-trajectory-analytics-v2.md`](PLAN-live-trajectory-analytics-v2.md)：产品范围、架构、分阶段实施和发布验收。
- aeval 中的正式契约文件：规范化模型、输出 envelope、跨语言 fixture 以及差异闸门；本插件仓库的本文是对应接入说明副本。

实施顺序：aeval 先固定正式 schema 和 fixture manifest，再由 aeval Python adapter 与插件 TS adapter 分别实现 normalizer；所有测试和离线/实时数据输出引用同一版本标记。本文不替代后续真实样本脱敏、字段校验和 metric-by-metric fixture 期望值编写。
