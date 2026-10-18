# DSH API 数据验证报告

**版本**: v1.0  
**日期**: 2026-10-18  
**作者**: xyrrrrr-r  
**状态**: 已验证

---

## 1. 概述

本文档基于实际代码分析，验证 DSH API 中 `sessionStats` 和 `trajectoryAnalytics` 投影提供的数据字段，并更新技术设计方案。

---

## 2. sessionStats 投影

### 2.1 数据来源

`sessionStats` 是 DSH 宿主内置投影，通过 `useProjection('sessionStats')` 访问。

### 2.2 可用字段

根据 `client/client.js` 第 778-783 行的实际使用：

```typescript
interface SessionStats {
  /** 已完成轮次数 */
  turns: number;
  
  /** 已完成步骤数 */
  steps: number;
  
  /** 模型调用总耗时 (ms) */
  llmMs: number;
  
  /** 工具调用总耗时 (ms) */
  toolMs: number;
  
  /** 首 Token 等待总耗时 (ms) */
  ttftMs: number;
  
  /** 有首 Token 数据的步骤数 */
  ttftSteps: number;
  
  /** 输出 Token 总数 */
  decodeTokens: number;
}
```

### 2.3 使用示例

```typescript
const stats = props.useProjection('sessionStats');

// 计算平均首 Token 等待
const avgTtft = stats.ttftSteps 
  ? Math.round(stats.ttftMs / stats.ttftSteps) 
  : null;

// 显示卡片
['已完成轮次', stats.turns],
['已完成步骤', stats.steps],
['模型耗时', `${stats.llmMs} ms`],
['工具耗时', `${stats.toolMs} ms`],
['平均首 Token 等待', avgTtft ? `${avgTtft} ms` : '暂无样本'],
['输出 Token', stats.decodeTokens],
```

### 2.4 数据限制

- **无上下文窗口数据**：`sessionStats` 不提供 `contextWindow`、`contextComposition` 等字段
- **无消息级数据**：不提供每条消息的 Token 数
- **无压缩事件详情**：不提供压缩前后的快照
- **无注入事件数据**：不提供注入来源和内容

---

## 3. trajectoryAnalytics 投影

### 3.1 数据来源

`trajectoryAnalytics` 是本插件自定义投影，定义在 `src/analytics/projection.ts`。

### 3.2 可用字段

根据 `projection.ts` 的 `AnalyticsSummary` 接口：

```typescript
interface AnalyticsSummary {
  /** 观测到的事件总数 */
  eventsSeen: number;
  
  /** 轮次开始数 */
  turnsStarted: number;
  
  /** 轮次结束数 */
  turnsEnded: number;
  
  /** 步骤开始数 */
  stepsStarted: number;
  
  /** 步骤结束数 */
  stepsEnded: number;
  
  /** 工具调用数 */
  toolCalls: number;
  
  /** 工具结果数 */
  toolResults: number;
  
  /** 工具错误数 */
  toolErrors: number;
  
  /** 输入 Token 总数 */
  inputTokens: number;
  
  /** 有 usage 数据的步骤数 */
  inputUsageSteps: number;
  
  /** 模型重试数 */
  retries: number;
  
  /** 压缩开始数 */
  compactionStarts: number;
  
  /** 压缩摘要数 */
  compactionSummaries: number;
  
  /** 压缩结束数 */
  compactionEnds: number;
  
  /** 修剪批次 */
  prunePasses: number;
  
  /** 压缩覆盖 Token 数 */
  compactionShadowedTokens: number;
  
  /** 修剪覆盖 Token 数 */
  pruneShadowedTokens: number;
  
  /** 压缩总耗时 (ms) */
  compactionElapsedMs: number;
  
  /** Team 成员快照数 */
  teamMemberSnapshots: number;
  
  /** Team 任务快照数 */
  teamTaskSnapshots: number;
  
  /** 排队 Team 消息数 */
  queuedTeamMessages: number;
  
  /** 已投递 Team 消息数 */
  deliveredTeamMessages: number;
  
  /** 指标结果列表 */
  metricResults: TrajectoryMetricResult[];
  
  /** Team 会话输入 */
  teamInput: TeamSessionInput;
  
  /** 轮次趋势 */
  turnTrend: Array<{
    turn: number;
    toolCalls: number;
    toolErrors: number;
    retries: number;
    compactionStarts: number;
    inputTokens: number;
  }>;
  
  /** 最近事件列表 */
  recentEvents: Array<{
    seq: number;
    time: number;
    type: string;
    label?: string;
    callId?: string;
  }>;
}
```

