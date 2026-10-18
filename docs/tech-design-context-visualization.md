# 上下文窗口可视化 - 技术设计文档

**版本**: v1.0  
**日期**: 2026-10-18  
**作者**: xyrrrrr-r  
**状态**: 草案  
**关联 PRD**: [PRD-v1.0.md](./PRD-v1.0.md) §3.1, §3.2, §3.4, §3.5

---

## 1. 概述

### 1.1 目标

实现实时上下文窗口可视化系统，让用户能够：
- 直观看到上下文窗口的占用情况
- 理解上下文内容的组成结构
- 追踪上下文随时间的演化
- 分析压缩/注入事件的影响

### 1.2 技术挑战

1. **数据获取**：DSH 宿主 API 可能不直接提供上下文组成数据
2. **性能**：高频更新（每次模型调用）不能阻塞 UI
3. **准确性**：Token 计数需要与模型实际使用一致
4. **隐私**：不能暴露敏感内容（工具参数、文件路径等）

---

## 2. 数据架构

> **重要更新**：基于 [DSH API 验证报告](./dsh-api-verification.md)，DSH 宿主 API **不直接提供**上下文组成和窗口上限数据。以下方案已调整为基于事件流推断。

### 2.1 数据模型

#### 2.1.1 核心类型定义

```typescript
/** 上下文窗口快照 */
interface ContextWindowSnapshot {
  /** 快照时间戳 (ms) */
  timestamp: number;
  /** 事件序列号 */
  seq: number;
  /** 轮次号 */
  turn: number;
  
  /** 窗口容量 (Token) */
  capacity: number;
  /** 已用 Token 数 */
  usedTokens: number;
  /** 占用率 (0-1) */
  utilization: number;
  
  /** 组成结构 */
  composition: ContextComposition;
  
  /** 元数据 */
  metadata: {
    provider: string;
    model: string;
    contextWindowLimit: number | null;
  };
}

/** 上下文组成 */
interface ContextComposition {
  /** 系统提示 */
  systemPrompt: CompositionSegment;
  /** 对话历史 */
  conversationHistory: CompositionSegment;
  /** 工具定义 */
  toolDefinitions: CompositionSegment;
  /** 文件内容 */
  fileContents: CompositionSegment;
  /** 压缩摘要 */
  compactionSummary: CompositionSegment;
  /** 其他 */
  other: CompositionSegment;
}

/** 组成片段 */
interface CompositionSegment {
  /** Token 数 */
  tokens: number;
  /** 占比 (0-1) */
  ratio: number;
  /** 内容摘要（非敏感） */
  summary: string;
  /** 内容哈希（用于去重） */
  hash?: string;
}

/** 上下文演化记录 */
interface ContextEvolution {
  /** 快照序列 */
  snapshots: ContextWindowSnapshot[];
  /** 压缩事件 */
  compactionEvents: CompactionEvent[];
  /** 注入事件 */
  injectionEvents: InjectionEvent[];
  /** 统计信息 */
  statistics: ContextStatistics;
}

/** 压缩事件 */
interface CompactionEvent {
  /** 事件 ID */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 事件序列号 */
  seq: number;
  /** 轮次号 */
  turn: number;
  
  /** 压缩前 Token 数 */
  beforeTokens: number;
  /** 压缩后 Token 数 */
  afterTokens: number;
  /** 回收 Token 数 */
  reclaimedTokens: number;
  /** 回收率 (0-1) */
  reclaimRatio: number;
  
  /** 触发原因 */
  trigger: 'auto' | 'manual' | 'threshold';
  /** 压缩算法 */
  algorithm?: string;
  
  /** 压缩详情（可选，可能不可用） */
  details?: {
    /** 被压缩的内容摘要 */
    compressedSummary: string;
    /** 保留的内容摘要 */
    retainedSummary: string;
  };
}

/** 注入事件 */
interface InjectionEvent {
  /** 事件 ID */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 事件序列号 */
  seq: number;
  
  /** 注入来源 */
  source: 'user' | 'system' | 'tool_result' | 'file' | 'other';
  /** 注入类型 */
  type: string;
  
  /** 注入的 Token 数 */
  injectedTokens: number;
  /** 注入后的总 Token 数 */
  totalTokensAfter: number;
  
  /** 注入内容摘要 */
  summary: string;
}

/** 上下文统计 */
interface ContextStatistics {
  /** 平均占用率 */
  avgUtilization: number;
  /** 峰值占用率 */
  peakUtilization: number;
  /** 压缩次数 */
  compactionCount: number;
  /** 总回收 Token 数 */
  totalReclaimedTokens: number;
  /** 压缩频率 (次/千 Token) */
  compactionFrequency: number;
  /** 注入次数 */
  injectionCount: number;
  /** 总注入 Token 数 */
  totalInjectedTokens: number;
}
```