### 3.3 指标结果 (TrajectoryMetricResult)

```typescript
interface TrajectoryMetricResult {
  /** 指标 ID */
  metricId: TrajectoryMetricId;
  
  /** 契约版本 */
  contractVersion: '1';
  
  /** 主体 ID（通常是 sessionId） */
  subjectId: string;
  
  /** 状态 */
  status: 'available' | 'partial' | 'incomplete' | 'unavailable';
  
  /** 值（标量或记录） */
  value?: MetricValue;
  
  /** 单位 */
  unit?: 'ms' | 'tokens' | 'passes' | 'cycles/1k_input_tokens' | 'share' | 'shadowed_tokens_per_call_token';
  
  /** 样本数 */
  sampleCount: number;
  
  /** 分母 */
  denominator?: number;
  
  /** 证据引用 */
  evidenceRefs: CanonicalEventRef[];
  
  /** 质量引用 */
  qualityRefs: string[];
  
  /** 证据级别 */
  evidenceLevel: 'observed' | 'derived' | 'inferred';
}
```

### 3.4 可用指标 ID 列表

根据 `metrics.ts` 第 10-45 行：

```typescript
type TrajectoryMetricId =
  // 工具相关
  | 'tool.call_elapsed_ms'           // 工具调用耗时
  | 'tool.failure_rate'              // 工具显式错误率
  | 'tool.repeat_loop'               // 重复调用循环
  | 'tool.error_recovery'            // 错误恢复
  | 'tool.repeat_overhead'           // 重复调用开销
  
  // 压缩相关
  | 'compaction.summary_cycles'      // 摘要压缩周期
  | 'compaction.elapsed_ms'          // 压缩耗时
  | 'compaction.shadowed_tokens'     // 摘要覆盖 Token
  | 'compaction.prune_passes'        // 历史修剪批次
  | 'compaction.reclaimed_tokens_per_call_token'  // 回收比例
  
  // 上下文相关
  | 'context.compaction_frequency_per_1k_input_tokens'  // 压缩频率
  | 'context.compaction_time_share'  // 压缩时间占比
  | 'context.input_window_utilization'  // 输入窗口占用
  
  // 模型相关
  | 'model.step_to_first_chunk_ms'   // 步骤首块延迟
  | 'model.stream_span_ms'           // 流式输出跨度
  | 'model.retry_recovery'           // 模型重试恢复
  | 'model.long_gap_segments'        // 长间隔段
  
  // 规划相关
  | 'planning.todo_snapshot_change'  // Todo 快照变更
  | 'planning.rewrite_after_completion'  // 完成后重写
  
  // 协作相关
  | 'coordination.inbox_insert_to_message_event_ms'  // 收件箱入队到浮出
  | 'coordination.inbox_tool_overlap_share'  // 等待期工具重叠
  | 'coordination.team_delivery_ms'  // Team 消息投递
  | 'coordination.delegation_depth'  // 委派深度
  | 'coordination.fan_out_width'     // 成员扇出
  | 'coordination.member_idle_ms'    // 成员空闲 (不可得)
  | 'coordination.member_busy_ms'    // 成员忙碌时长
  | 'coordination.active_members_now'  // 当前活跃成员
  | 'coordination.peak_concurrent_members'  // 并发峰值成员
  | 'coordination.team_completion_wall_ms'  // Team 完成墙钟
  | 'coordination.branch_first_activity_ms'  // 分支首活动延迟
  | 'coordination.task_blocked_duration'  // 任务阻塞时长
  | 'coordination.team_path_critical_segments'  // 关键依赖路径
  
  // 结果相关
  | 'outcome.turn_reason_mix'        // 轮次结束原因
  | 'outcome.turn_completion_evidence'  // 轮次完成证据
  
  // 数据质量
  | 'data_quality.trajectory_coverage';  // 数据质量覆盖
```

### 3.5 Team 会话输入 (TeamSessionInput)

```typescript
interface TeamSessionInput {
  /** 会话 ID */
  sessionId: string;
  
  /** 是否有事件 */
  hasEvents: boolean;
  
  /** 首事件时间 */
  firstEventTimeMs: number | null;
  
  /** 最后事件引用 */
  lastEventRef: CanonicalEventRef | null;
  
  /** 事件数 */
  eventCount: number;
  
  /** 最大事实时间 */
  factTimeMax: number | null;
  
  /** 轮次区间列表 */
  turnIntervals: Array<{
    turn: number;
    startMs: number;
    startSeq: number;
    firstEndMs: number | null;
    firstEndSeq: number | null;
  }>;
  
  /** 成员 ID 列表 */
  memberIds: string[];
  
  /** Team 成员快照引用 */
  teamMemberSnapshotRefs: CanonicalEventRef[];
  
  /** 成员最后引用 */
  memberLastRefs: Record<string, CanonicalEventRef>;
  
  /** 子代理子节点 */
  subagentChildren: Array<{
    childId: string | null;
    childCreatedAtMs: number | null;
    ref: CanonicalEventRef;
  }>;
  
  /** 子节点最后引用 */
  childLastRefs: Record<string, CanonicalEventRef>;
  
  /** 任务快照列表 */
  taskSnapshots: Array<{
    taskId: string | null;
    status: string | null;
    blockedBy: string[] | null;
    timeMs: number;
    ref: CanonicalEventRef;
  }>;
  
  /** Team 成员快照列表 */
  teamMemberSnapshots: Array<{
    memberId: string | null;
    phase: string | null;
    timeMs: number;
    ref: CanonicalEventRef;
  }>;
  
  /** 质量项目 */
  qualityItems: Array<{
    code: string;
    refs: CanonicalEventRef[];
  }>;
  
  /** 未配对工具结果引用 */
  unpairedToolResultRefs: CanonicalEventRef[];
  
  /** 未知事件类型数 */
  unknownEventTypes: number;
  
  /** 未闭合区间数 */
  openSpans: number;
}
```

---

## 4. 数据缺口分析

### 4.1 上下文可视化所需但缺失的数据

| 需求 | sessionStats | trajectoryAnalytics | 解决方案 |
|------|--------------|---------------------|----------|
| 上下文窗口上限 | ❌ | ❌ | 从模型配置推断或用户配置 |
| 上下文组成（系统/历史/工具/文件） | ❌ | ❌ | 从事件流推断 |
| 每条消息的 Token 数 | ❌ | ️ 仅有 inputTokens 总计 | 从 `assistant/message` 事件的 `usage` 字段提取 |
| 压缩前后快照 | ❌ | ⚠️ 仅有 shadowedTokenCount | 从 `compaction/summary` 事件推断 |
| 注入事件详情 | ❌ |  | 从 `user/message`、`tool/result` 等事件推断 |
| 实时占用率 | ❌ | ❌ | 基于累计 Token 估算 |

### 4.2 可用的替代数据源

1. **模型配置**：从 `broker.json` 或环境变量获取 `contextWindow` 上限
2. **事件流**：从 `SessionEvent` 序列推断上下文组成
3. **usage 字段**：从 `assistant/message` 事件的 `data.usage.inputTokens` 获取每步 Token
4. **压缩事件**：从 `compaction/start`、`compaction/summary`、`compaction/end` 事件获取压缩详情

---

## 5. 更新后的技术方案

### 5.1 数据获取策略调整

#### 原方案
```typescript
// 假设 DSH API 直接提供上下文组成
const composition = await sessions.getContextComposition(sessionId);
```