#### 2.1.2 状态管理

```typescript
/** 上下文可视化状态 */
interface ContextVisualizationState {
  /** 当前快照 */
  currentSnapshot: ContextWindowSnapshot | null;
  /** 演化记录 */
  evolution: ContextEvolution;
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 最后更新时间 */
  lastUpdated: number | null;
  
  /** UI 状态 */
  ui: {
    /** 详情面板是否展开 */
    detailsExpanded: boolean;
    /** 选中的组成片段 */
    selectedSegment: keyof ContextComposition | null;
    /** 选中的事件 */
    selectedEvent: CompactionEvent | InjectionEvent | null;
    /** 图表缩放范围 */
    chartRange: { start: number; end: number } | null;
  };
}
```

### 2.2 数据流

```
┌─────────────────────────────────────────────────────────────┐
│                      DSH 宿主事件流                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   事件监听器 (Event Listener)                 │
│  - assistant/message                                         │
│  - tool/call, tool/result                                    │
│  - compaction/start, compaction/end, compaction/summary      │
│  - turn/start, turn/end                                      │
└─────────────────────────────────────────────────────────────
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  数据聚合器 (Data Aggregator)                 │
│  - 计算 Token 使用                                           │
│  - 推断上下文组成                                            │
│  - 记录压缩/注入事件                                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   状态存储 (State Store)                      │
│  - 当前快照                                                  │
│  - 演化历史                                                  │
│  - 统计信息                                                  │
└─────────────────────────────────────────────────────────────
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    UI 组件 (React)                            │
│  - 占用率仪表盘                                              │
│  - 组成堆叠条                                                │
│  - 演化时间线                                                │
│  - 事件列表                                                  │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 数据获取策略

#### 2.3.1 主要数据源（实际可用）

根据 [DSH API 验证报告](./dsh-api-verification.md)，实际可用的数据源：

**sessionStats 投影**（DSH 宿主内置）：
```typescript
interface SessionStats {
  turns: number;              // 已完成轮次数
  steps: number;              // 已完成步骤数
  llmMs: number;              // 模型调用总耗时 (ms)
  toolMs: number;             // 工具调用总耗时 (ms)
  ttftMs: number;             // 首 Token 等待总耗时 (ms)
  ttftSteps: number;          // 有首 Token 数据的步骤数
  decodeTokens: number;       // 输出 Token 总数
}
```

**trajectoryAnalytics 投影**（本插件自定义）：
```typescript
interface AnalyticsSummary {
  eventsSeen: number;
  turnsStarted: number;
  turnsEnded: number;
  stepsStarted: number;
  stepsEnded: number;
  toolCalls: number;
  toolResults: number;
  toolErrors: number;
  inputTokens: number;        // 输入 Token 总数
  inputUsageSteps: number;    // 有 usage 数据的步骤数
  retries: number;
  compactionStarts: number;
  compactionSummaries: number;
  compactionEnds: number;
  prunePasses: number;
  compactionShadowedTokens: number;
  pruneShadowedTokens: number;
  compactionElapsedMs: number;
  teamMemberSnapshots: number;
  teamTaskSnapshots: number;
  queuedTeamMessages: number;
  deliveredTeamMessages: number;
  metricResults: TrajectoryMetricResult[];  // 30+ 种指标
  teamInput: TeamSessionInput;
  turnTrend: Array<{ turn: number; toolCalls: number; ... }>;
  recentEvents: Array<{ seq: number; time: number; type: string; ... }>;
}
```

**SessionEvent 事件流**（主要数据源）：
```typescript
// 从事件流推断上下文组成
// 从 assistant/message 事件的 data.usage 获取每步 Token
// 从 compaction/summary 事件获取压缩详情
// 从 user/message、tool/result 等事件推断注入
```

#### 2.3.2 数据缺口与解决方案

| 需求 | DSH API 提供 | 解决方案 |
|------|-------------|----------|
| 上下文窗口上限 | ❌ | 从模型配置推断或用户配置 |
| 上下文组成 | ❌ | 从事件流推断（系统/历史/工具/文件/压缩） |
| 每条消息 Token 数 | ⚠️ 仅总计 | 从 `assistant/message` 事件的 `usage` 字段提取 |
| 压缩前后快照 | ⚠️ 仅 shadowedTokenCount | 从 `compaction/summary` 事件推断 |
| 注入事件详情 | ❌ | 从 `user/message`、`tool/result` 等事件推断 |
| 实时占用率 | ❌ | 基于累计 Token 估算 |

#### 2.3.3 上下文窗口上限获取

```typescript
/** 获取上下文窗口上限（多策略降级） */
async function getContextWindowLimit(sessionId: string): Promise<number> {
  // 策略 1: 从 trajectoryAnalytics 的 context.input_window_utilization 反推
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
  
  // 策略 2: 从模型配置推断
  const modelConfig = await getModelConfig(sessionId);
  if (modelConfig?.contextWindow) {
    return modelConfig.contextWindow;
  }
  
  // 策略 3: 默认值（DeepSeek Chat 通常 128K）
  return 128000;
}
```

#### 2.3.4 上下文组成推断

```typescript
/** 从事件流推断上下文组成 */
function inferContextComposition(events: SessionEvent[]): ContextComposition {
  const composition: ContextComposition = {
    systemPrompt: { tokens: 0, ratio: 0, summary: '系统提示' },
    conversationHistory: { tokens: 0, ratio: 0, summary: '对话历史' },
    toolDefinitions: { tokens: 0, ratio: 0, summary: '工具定义' },
    fileContents: { tokens: 0, ratio: 0, summary: '文件内容' },
    compactionSummary: { tokens: 0, ratio: 0, summary: '压缩摘要' },
    other: { tokens: 0, ratio: 0, summary: '其他' },
  };
  
  for (const event of events) {
    switch (event.type) {
      case 'system/message':
        composition.systemPrompt.tokens += estimateTokens(event.data.content);
        break;
      case 'user/message':
      case 'assistant/message':
        composition.conversationHistory.tokens += estimateTokens(event.data.content);
        break;
      case 'tool/call':
        composition.toolDefinitions.tokens += estimateTokens(event.data.name);
        break;
      case 'compaction/summary':
        composition.compactionSummary.tokens += event.data.shadowedTokenCount;
        break;
    }
  }
  
  const totalTokens = Object.values(composition).reduce((sum, seg) => sum + seg.tokens, 0);
  
  // 计算占比
  for (const segment of Object.values(composition)) {
    segment.ratio = totalTokens > 0 ? segment.tokens / totalTokens : 0;
  }
  
  return composition;
}