#### 新方案（基于实际 API）
```typescript
/** 从事件流推断上下文组成 */
function inferContextComposition(events: SessionEvent[]): ContextComposition {
  const composition = {
    systemPrompt: 0,
    conversationHistory: 0,
    toolDefinitions: 0,
    fileContents: 0,
    compactionSummary: 0,
    other: 0,
  };
  
  for (const event of events) {
    switch (event.type) {
      case 'system/message':
        composition.systemPrompt += estimateTokens(event.data.content);
        break;
      case 'user/message':
      case 'assistant/message':
        composition.conversationHistory += estimateTokens(event.data.content);
        break;
      case 'tool/call':
        composition.toolDefinitions += estimateTokens(event.data.name);
        break;
      case 'compaction/summary':
        composition.compactionSummary += event.data.shadowedTokenCount;
        break;
    }
  }
  
  return composition;
}
```

### 5.2 上下文窗口上限获取

```typescript
/** 获取上下文窗口上限 */
async function getContextWindowLimit(sessionId: string): Promise<number> {
  // 方案 1: 从 sessionStats 获取（如果未来版本支持）
  const stats = await sessions.using(sessionId, {}, async (ref) => {
    await ref.ready;
    return ref.binding.session.projections.faceOf('sessionStats');
  });
  
  if (stats?.contextWindowLimit) {
    return stats.contextWindowLimit;
  }
  
  // 方案 2: 从模型配置推断
  const modelConfig = await getModelConfig(sessionId);
  return modelConfig?.contextWindow ?? 128000; // 默认 128K
  
  // 方案 3: 从 trajectoryAnalytics 的 context.input_window_utilization 反推
  const analytics = await sessions.using(sessionId, {}, async (ref) => {
    await ref.ready;
    return ref.binding.session.projections.faceOf('trajectoryAnalytics');
  });
  
  const utilizationMetric = analytics?.metricResults?.find(
    m => m.metricId === 'context.input_window_utilization'
  );
  
  if (utilizationMetric?.value && analytics?.inputTokens) {
    return Math.round(analytics.inputTokens / utilizationMetric.value);
  }
  
  return 128000; // 最终默认值
}
```

### 5.3 消息级 Token 数据获取

```typescript
/** 从事件流提取消息级 Token 数据 */
function extractMessageTokens(events: SessionEvent[]): MessageTokenData[] {
  const messages: MessageTokenData[] = [];
  let messageIndex = 0;
  
  for (const event of events) {
    if (event.type === 'assistant/message' && event.data.usage) {
      messages.push({
        index: messageIndex++,
        role: 'assistant',
        timestamp: event.time,
        seq: event.seq,
        turn: event.data.turn,
        inputTokens: event.data.usage.inputTokens ?? 0,
        outputTokens: event.data.usage.outputTokens ?? 0,
        content: event.data.content?.substring(0, 100) ?? '', // 仅摘要
      });
    } else if (event.type === 'user/message') {
      messages.push({
        index: messageIndex++,
        role: 'user',
        timestamp: event.time,
        seq: event.seq,
        turn: event.data.turn,
        inputTokens: 0, // 用户消息通常不计入
        outputTokens: 0,
        content: event.data.content?.substring(0, 100) ?? '',
      });
    }
  }
  
  return messages;
}
```

### 5.4 压缩事件详情获取

```typescript
/** 从事件流提取压缩事件 */
function extractCompactionEvents(events: SessionEvent[]): CompactionEvent[] {
  const compactions: CompactionEvent[] = [];
  const activeCompactions = new Map<string, { start: SessionEvent }>();
  
  for (const event of events) {
    if (event.type === 'compaction/start') {
      activeCompactions.set(event.data.compactionId, { start: event });
    } else if (event.type === 'compaction/summary') {
      const active = activeCompactions.get(event.data.compactionId);
      if (active) {
        compactions.push({
          id: event.data.compactionId,
          timestamp: event.time,
          seq: event.seq,
          turn: event.data.turn,
          beforeTokens: estimateBeforeTokens(active.start),
          afterTokens: estimateAfterTokens(active.start, event.data.shadowedTokenCount),
          reclaimedTokens: event.data.shadowedTokenCount,
          reclaimRatio: event.data.shadowedTokenCount / estimateBeforeTokens(active.start),
          trigger: 'auto',
          details: {
            compressedSummary: '历史对话被压缩为摘要',
            retainedSummary: '保留最近 N 轮对话',
          },
        });
      }
    } else if (event.type === 'compaction/end') {
      activeCompactions.delete(event.data.compactionId);
    }
  }
  
  return compactions;
}
```

---

## 6. 实现优先级调整

### 6.1 P0（MVP）- 基于可用数据

1. **占用率仪表盘**
   - 数据源：`trajectoryAnalytics.inputTokens` + 推断的窗口上限
   - 实现：环形进度条显示 `inputTokens / contextWindowLimit`

2. **组成堆叠条**
   - 数据源：从事件流推断
   - 实现：6 段堆叠条（系统/历史/工具/文件/压缩/其他）

3. **消息 Token 列表**
   - 数据源：`assistant/message` 事件的 `usage` 字段
   - 实现：可排序列表，显示每步的 inputTokens

### 6.2 P1（增强）- 需要额外推断

4. **演化时间线**
   - 数据源：`turnTrend` + 推断的上下文占用
   - 实现：折线图显示每轮的 Token 消耗趋势

5. **压缩事件列表**
   - 数据源：`compaction/summary` 事件
   - 实现：卡片列表显示压缩详情

6. **Dashboard 重构**
   - 数据源：`sessionStats` + `trajectoryAnalytics`
   - 实现：顶部状态栏 + 指标卡片 + Tab 切换

### 6.3 P2（差异化）- 需要深度分析

7. **智能告警**
   - 数据源：所有可用指标
   - 实现：规则引擎 + 建议生成

8. **对比分析**
   - 数据源：多次运行的数据
   - 实现：并排图表 + 差异报告

9. **导出功能**
   - 数据源：所有数据
   - 实现：PDF/Markdown/JSON 导出

---

## 7. 风险与缓解

### 7.1 数据准确性风险

| 风险 | 影响 | 缓解策略 |
|------|------|---------|
| 窗口上限推断不准 | 中 | 提供手动配置入口，显示"估算"标记 |
| 组成推断误差 | 低 | 透明化推断逻辑，提供原始数据查看 |
| 事件流不完整 | 中 | 降级显示"数据不完整"，不伪造数据 |

### 7.2 性能风险

| 风险 | 影响 | 缓解策略 |
|------|------|---------|
| 事件流过大 | 高 | 虚拟滚动 + Web Worker + 降采样 |
| 频繁更新 | 中 | 防抖/节流 + 增量更新 |
| 图表渲染慢 | 中 | Canvas 渲染 + 数据预聚合 |

### 7.3 兼容性风险

| 风险 | 影响 | 缓解策略 |
|------|------|---------|
| DSH 版本差异 | 高 | 抽象数据层，快速适配 |
| 投影 API 变更 | 高 | 版本检测 + 降级策略 |
| 事件类型变更 | 中 | 事件白名单 + 未知事件忽略 |

---

## 8. 总结

### 8.1 核心发现

1. **sessionStats 提供基础统计**：turns、steps、llmMs、toolMs、ttftMs、decodeTokens
2. **trajectoryAnalytics 提供详细指标**：30+ 种指标，覆盖工具、压缩、上下文、模型、协作、结果、质量
3. **上下文数据需要推断**：DSH API 不直接提供上下文组成和窗口上限
4. **事件流是主要数据源**：大部分数据需要从 SessionEvent 序列提取

### 8.2 实施建议

1. **先做数据层**：实现事件监听器和数据推断逻辑
2. **再做 UI 层**：基于推断数据实现可视化组件
3. **持续验证**：用真实会话数据验证推断准确性
4. **透明化**：向用户明确标注哪些是推断数据

### 8.3 下一步

1. 实现 `ContextEventListener` 类
2. 实现 `inferContextComposition()` 函数
3. 实现 `getContextWindowLimit()` 函数
4. 实现 `UtilizationGauge` 组件
5. 用真实会话数据测试

---

**文档结束**