/** 估算 Token 数（简化版） */
function estimateTokens(text: string): number {
  // 中文约 1.5 字符/Token，英文约 4 字符/Token
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}
```

---

## 3. 组件架构

### 3.1 组件树

```
ContextVisualizationView
├── ContextStatusBar (顶部状态栏)
│   ├── UtilizationGauge (占用率仪表盘)
│   └── QuickActions (快速操作菜单)
├── CompositionPanel (组成面板)
│   ├── CompositionBar (组成堆叠条)
│   ├── CompositionPieChart (组成饼图)
│   └── CompositionList (组成列表)
├── EvolutionChart (演化图表)
│   ├── TimelineChart (时间线图表)
│   ├── EventMarkers (事件标记)
│   └── ChartControls (图表控制)
├── EventList (事件列表)
│   ├── CompactionEventCard (压缩事件卡片)
│   ├── InjectionEventCard (注入事件卡片)
│   └── EventDetailPanel (事件详情面板)
└── MessageTokenList (消息 Token 列表)
    ├── MessageRow (消息行)
    └── MessageDetailPanel (消息详情面板)
```

### 3.2 核心组件设计

#### 3.2.1 占用率仪表盘 (UtilizationGauge)

```typescript
interface UtilizationGaugeProps {
  /** 已用 Token 数 */
  usedTokens: number;
  /** 窗口上限 */
  capacity: number;
  /** 占用率 (0-1) */
  utilization: number;
  /** 点击展开详情 */
  onExpand: () => void;
}

const UtilizationGauge: React.FC<UtilizationGaugeProps> = ({
  usedTokens,
  capacity,
  utilization,
  onExpand,
}) => {
  // 颜色编码
  const getColor = () => {
    if (utilization < 0.6) return '#34a853'; // 绿色
    if (utilization < 0.8) return '#fbbc04'; // 黄色
    return '#ea4335'; // 红色
  };
  
  // 是否闪烁（超过 80%）
  const shouldPulse = utilization > 0.8;
  
  return (
    <div 
      className={`utilization-gauge ${shouldPulse ? 'pulse' : ''}`}
      onClick={onExpand}
      role="button"
      aria-label={`上下文占用率：${(utilization * 100).toFixed(1)}%`}
    >
      <svg viewBox="0 0 100 100" className="gauge-svg">
        {/* 背景圆环 */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="#e0e0e0"
          strokeWidth="8"
        />
        {/* 进度圆环 */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke={getColor()}
          strokeWidth="8"
          strokeDasharray={`${utilization * 283} 283`}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          className="progress-ring"
        />
        {/* 中心文字 */}
        <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" className="gauge-text">
          {(utilization * 100).toFixed(1)}%
        </text>
      </svg>
      <div className="gauge-label">
        <div className="token-count">{usedTokens.toLocaleString()} / {capacity.toLocaleString()}</div>
        <div className="token-label">Tokens</div>
      </div>
    </div>
  );
};
```

#### 3.2.2 组成堆叠条 (CompositionBar)

```typescript
interface CompositionBarProps {
  composition: ContextComposition;
  onSegmentClick: (segment: keyof ContextComposition) => void;
  selectedSegment: keyof ContextComposition | null;
}

const SEGMENT_COLORS: Record<keyof ContextComposition, string> = {
  systemPrompt: '#1a73e8',      // 蓝色
  conversationHistory: '#9aa0a6', // 灰色
  toolDefinitions: '#f29900',     // 橙色
  fileContents: '#9334e6',        // 紫色
  compactionSummary: '#00bcd4',   // 青色
  other: '#5f6368',               // 深灰
};

const CompositionBar: React.FC<CompositionBarProps> = ({
  composition,
  onSegmentClick,
  selectedSegment,
}) => {
  const segments = Object.entries(composition) as [keyof ContextComposition, CompositionSegment][];
  
  return (
    <div className="composition-bar" role="progressbar" aria-label="上下文组成">
      {segments.map(([key, segment]) => (
        <div
          key={key}
          className={`composition-segment ${selectedSegment === key ? 'selected' : ''}`}
          style={{
            width: `${segment.ratio * 100}%`,
            backgroundColor: SEGMENT_COLORS[key],
          }}
          onClick={() => onSegmentClick(key)}
          role="button"
          aria-label={`${key}: ${segment.tokens} Tokens (${(segment.ratio * 100).toFixed(1)}%)`}
          title={`${key}: ${segment.tokens} Tokens (${(segment.ratio * 100).toFixed(1)}%)`}
        >
          {segment.ratio > 0.05 && (
            <span className="segment-label">
              {(segment.ratio * 100).toFixed(0)}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
};
```

#### 3.2.3 演化时间线图表 (TimelineChart)

```typescript
interface TimelineChartProps {
  snapshots: ContextWindowSnapshot[];
  compactionEvents: CompactionEvent[];
  injectionEvents: InjectionEvent[];
  onEventClick: (event: CompactionEvent | InjectionEvent) => void;
  onRangeChange: (range: { start: number; end: number }) => void;
}

const TimelineChart: React.FC<TimelineChartProps> = ({
  snapshots,
  compactionEvents,
  injectionEvents,
  onEventClick,
  onRangeChange,
}) => {
  const chartRef = useRef<SVGSVGElement>(null);
  const [hoveredPoint, setHoveredPoint] = useState<ContextWindowSnapshot | null>(null);
  const [zoomRange, setZoomRange] = useState<{ start: number; end: number } | null>(null);
  
  // 图表尺寸
  const width = 800;
  const height = 300;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  
  // 数据缩放
  const xScale = d3.scaleLinear()
    .domain([0, snapshots.length - 1])
    .range([padding.left, width - padding.right]);
  
  const yScale = d3.scaleLinear()
    .domain([0, d3.max(snapshots, s => s.usedTokens) || 0])
    .range([height - padding.bottom, padding.top]);
  
  // 折线路径
  const line = d3.line<ContextWindowSnapshot>()
    .x((d, i) => xScale(i))
    .y(d => yScale(d.usedTokens))
    .curve(d3.curveMonotoneX);
  
  // 处理缩放
  const handleZoom = (event: React.WheelEvent) => {
    // 实现缩放逻辑
  };
  
  // 处理拖拽选择
  const handleDrag = (event: React.MouseEvent) => {
    // 实现拖拽选择逻辑
  };
  
  return (
    <svg
      ref={chartRef}
      width={width}
      height={height}
      className="timeline-chart"
      onWheel={handleZoom}
      onMouseDown={handleDrag}
    >
      {/* 网格线 */}
      <g className="grid">
        {yScale.ticks(5).map(tick => (
          <line
            key={tick}
            x1={padding.left}
            y1={yScale(tick)}
            x2={width - padding.right}
            y2={yScale(tick)}
            stroke="#e0e0e0"
            strokeDasharray="2,2"
          />
        ))}
      </g>
      
      {/* 窗口上限线 */}
      {snapshots[0] && (
        <line
          x1={padding.left}
          y1={yScale(snapshots[0].capacity)}
          x2={width - padding.right}
          y2={yScale(snapshots[0].capacity)}
          stroke="#ea4335"
          strokeDasharray="5,5"
          strokeWidth="2"
        />
      )}
      
      {/* 上下文占用折线 */}
      <path
        d={line(snapshots)}
        fill="none"
        stroke="#1a73e8"
        strokeWidth="2"
      />
      
      {/* 压缩事件标记 */}
      {compactionEvents.map(event => {
        const seq = snapshots.findIndex(s => s.seq >= event.seq);
        if (seq < 0) return null;
        return (
          <g
            key={event.id}
            transform={`translate(${xScale(seq)}, ${yScale(snapshots[seq]?.usedTokens || 0)})`}
            onClick={() => onEventClick(event)}
            className="event-marker compaction"
            role="button"
            aria-label={`压缩事件：${event.reclaimedTokens} Tokens`}
          >
            <polygon
              points="0,-8 8,8 -8,8"
              fill="#34a853"
              stroke="#fff"
              strokeWidth="1"
            />
            <title>{`压缩事件\n回收：${event.reclaimedTokens} Tokens\n回收率：${(event.reclaimRatio * 100).toFixed(1)}%`}</title>
          </g>
        );
      })}
      
      {/* 注入事件标记 */}
      {injectionEvents.map(event => {
        const seq = snapshots.findIndex(s => s.seq >= event.seq);
        if (seq < 0) return null;
        return (
          <g
            key={event.id}
            transform={`translate(${xScale(seq)}, ${yScale(snapshots[seq]?.usedTokens || 0)})`}
            onClick={() => onEventClick(event)}
            className="event-marker injection"
            role="button"
            aria-label={`注入事件：${event.injectedTokens} Tokens`}
          >
            <circle
              r="6"
              fill="#f29900"
              stroke="#fff"
              strokeWidth="1"
            />
            <title>{`注入事件\n来源：${event.source}\n注入：${event.injectedTokens} Tokens`}</title>
          </g>
        );
      })}
      
      {/* 悬停提示 */}
      {hoveredPoint && (
        <g className="tooltip">
          <rect
            x={xScale(snapshots.indexOf(hoveredPoint)) + 10}
            y={yScale(hoveredPoint.usedTokens) - 60}
            width="150"
            height="50"
            fill="rgba(0,0,0,0.8)"
            rx="4"
          />
          <text
            x={xScale(snapshots.indexOf(hoveredPoint)) + 20}
            y={yScale(hoveredPoint.usedTokens) - 40}
            fill="#fff"
            fontSize="12"
          >
            Turn {hoveredPoint.turn}
          </text>
          <text
            x={xScale(snapshots.indexOf(hoveredPoint)) + 20}
            y={yScale(hoveredPoint.usedTokens) - 20}
            fill="#fff"
            fontSize="12"
          >
            {hoveredPoint.usedTokens.toLocaleString()} Tokens
          </text>
        </g>
      )}
      
      {/* 坐标轴 */}
      <g className="axis x-axis">
        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
          stroke="#333"
        />
        {xScale.ticks(10).map(tick => (
          <text
            key={tick}
            x={xScale(tick)}
            y={height - padding.bottom + 20}
            textAnchor="middle"
            fontSize="12"
          >
            Turn {tick}
          </text>
        ))}
      </g>
      
      <g className="axis y-axis">
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={height - padding.bottom}
          stroke="#333"
        />
        {yScale.ticks(5).map(tick => (
          <text
            key={tick}
            x={padding.left - 10}
            y={yScale(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize="12"
          >
            {tick.toLocaleString()}
          </text>
        ))}
      </g>
    </svg>
  );
};
```

---

## 4. 状态管理

### 4.1 Redux Store 设计

```typescript
// store/contextVisualizationSlice.ts

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { ContextVisualizationState, ContextWindowSnapshot, CompactionEvent, InjectionEvent } from '../types';

const initialState: ContextVisualizationState = {
  currentSnapshot: null,
  evolution: {
    snapshots: [],
    compactionEvents: [],
    injectionEvents: [],
    statistics: {
      avgUtilization: 0,
      peakUtilization: 0,
      compactionCount: 0,
      totalReclaimedTokens: 0,
      compactionFrequency: 0,
      injectionCount: 0,
      totalInjectedTokens: 0,
    },
  },
  loading: false,
  error: null,
  lastUpdated: null,
  ui: {
    detailsExpanded: false,
    selectedSegment: null,
    selectedEvent: null,
    chartRange: null,
  },
};

// 异步 Thunk：获取上下文数据
export const fetchContextData = createAsyncThunk(
  'contextVisualization/fetchData',
  async (sessionId: string, { rejectWithValue }) => {
    try {
      // 调用 DSH API 获取数据
      const data = await fetchContextDataFromHost(sessionId);
      return data;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

const contextVisualizationSlice = createSlice({
  name: 'contextVisualization',
  initialState,
  reducers: {
    // 更新当前快照
    updateSnapshot(state, action: PayloadAction<ContextWindowSnapshot>) {
      state.currentSnapshot = action.payload;
      state.evolution.snapshots.push(action.payload);
      state.lastUpdated = Date.now();
      
      // 更新统计信息
      updateStatistics(state);
    },
    
    // 添加压缩事件
    addCompactionEvent(state, action: PayloadAction<CompactionEvent>) {
      state.evolution.compactionEvents.push(action.payload);
      state.evolution.statistics.compactionCount++;
      state.evolution.statistics.totalReclaimedTokens += action.payload.reclaimedTokens;
    },
    
    // 添加注入事件
    addInjectionEvent(state, action: PayloadAction<InjectionEvent>) {
      state.evolution.injectionEvents.push(action.payload);
      state.evolution.statistics.injectionCount++;
      state.evolution.statistics.totalInjectedTokens += action.payload.injectedTokens;
    },
    
    // UI 操作
    toggleDetails(state) {
      state.ui.detailsExpanded = !state.ui.detailsExpanded;
    },
    
    selectSegment(state, action: PayloadAction<keyof ContextComposition | null>) {
      state.ui.selectedSegment = action.payload;
    },
    
    selectEvent(state, action: PayloadAction<CompactionEvent | InjectionEvent | null>) {
      state.ui.selectedEvent = action.payload;
    },
    
    setChartRange(state, action: PayloadAction<{ start: number; end: number } | null>) {
      state.ui.chartRange = action.payload;
    },
    
    // 清空数据
    clearData(state) {
      return initialState;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchContextData.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchContextData.fulfilled, (state, action) => {
        state.loading = false;
        // 处理获取的数据
        if (action.payload.snapshots) {
          state.evolution.snapshots = action.payload.snapshots;
        }
        if (action.payload.compactionEvents) {
          state.evolution.compactionEvents = action.payload.compactionEvents;
        }
        if (action.payload.injectionEvents) {
          state.evolution.injectionEvents = action.payload.injectionEvents;
        }
        updateStatistics(state);
      })
      .addCase(fetchContextData.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });
  },
});

// 辅助函数：更新统计信息
function updateStatistics(state: ContextVisualizationState) {
  const { snapshots } = state.evolution;
  if (snapshots.length === 0) return;
  
  const utilizations = snapshots.map(s => s.utilization);
  state.evolution.statistics.avgUtilization = 
    utilizations.reduce((sum, u) => sum + u, 0) / utilizations.length;
  state.evolution.statistics.peakUtilization = Math.max(...utilizations);
  
  const totalInputTokens = snapshots[snapshots.length - 1]?.usedTokens || 0;
  state.evolution.statistics.compactionFrequency = 
    totalInputTokens > 0 
      ? (state.evolution.statistics.compactionCount / totalInputTokens) * 1000 
      : 0;
}

export const {
  updateSnapshot,
  addCompactionEvent,
  addInjectionEvent,
  toggleDetails,
  selectSegment,
  selectEvent,
  setChartRange,
  clearData,
} = contextVisualizationSlice.actions;

export default contextVisualizationSlice.reducer;
```

### 4.2 事件监听器

```typescript
// listeners/contextEventListener.ts

import { SessionEvent } from '@deepseek-ai/dsh-session';
import { store } from '../store';
import { updateSnapshot, addCompactionEvent, addInjectionEvent } from '../store/contextVisualizationSlice';
import { inferContextComposition, estimateTokens } from '../utils/contextUtils';

export class ContextEventListener {
  private sessionId: string;
  private eventBuffer: SessionEvent[] = [];
  private lastSnapshotSeq: number = 0;
  
  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }
  
  /** 处理新事件 */
  handleEvent(event: SessionEvent) {
    this.eventBuffer.push(event);
    
    // 根据事件类型更新状态
    switch (event.type) {
      case 'assistant/message':
        this.handleAssistantMessage(event);
        break;
      case 'compaction/summary':
        this.handleCompactionSummary(event);
        break;
      case 'compaction/end':
        this.handleCompactionEnd(event);
        break;
      // 其他事件类型...
    }
  }
  
  /** 处理助手消息事件 */
  private handleAssistantMessage(event: SessionEvent) {
    // 每 N 个事件或每次模型调用后创建快照
    if (this.eventBuffer.length >= 10 || event.data.usage) {
      this.createSnapshot(event);
      this.eventBuffer = [];
    }
  }
  
  /** 处理压缩摘要事件 */
  private handleCompactionSummary(event: SessionEvent) {
    const compactionEvent: CompactionEvent = {
      id: `compaction-${event.seq}`,
      timestamp: event.time,
      seq: event.seq,
      turn: event.data.turn,
      beforeTokens: this.estimateBeforeTokens(),
      afterTokens: this.estimateAfterTokens(event.data.shadowedTokenCount),
      reclaimedTokens: event.data.shadowedTokenCount,
      reclaimRatio: event.data.shadowedTokenCount / this.estimateBeforeTokens(),
      trigger: 'auto',
      details: {
        compressedSummary: '历史对话被压缩为摘要',
        retainedSummary: '保留最近 N 轮对话',
      },
    };
    
    store.dispatch(addCompactionEvent(compactionEvent));
  }
  
  /** 创建上下文快照 */
  private createSnapshot(event: SessionEvent) {
    const composition = inferContextComposition(this.eventBuffer);
    const totalTokens = Object.values(composition).reduce((sum, seg) => sum + seg.tokens, 0);
    const capacity = event.data.usage?.contextWindow || 128000; // 默认 128K
    
    const snapshot: ContextWindowSnapshot = {
      timestamp: event.time,
      seq: event.seq,
      turn: event.data.turn,
      capacity,
      usedTokens: totalTokens,
      utilization: totalTokens / capacity,
      composition,
      metadata: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        contextWindowLimit: capacity,
      },
    };
    
    store.dispatch(updateSnapshot(snapshot));
    this.lastSnapshotSeq = event.seq;
  }
  
  /** 估算压缩前 Token 数 */
  private estimateBeforeTokens(): number {
    const lastSnapshot = store.getState().contextVisualization.currentSnapshot;
    return lastSnapshot?.usedTokens || 0;
  }
  
  /** 估算压缩后 Token 数 */
  private estimateAfterTokens(reclaimedTokens: number): number {
    return Math.max(0, this.estimateBeforeTokens() - reclaimedTokens);
  }
}
```

---

## 5. 性能优化

### 5.1 虚拟滚动

```typescript
// components/VirtualizedList.tsx

import { FixedSizeList } from 'react-window';

interface VirtualizedListProps {
  items: any[];
  itemHeight: number;
  renderItem: (index: number, style: React.CSSProperties) => React.ReactNode;
}

const VirtualizedList: React.FC<VirtualizedListProps> = ({
  items,
  itemHeight,
  renderItem,
}) => {
  return (
    <FixedSizeList
      height={600}
      itemCount={items.length}
      itemSize={itemHeight}
      width="100%"
    >
      {({ index, style }) => renderItem(index, style)}
    </FixedSizeList>
  );
};
```

### 5.2 Web Worker 计算

```typescript
// workers/contextWorker.ts

self.onmessage = (event: MessageEvent) => {
  const { type, data } = event.data;
  
  switch (type) {
    case 'INFER_COMPOSITION':
      const composition = inferContextComposition(data.events);
      self.postMessage({ type: 'COMPOSITION_RESULT', data: composition });
      break;
    case 'CALCULATE_STATISTICS':
      const statistics = calculateStatistics(data.snapshots);
      self.postMessage({ type: 'STATISTICS_RESULT', data: statistics });
      break;
  }
};

// 在主线程中使用
const worker = new Worker(new URL('../workers/contextWorker.ts', import.meta.url));

worker.onmessage = (event) => {
  const { type, data } = event.data;
  switch (type) {
    case 'COMPOSITION_RESULT':
      dispatch(updateComposition(data));
      break;
    case 'STATISTICS_RESULT':
      dispatch(updateStatistics(data));
      break;
  }
};
```

### 5.3 防抖与节流

```typescript
// utils/debounce.ts

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// 使用示例
const debouncedUpdate = debounce((snapshot) => {
  dispatch(updateSnapshot(snapshot));
}, 500);

const throttledChartUpdate = throttle((data) => {
  dispatch(updateChartData(data));
}, 100);
```

---

## 6. 隐私与安全

### 6.1 敏感信息过滤

```typescript
// utils/privacyFilter.ts

/** 过滤敏感内容 */
export function filterSensitiveContent(content: string): string {
  // 移除文件路径
  content = content.replace(/\/[^\s]+\.[a-z]+/gi, '[FILE_PATH]');
  
  // 移除 API Key
  content = content.replace(/sk-[a-zA-Z0-9]{32,}/g, '[API_KEY]');
  
  // 移除邮箱
  content = content.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');
  
  // 移除 IP 地址
  content = content.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP]');
  
  return content;
}

/** 生成内容摘要（不包含敏感信息） */
export function generateSummary(content: string, maxLength: number = 100): string {
  const filtered = filterSensitiveContent(content);
  if (filtered.length <= maxLength) return filtered;
  return filtered.substring(0, maxLength) + '...';
}
```

### 6.2 数据本地化

```typescript
// utils/storage.ts

/** 本地存储（不上传云端） */
export class LocalStorage {
  private storageKey = 'dsh-eval-control-context-data';
  
  save(data: ContextVisualizationState): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
    }
  }
  
  load(): ContextVisualizationState | null {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Failed to load from localStorage:', error);
      return null;
    }
  }
  
  clear(): void {
    localStorage.removeItem(this.storageKey);
  }
}
```

---

## 7. 测试策略

### 7.1 单元测试

```typescript
// __tests__/contextUtils.test.ts

import { inferContextComposition, estimateTokens } from '../utils/contextUtils';

describe('contextUtils', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens for Chinese text', () => {
      const text = '你好世界';
      const tokens = estimateTokens(text);
      expect(tokens).toBe(3); // 4 个中文字符 ≈ 3 tokens
    });
    
    it('should estimate tokens for English text', () => {
      const text = 'Hello World';
      const tokens = estimateTokens(text);
      expect(tokens).toBe(3); // 11 个字符 ≈ 3 tokens
    });
    
    it('should handle empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });
  });
  
  describe('inferContextComposition', () => {
    it('should infer composition from events', () => {
      const events = [
        { type: 'system/message', data: { content: 'You are a helpful assistant' } },
        { type: 'user/message', data: { content: 'Hello' } },
        { type: 'assistant/message', data: { content: 'Hi there!' } },
      ];
      
      const composition = inferContextComposition(events as any);
      
      expect(composition.systemPrompt.tokens).toBeGreaterThan(0);
      expect(composition.conversationHistory.tokens).toBeGreaterThan(0);
    });
  });
});
```

### 7.2 集成测试

```typescript
// __tests__/contextVisualization.integration.test.ts

import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import ContextVisualizationView from '../components/ContextVisualizationView';
import contextVisualizationReducer from '../store/contextVisualizationSlice';

describe('ContextVisualizationView Integration', () => {
  let store: ReturnType<typeof configureStore>;
  
  beforeEach(() => {
    store = configureStore({
      reducer: {
        contextVisualization: contextVisualizationReducer,
      },
    });
  });
  
  it('should render utilization gauge', async () => {
    render(
      <Provider store={store}>
        <ContextVisualizationView sessionId="test-session" />
      </Provider>
    );
    
    await waitFor(() => {
      expect(screen.getByText(/上下文占用率/i)).toBeInTheDocument();
    });
  });
  
  it('should update when new events arrive', async () => {
    render(
      <Provider store={store}>
        <ContextVisualizationView sessionId="test-session" />
      </Provider>
    );
    
    // 模拟事件到达
    store.dispatch(updateSnapshot({
      timestamp: Date.now(),
      seq: 1,
      turn: 1,
      capacity: 128000,
      usedTokens: 50000,
      utilization: 0.39,
      composition: { /* ... */ },
      metadata: { provider: 'deepseek', model: 'deepseek-chat', contextWindowLimit: 128000 },
    }));
    
    await waitFor(() => {
      expect(screen.getByText('39.1%')).toBeInTheDocument();
    });
  });
});
```

---

## 8. 部署与监控

### 8.1 性能指标监控

```typescript
// utils/performanceMonitor.ts

export class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();
  
  recordMetric(name: string, value: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(value);
  }
  
  getAverage(name: string): number {
    const values = this.metrics.get(name) || [];
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }
  
  getP95(name: string): number {
    const values = (this.metrics.get(name) || []).sort((a, b) => a - b);
    if (values.length === 0) return 0;
    const index = Math.floor(values.length * 0.95);
    return values[index];
  }
  
  report(): void {
    console.log('Performance Metrics:');
    for (const [name, values] of this.metrics) {
      console.log(`  ${name}: avg=${this.getAverage(name).toFixed(2)}ms, p95=${this.getP95(name).toFixed(2)}ms`);
    }
  }
}

// 使用示例
const monitor = new PerformanceMonitor();

// 在关键操作处记录
const startTime = performance.now();
// ... 执行操作 ...
monitor.recordMetric('snapshot_update', performance.now() - startTime);
```

### 8.2 错误边界

```typescript
// components/ErrorBoundary.tsx

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }
  
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ContextVisualization Error:', error, errorInfo);
    // 可以上报错误到监控服务
  }
  
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="error-boundary">
          <h3>上下文可视化组件出错</h3>
          <p>{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            重试
          </button>
        </div>
      );
    }
    
    return this.props.children;
  }
}
```

---

## 9. 总结

### 9.1 技术栈

- **框架**: React 18+
- **状态管理**: Redux Toolkit
- **图表**: D3.js / Recharts
- **虚拟化**: react-window
- **构建**: Vite / esbuild
- **测试**: Jest + React Testing Library
- **类型**: TypeScript 5+

### 9.2 关键决策

1. **数据推断 vs 直接获取**：由于 DSH API 可能不直接提供上下文组成，采用从事件流推断的策略
2. **性能优化**：使用虚拟滚动、Web Worker、防抖/节流确保流畅体验
3. **隐私保护**：所有数据本地存储，敏感信息过滤
4. **错误处理**：完善的错误边界和降级策略

### 9.3 风险与缓解

| 风险 | 影响 | 缓解策略 |
|------|------|---------|
| DSH API 变更 | 高 | 抽象数据层，快速适配 |
| 性能问题 | 中 | 虚拟滚动、Worker、防抖 |
| 数据不准确 | 中 | 提供"估算"标记，透明化 |
| 隐私泄露 | 高 | 敏感信息过滤，本地存储 |

---

**文档结束**
