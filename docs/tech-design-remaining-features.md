# dsh-eval-control 技术设计文档（剩余功能）

**版本**: v1.0  
**日期**: 2026-10-18  
**作者**: xyrrrrr-r  
**状态**: 草案  
**关联 PRD**: [PRD-v1.0.md](./PRD-v1.0.md) §3.6-§3.9

---

## 1. 交互式 Dashboard 重构 (§3.6)

### 1.1 功能描述

重新设计 Dashboard 布局，提升信息密度和可读性，支持多视图切换和个性化配置。

### 1.2 组件架构

```
DashboardView
├── DashboardHeader (顶部导航栏)
│   ├── Logo & Title
│   ├── ViewSwitcher (视图切换器)
│   ├── SettingsButton (设置按钮)
│   └── ExportButton (导出按钮)
├── StatusBar (状态栏 - 固定顶部)
│   ├── ContextUtilizationBadge (上下文占用徽章)
│   ├── SessionModeBadge (会话模式徽章)
│   ├── SessionDuration (会话时长)
│   └── QuickActions (快速操作菜单)
├── MetricsCardsRow (指标卡片行)
│   ├── MetricCard (可复用卡片组件)
│   │   ├── MetricIcon
│   │   ├── MetricValue
│   │   ├── MetricLabel
│   │   ├── TrendIndicator (趋势箭头)
│   │   └── SparklineChart (迷你图)
│   └── ... (4-6 个卡片)
├── MainContentArea (主内容区)
│   ├── TabBar (Tab 切换栏)
│   │   ├── Tab: ContextEvolution (上下文演化)
│   │   ├── Tab: TokenTrend (Token 趋势)
│   │   ├── Tab: ToolCallDistribution (工具调用分布)
│   │   ├── Tab: TeamActivity (Team 活动)
│   │   └── Tab: MetricsDetail (指标明细)
│   └── TabContent (Tab 内容区)
│       ├── ContextEvolutionView
│       ├── TokenTrendView
│       ├── ToolCallDistributionView
│       ├── TeamActivityView
│       └── MetricsDetailView
└── CollapsibleDetailPanel (可折叠详细面板)
    ├── PanelHeader (可点击折叠)
    ├── SearchBar (搜索框)
    ├── FilterBar (筛选栏)
    ├── SortControls (排序控制)
    ── DataTable (数据表格)
        ├── VirtualizedRows (虚拟滚动行)
        └── RowActions (行操作按钮)
```

### 1.3 状态管理

```typescript
// store/dashboardSlice.ts

interface DashboardState {
  /** 当前视图模式 */
  viewMode: 'compact' | 'detailed' | 'fullscreen';
  
  /** 当前激活的 Tab */
  activeTab: 'context' | 'token' | 'tool' | 'team' | 'metrics';
  
  /** 指标卡片配置 */
  metricsCards: {
    visible: boolean;
    order: string[];
    pinned: string[];
  };
  
  /** 状态栏配置 */
  statusBar: {
    visible: boolean;
    items: string[];
  };
  
  /** 详细面板配置 */
  detailPanel: {
    expanded: boolean;
    height: number;
    searchQuery: string;
    filters: Record<string, any>;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
  };
  
  /** 用户偏好 */
  preferences: {
    theme: 'light' | 'dark' | 'auto';
    compactMode: boolean;
    animationsEnabled: boolean;
    refreshInterval: number; // ms
  };
}

const initialState: DashboardState = {
  viewMode: 'detailed',
  activeTab: 'context',
  metricsCards: {
    visible: true,
    order: ['context_utilization', 'token_consumption', 'tool_calls', 'error_rate'],
    pinned: ['context_utilization'],
  },
  statusBar: {
    visible: true,
    items: ['context_utilization', 'session_mode', 'session_duration'],
  },
  detailPanel: {
    expanded: true,
    height: 300,
    searchQuery: '',
    filters: {},
    sortBy: 'timestamp',
    sortOrder: 'desc',
  },
  preferences: {
    theme: 'auto',
    compactMode: false,
    animationsEnabled: true,
    refreshInterval: 5000,
  },
};
```

### 1.4 核心组件实现

#### 1.4.1 指标卡片 (MetricCard)

```typescript
interface MetricCardProps {
  /** 指标 ID */
  metricId: string;
  /** 当前值 */
  value: number | string;
  /** 标签 */
  label: string;
  /** 图标 */
  icon: React.ReactNode;
  /** 趋势（可选） */
  trend?: {
    direction: 'up' | 'down' | 'stable';
    percentage: number;
  };
  /** 迷你图数据（可选） */
  sparklineData?: number[];
  /** 点击跳转 */
  onClick?: () => void;
  /** 是否置顶 */
  pinned?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({
  metricId,
  value,
  label,
  icon,
  trend,
  sparklineData,
  onClick,
  pinned,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  
  const getTrendColor = () => {
    if (!trend) return '#9aa0a6';
    return trend.direction === 'up' ? '#34a853' : 
           trend.direction === 'down' ? '#ea4335' : '#9aa0a6';
  };
  
  return (
    <div
      className={`metric-card ${pinned ? 'pinned' : ''} ${isHovered ? 'hovered' : ''}`}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="button"
      aria-label={`${label}: ${value}`}
    >
      <div className="card-header">
        <span className="card-icon">{icon}</span>
        {pinned && <span className="pin-icon">📌</span>}
      </div>
      
      <div className="card-value">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      
      <div className="card-label">{label}</div>
      
      {trend && (
        <div className="card-trend" style={{ color: getTrendColor() }}>
          <TrendArrow direction={trend.direction} />
          <span>{trend.percentage.toFixed(1)}%</span>
        </div>
      )}
      
      {sparklineData && sparklineData.length > 0 && (
        <div className="card-sparkline">
          <SparklineChart data={sparklineData} />
        </div>
      )}
    </div>
  );
};
```

#### 1.4.2 Tab 切换栏 (TabBar)

```typescript
interface TabBarProps {
  tabs: Array<{
    id: string;
    label: string;
    icon?: React.ReactNode;
    badge?: number;
  }>;
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

const TabBar: React.FC<TabBarProps> = ({ tabs, activeTab, onTabChange }) => {
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  
  useEffect(() => {
    const activeElement = tabRefs.current.get(activeTab);
    if (activeElement) {
      setIndicatorStyle({
        left: activeElement.offsetLeft,
        width: activeElement.offsetWidth,
      });
    }
  }, [activeTab]);
  
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map(tab => (
        <button
          key={tab.id}
          ref={el => { if (el) tabRefs.current.set(tab.id, el); }}
          className={`tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          role="tab"
          aria-selected={activeTab === tab.id}
        >
          {tab.icon && <span className="tab-icon">{tab.icon}</span>}
          <span className="tab-label">{tab.label}</span>
          {tab.badge !== undefined && tab.badge > 0 && (
            <span className="tab-badge">{tab.badge}</span>
          )}
        </button>
      ))}
      <div
        className="tab-indicator"
        style={{
          transform: `translateX(${indicatorStyle.left}px)`,
          width: `${indicatorStyle.width}px`,
        }}
      />
    </div>
  );
};
```

#### 1.4.3 可折叠详细面板 (CollapsibleDetailPanel)

```typescript
interface CollapsibleDetailPanelProps {
  /** 面板标题 */
  title: string;
  /** 是否展开 */
  expanded: boolean;
  /** 切换展开/折叠 */
  onToggle: () => void;
  /** 面板高度 */
  height: number;
  /** 内容组件 */
  children: React.ReactNode;
  /** 搜索框 */
  searchValue: string;
  onSearchChange: (value: string) => void;
  /** 筛选器 */
  filters: Record<string, any>;
  onFilterChange: (filters: Record<string, any>) => void;
  /** 排序 */
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSortChange: (sortBy: string, sortOrder: 'asc' | 'desc') => void;
}

const CollapsibleDetailPanel: React.FC<CollapsibleDetailPanelProps> = ({
  title,
  expanded,
  onToggle,
  height,
  children,
  searchValue,
  onSearchChange,
  filters,
  onFilterChange,
  sortBy,
  sortOrder,
  onSortChange,
}) => {
  return (
    <div className={`collapsible-panel ${expanded ? 'expanded' : 'collapsed'}`}>
      <div className="panel-header" onClick={onToggle}>
        <h3>{title}</h3>
        <div className="panel-controls">
          {expanded && (
            <>
              <input
                type="text"
                className="search-input"
                placeholder="搜索..."
                value={searchValue}
                onChange={e => onSearchChange(e.target.value)}
                onClick={e => e.stopPropagation()}
              />
              <FilterDropdown filters={filters} onChange={onFilterChange} />
              <SortDropdown
                sortBy={sortBy}
                sortOrder={sortOrder}
                onChange={onSortChange}
              />
            </>
          )}
          <button className="toggle-button">
            {expanded ? '▼' : '▶'}
          </button>
        </div>
      </div>
      
      {expanded && (
        <div
          className="panel-content"
          style={{ height: `${height}px` }}
        >
          {children}
        </div>
      )}
    </div>
  );
};
```

### 1.5 响应式布局

```typescript
// hooks/useResponsiveLayout.ts

interface LayoutConfig {
  columns: number;
  cardSize: 'small' | 'medium' | 'large';
  showSparklines: boolean;
  detailPanelHeight: number;
}

export function useResponsiveLayout(): LayoutConfig {
  const [width, setWidth] = useState(window.innerWidth);
  
  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  if (width < 768) {
    // 移动端
    return {
      columns: 1,
      cardSize: 'small',
      showSparklines: false,
      detailPanelHeight: 200,
    };
  } else if (width < 1200) {
    // 平板端
    return {
      columns: 2,
      cardSize: 'medium',
      showSparklines: true,
      detailPanelHeight: 250,
    };
  } else {
    // 桌面端
    return {
      columns: 4,
      cardSize: 'large',
      showSparklines: true,
      detailPanelHeight: 300,
    };
  }
}
```

### 1.6 性能优化

```typescript
// 虚拟滚动优化
import { FixedSizeList } from 'react-window';

const VirtualizedDataTable: React.FC<{
  data: any[];
  rowHeight: number;
  renderRow: (index: number, style: React.CSSProperties) => React.ReactNode;
}> = ({ data, rowHeight, renderRow }) => {
  return (
    <FixedSizeList
      height={600}
      itemCount={data.length}
      itemSize={rowHeight}
      width="100%"
      overscanCount={10}
    >
      {({ index, style }) => renderRow(index, style)}
    </FixedSizeList>
  );
};

// 防抖搜索
const useDebouncedSearch = (delay: number = 300) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(searchTerm), delay);
    return () => clearTimeout(timer);
  }, [searchTerm, delay]);
  
  return { searchTerm, setSearchTerm, debouncedTerm };
};
```

---

## 2. 智能告警与建议 (§3.7)

### 2.1 功能描述

基于数据分析，主动提供告警和优化建议，帮助用户发现潜在问题并改进 Agent 配置。

### 2.2 告警规则引擎

```typescript
// rules/alertRules.ts

interface AlertRule {
  /** 规则 ID */
  id: string;
  /** 规则名称 */
  name: string;
  /** 严重级别 */
  severity: 'critical' | 'warning' | 'info';
  /** 触发条件 */
  condition: (metrics: MetricsSnapshot) => boolean;
  /** 告警消息 */
  message: (metrics: MetricsSnapshot) => string;
  /** 优化建议 */
  suggestion: (metrics: MetricsSnapshot) => string;
  /** 建议操作（可选） */
  action?: {
    label: string;
    execute: (metrics: MetricsSnapshot) => Promise<void>;
  };
}

/** 指标快照 */
interface MetricsSnapshot {
  contextUtilization: number;
  compactionFrequency: number;
  toolErrorRate: number;
  repeatCallCount: number;
  longGapCount: number;
  retryCount: number;
  // ... 其他指标
}

/** 内置告警规则 */
export const builtInAlertRules: AlertRule[] = [
  {
    id: 'context_high_utilization',
    name: '上下文占用率过高',
    severity: 'warning',
    condition: (m) => m.contextUtilization > 0.8,
    message: (m) => `上下文占用率已达 ${(m.contextUtilization * 100).toFixed(1)}%，接近窗口上限`,
    suggestion: () => '建议启用更激进的压缩策略，或减少工具定义数量',
    action: {
      label: '调整压缩策略',
      execute: async () => {
        // 调用 DSH API 调整压缩配置
        await adjustCompactionStrategy('aggressive');
      },
    },
  },
  {
    id: 'frequent_compaction',
    name: '频繁压缩',
    severity: 'warning',
    condition: (m) => m.compactionFrequency > 5,
    message: (m) => `压缩频率达 ${m.compactionFrequency.toFixed(1)} 次/千 Token，过高`,
    suggestion: () => '建议减少工具定义数量，或增大上下文窗口',
  },
  {
    id: 'high_tool_error_rate',
    name: '工具错误率过高',
    severity: 'critical',
    condition: (m) => m.toolErrorRate > 0.1,
    message: (m) => `工具错误率达 ${(m.toolErrorRate * 100).toFixed(1)}%`,
    suggestion: () => '检查工具参数格式，或查看工具文档',
  },
  {
    id: 'repeat_calls',
    name: '重复调用过多',
    severity: 'info',
    condition: (m) => m.repeatCallCount > 3,
    message: (m) => `检测到 ${m.repeatCallCount} 次重复调用`,
    suggestion: () => '建议启用结果缓存，避免重复计算',
  },
  {
    id: 'long_gaps',
    name: '长间隔过多',
    severity: 'info',
    condition: (m) => m.longGapCount > 2,
    message: (m) => `检测到 ${m.longGapCount} 个长间隔（≥30s）`,
    suggestion: () => '检查工具响应时间，或优化 Agent 逻辑',
  },
];
```

### 2.3 告警管理器

```typescript
// services/alertManager.ts

interface Alert {
  id: string;
  ruleId: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  suggestion: string;
  timestamp: number;
  dismissed: boolean;
  resolved: boolean;
  actionExecuted: boolean;
}

class AlertManager {
  private rules: AlertRule[];
  private alerts: Alert[] = [];
  private listeners: Array<(alerts: Alert[]) => void> = [];
  
  constructor(rules: AlertRule[] = builtInAlertRules) {
    this.rules = rules;
  }
  
  /** 评估指标并生成告警 */
  evaluate(metrics: MetricsSnapshot): Alert[] {
    const newAlerts: Alert[] = [];
    
    for (const rule of this.rules) {
      if (rule.condition(metrics)) {
        const existingAlert = this.alerts.find(
          a => a.ruleId === rule.id && !a.resolved
        );
        
        if (!existingAlert) {
          const alert: Alert = {
            id: `alert-${Date.now()}-${rule.id}`,
            ruleId: rule.id,
            severity: rule.severity,
            message: rule.message(metrics),
            suggestion: rule.suggestion(metrics),
            timestamp: Date.now(),
            dismissed: false,
            resolved: false,
            actionExecuted: false,
          };
          newAlerts.push(alert);
        }
      }
    }
    
    this.alerts = [...this.alerts, ...newAlerts];
    this.notifyListeners();
    
    return newAlerts;
  }
  
  /** 忽略告警 */
  dismissAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.dismissed = true;
      this.notifyListeners();
    }
  }
  
  /** 标记已解决 */
  resolveAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      this.notifyListeners();
    }
  }
  
  /** 执行建议操作 */
  async executeAction(alertId: string): Promise<void> {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert) return;
    
    const rule = this.rules.find(r => r.id === alert.ruleId);
    if (rule?.action) {
      await rule.action.execute({} as MetricsSnapshot);
      alert.actionExecuted = true;
      this.notifyListeners();
    }
  }
  
  /** 获取未处理告警 */
  getActiveAlerts(): Alert[] {
    return this.alerts.filter(a => !a.dismissed && !a.resolved);
  }
  
  /** 订阅告警变化 */
  subscribe(listener: (alerts: Alert[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
  
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.getActiveAlerts());
    }
  }
}
```

### 2.4 告警 UI 组件

```typescript
// components/AlertPanel.tsx

interface AlertPanelProps {
  alerts: Alert[];
  onDismiss: (alertId: string) => void;
  onResolve: (alertId: string) => void;
  onExecuteAction: (alertId: string) => void;
}

const AlertPanel: React.FC<AlertPanelProps> = ({
  alerts,
  onDismiss,
  onResolve,
  onExecuteAction,
}) => {
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all');
  
  const filteredAlerts = filter === 'all'
    ? alerts
    : alerts.filter(a => a.severity === filter);
  
  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return '🔴';
      case 'warning': return '🟡';
      case 'info': return '🔵';
      default: return '⚪';
    }
  };
  
  return (
    <div className="alert-panel">
      <div className="alert-header">
        <h3>智能告警</h3>
        <div className="alert-filters">
          {(['all', 'critical', 'warning', 'info'] as const).map(f => (
            <button
              key={f}
              className={`filter-btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? '全部' : f}
            </button>
          ))}
        </div>
      </div>
      
      {filteredAlerts.length === 0 ? (
        <div className="no-alerts">
          <span className="success-icon">✅</span>
          <p>一切正常</p>
        </div>
      ) : (
        <div className="alert-list">
          {filteredAlerts.map(alert => (
            <div
              key={alert.id}
              className={`alert-item ${alert.severity}`}
            >
              <div className="alert-icon">
                {getSeverityIcon(alert.severity)}
              </div>
              
              <div className="alert-content">
                <div className="alert-message">{alert.message}</div>
                <div className="alert-suggestion">
                  💡 {alert.suggestion}
                </div>
                <div className="alert-timestamp">
                  {new Date(alert.timestamp).toLocaleTimeString()}
                </div>
              </div>
              
              <div className="alert-actions">
                {alert.actionExecuted ? (
                  <span className="action-executed">✅ 已执行</span>
                ) : (
                  <button
                    className="execute-btn"
                    onClick={() => onExecuteAction(alert.id)}
                  >
                    应用建议
                  </button>
                )}
                <button
                  className="resolve-btn"
                  onClick={() => onResolve(alert.id)}
                >
                  标记解决
                </button>
                <button
                  className="dismiss-btn"
                  onClick={() => onDismiss(alert.id)}
                >
                  忽略
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

### 2.5 告警规则配置

```typescript
// components/AlertRulesConfig.tsx

interface AlertRulesConfigProps {
  rules: AlertRule[];
  enabledRules: string[];
  onToggleRule: (ruleId: string) => void;
  thresholds: Record<string, number>;
  onThresholdChange: (ruleId: string, threshold: number) => void;
}

const AlertRulesConfig: React.FC<AlertRulesConfigProps> = ({
  rules,
  enabledRules,
  onToggleRule,
  thresholds,
  onThresholdChange,
}) => {
  return (
    <div className="alert-rules-config">
      <h3>告警规则配置</h3>
      
      {rules.map(rule => (
        <div key={rule.id} className="rule-item">
          <div className="rule-header">
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={enabledRules.includes(rule.id)}
                onChange={() => onToggleRule(rule.id)}
              />
              <span className="toggle-slider"></span>
            </label>
            <span className="rule-name">{rule.name}</span>
            <span className={`rule-severity ${rule.severity}`}>
              {rule.severity}
            </span>
          </div>
          
          {enabledRules.includes(rule.id) && (
            <div className="rule-config">
              <label>
                阈值:
                <input
                  type="number"
                  value={thresholds[rule.id] ?? 0}
                  onChange={e => onThresholdChange(rule.id, parseFloat(e.target.value))}
                  step="0.1"
                />
              </label>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
```

---

## 3. 对比分析 (§3.8)

### 3.1 功能描述

支持多次运行或不同配置的对比分析，帮助用户找出最优配置。

### 3.2 数据模型

```typescript
// types/comparison.ts

interface ComparisonSession {
  /** 会话 ID */
  sessionId: string;
  /** 会话名称 */
  name: string;
  /** 时间戳 */
  timestamp: number;
  /** 配置摘要 */
  config: {
    model: string;
    contextWindow: number;
    tools: string[];
    compactionStrategy: string;
  };
  /** 指标数据 */
  metrics: {
    totalTokens: number;
    totalCost: number;
    duration: number;
    turns: number;
    toolCalls: number;
    errorRate: number;
    compactionCount: number;
    avgContextUtilization: number;
  };
  /** 演化数据 */
  evolution: {
    contextUtilizationOverTime: number[];
    tokenConsumptionOverTime: number[];
  };
}

interface ComparisonResult {
  /** 参与对比的会话 */
  sessions: ComparisonSession[];
  /** 对比指标 */
  metrics: {
    [metricId: string]: {
      values: { sessionId: string; value: number }[];
      best: string; // sessionId
      worst: string; // sessionId
      avg: number;
      stdDev: number;
    };
  };
  /** 差异摘要 */
  summary: {
    lowestTokenConsumption: string;
    lowestCost: string;
    lowestErrorRate: string;
    fastestCompletion: string;
  };
  /** 建议 */
  recommendations: string[];
}
```

### 3.3 对比分析服务

```typescript
// services/comparisonService.ts

class ComparisonService {
  /** 执行对比分析 */
  async compare(sessionIds: string[]): Promise<ComparisonResult> {
    const sessions = await Promise.all(
      sessionIds.map(id => this.loadSession(id))
    );
    
    const metrics = this.calculateMetrics(sessions);
    const summary = this.generateSummary(sessions, metrics);
    const recommendations = this.generateRecommendations(sessions, metrics);
    
    return { sessions, metrics, summary, recommendations };
  }
  
  /** 计算对比指标 */
  private calculateMetrics(sessions: ComparisonSession[]): ComparisonResult['metrics'] {
    const metricIds = [
      'totalTokens', 'totalCost', 'duration', 'turns',
      'toolCalls', 'errorRate', 'compactionCount', 'avgContextUtilization'
    ];
    
    const metrics: ComparisonResult['metrics'] = {};
    
    for (const metricId of metricIds) {
      const values = sessions.map(s => ({
        sessionId: s.sessionId,
        value: s.metrics[metricId as keyof typeof s.metrics],
      }));
      
      const numericValues = values.map(v => v.value);
      const avg = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
      const stdDev = Math.sqrt(
        numericValues.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / numericValues.length
      );
      
      metrics[metricId] = {
        values,
        best: values.reduce((min, v) => v.value < min.value ? v : min).sessionId,
        worst: values.reduce((max, v) => v.value > max.value ? v : max).sessionId,
        avg,
        stdDev,
      };
    }
    
    return metrics;
  }
  
  /** 生成差异摘要 */
  private generateSummary(
    sessions: ComparisonSession[],
    metrics: ComparisonResult['metrics']
  ): ComparisonResult['summary'] {
    return {
      lowestTokenConsumption: metrics.totalTokens.best,
      lowestCost: metrics.totalCost.best,
      lowestErrorRate: metrics.errorRate.best,
      fastestCompletion: metrics.duration.best,
    };
  }
  
  /** 生成优化建议 */
  private generateRecommendations(
    sessions: ComparisonSession[],
    metrics: ComparisonResult['metrics']
  ): string[] {
    const recommendations: string[] = [];
    
    // 找出 Token 消耗最低的会话
    const bestTokenSession = sessions.find(
      s => s.sessionId === metrics.totalTokens.best
    );
    if (bestTokenSession) {
      recommendations.push(
        `会话 "${bestTokenSession.name}" 的 Token 消耗最低，建议参考其配置`
      );
    }
    
    // 检查错误率
    if (metrics.errorRate.avg > 0.1) {
      recommendations.push(
        '平均错误率超过 10%，建议检查工具参数格式或启用重试机制'
      );
    }
    
    // 检查压缩频率
    if (metrics.compactionCount.avg > 5) {
      recommendations.push(
        '平均压缩次数过多，建议减少工具定义数量或增大上下文窗口'
      );
    }
    
    return recommendations;
  }
  
  /** 加载会话数据 */
  private async loadSession(sessionId: string): Promise<ComparisonSession> {
    // 从本地存储或 DSH API 加载
    // ...
  }
}
```

### 3.4 对比图表组件

```typescript
// components/ComparisonCharts.tsx

interface ComparisonChartsProps {
  result: ComparisonResult;
  selectedMetrics: string[];
}

const ComparisonCharts: React.FC<ComparisonChartsProps> = ({
  result,
  selectedMetrics,
}) => {
  const colors = ['#1a73e8', '#34a853', '#f29900', '#9334e6'];
  
  return (
    <div className="comparison-charts">
      {/* 柱状图对比 */}
      <div className="chart-section">
        <h4>指标对比</h4>
        <BarChart
          data={selectedMetrics.map(metricId => ({
            name: metricId,
            values: result.sessions.map((session, i) => ({
              name: session.name,
              value: result.metrics[metricId].values[i].value,
              fill: colors[i % colors.length],
            })),
          }))}
          layout="vertical"
        >
          <XAxis type="number" />
          <YAxis type="category" dataKey="name" />
          <Tooltip />
          <Legend />
        </BarChart>
      </div>
      
      {/* 雷达图对比 */}
      <div className="chart-section">
        <h4>多维度能力对比</h4>
        <RadarChart
          data={result.sessions.map((session, i) => ({
            subject: session.name,
            ...selectedMetrics.reduce((acc, metricId) => ({
              ...acc,
              [metricId]: result.metrics[metricId].values[i].value,
            }), {}),
            fill: colors[i % colors.length],
          }))}
        >
          <PolarGrid />
          <PolarAngleAxis dataKey="subject" />
          <PolarRadiusAxis />
          {selectedMetrics.map((metricId, i) => (
            <Radar
              key={metricId}
              name={metricId}
              dataKey={metricId}
              stroke={colors[i % colors.length]}
              fill={colors[i % colors.length]}
              fillOpacity={0.3}
            />
          ))}
          <Legend />
        </RadarChart>
      </div>
      
      {/* 差异报告 */}
      <div className="difference-report">
        <h4>差异摘要</h4>
        <ul>
          <li>
            🏆 Token 消耗最低: 
            {result.sessions.find(s => s.sessionId === result.summary.lowestTokenConsumption)?.name}
          </li>
          <li>
            💰 成本最低: 
            {result.sessions.find(s => s.sessionId === result.summary.lowestCost)?.name}
          </li>
          <li>
            ✅ 错误率最低: 
            {result.sessions.find(s => s.sessionId === result.summary.lowestErrorRate)?.name}
          </li>
          <li>
            ⚡ 完成最快: 
            {result.sessions.find(s => s.sessionId === result.summary.fastestCompletion)?.name}
          </li>
        </ul>
        
        <h4>优化建议</h4>
        <ul>
          {result.recommendations.map((rec, i) => (
            <li key={i}>💡 {rec}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};
```

### 3.5 会话选择器

```typescript
// components/SessionSelector.tsx

interface SessionSelectorProps {
  availableSessions: Array<{
    id: string;
    name: string;
    timestamp: number;
    summary: string;
  }>;
  selectedSessions: string[];
  onSelectionChange: (sessionIds: string[]) => void;
  maxSelections?: number;
}

const SessionSelector: React.FC<SessionSelectorProps> = ({
  availableSessions,
  selectedSessions,
  onSelectionChange,
  maxSelections = 4,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  
  const filteredSessions = availableSessions.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const handleToggle = (sessionId: string) => {
    if (selectedSessions.includes(sessionId)) {
      onSelectionChange(selectedSessions.filter(id => id !== sessionId));
    } else if (selectedSessions.length < maxSelections) {
      onSelectionChange([...selectedSessions, sessionId]);
    }
  };
  
  return (
    <div className="session-selector">
      <input
        type="text"
        className="search-input"
        placeholder="搜索会话..."
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
      />
      
      <div className="session-list">
        {filteredSessions.map(session => (
          <div
            key={session.id}
            className={`session-item ${selectedSessions.includes(session.id) ? 'selected' : ''}`}
            onClick={() => handleToggle(session.id)}
          >
            <input
              type="checkbox"
              checked={selectedSessions.includes(session.id)}
              onChange={() => {}}
              disabled={!selectedSessions.includes(session.id) && selectedSessions.length >= maxSelections}
            />
            <div className="session-info">
              <div className="session-name">{session.name}</div>
              <div className="session-timestamp">
                {new Date(session.timestamp).toLocaleString()}
              </div>
              <div className="session-summary">{session.summary}</div>
            </div>
          </div>
        ))}
      </div>
      
      <div className="selection-summary">
        已选择 {selectedSessions.length} / {maxSelections} 个会话
      </div>
    </div>
  );
};
```

---

## 4. 导出与分享 (§3.9)

### 4.1 功能描述

支持导出分析报告和分享可视化结果，便于团队协作和复盘。

### 4.2 导出服务

```typescript
// services/exportService.ts

interface ExportOptions {
  format: 'pdf' | 'markdown' | 'json' | 'png';
  template: 'compact' | 'detailed' | 'team';
  includeCharts: boolean;
  includeRawData: boolean;
  dateRange?: { start: number; end: number };
}

class ExportService {
  /** 导出报告 */
  async export(
    sessionId: string,
    options: ExportOptions
  ): Promise<Blob> {
    switch (options.format) {
      case 'pdf':
        return this.exportPDF(sessionId, options);
      case 'markdown':
        return this.exportMarkdown(sessionId, options);
      case 'json':
        return this.exportJSON(sessionId, options);
      case 'png':
        return this.exportPNG(sessionId, options);
      default:
        throw new Error(`Unsupported format: ${options.format}`);
    }
  }
  
  /** 导出 PDF */
  private async exportPDF(
    sessionId: string,
    options: ExportOptions
  ): Promise<Blob> {
    const data = await this.loadSessionData(sessionId, options);
    
    // 使用 jsPDF 生成 PDF
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    
    // 标题
    doc.setFontSize(20);
    doc.text('DSH 轨迹分析报告', 20, 20);
    
    // 基本信息
    doc.setFontSize(12);
    doc.text(`会话 ID: ${data.sessionId}`, 20, 40);
    doc.text(`生成时间: ${new Date().toLocaleString()}`, 20, 50);
    doc.text(`模板: ${options.template}`, 20, 60);
    
    // 关键指标
    doc.setFontSize(14);
    doc.text('关键指标', 20, 80);
    doc.setFontSize(10);
    doc.text(`总 Token: ${data.metrics.totalTokens.toLocaleString()}`, 20, 95);
    doc.text(`总耗时: ${data.metrics.duration} ms`, 20, 105);
    doc.text(`轮次数: ${data.metrics.turns}`, 20, 115);
    doc.text(`工具调用: ${data.metrics.toolCalls}`, 20, 125);
    doc.text(`错误率: ${(data.metrics.errorRate * 100).toFixed(1)}%`, 20, 135);
    
    // 图表（如包含）
    if (options.includeCharts) {
      // 添加图表图片
      // ...
    }
    
    // 详细数据（如包含）
    if (options.includeRawData) {
      doc.addPage();
      doc.setFontSize(14);
      doc.text('详细数据', 20, 20);
      // 添加表格数据
      // ...
    }
    
    return doc.output('blob');
  }
  
  /** 导出 Markdown */
  private async exportMarkdown(
    sessionId: string,
    options: ExportOptions
  ): Promise<Blob> {
    const data = await this.loadSessionData(sessionId, options);
    
    let md = `# DSH 轨迹分析报告\n\n`;
    md += `**会话 ID**: ${data.sessionId}\n\n`;
    md += `**生成时间**: ${new Date().toLocaleString()}\n\n`;
    md += `**模板**: ${options.template}\n\n`;
    
    md += `## 关键指标\n\n`;
    md += `- 总 Token: ${data.metrics.totalTokens.toLocaleString()}\n`;
    md += `- 总耗时: ${data.metrics.duration} ms\n`;
    md += `- 轮次数: ${data.metrics.turns}\n`;
    md += `- 工具调用: ${data.metrics.toolCalls}\n`;
    md += `- 错误率: ${(data.metrics.errorRate * 100).toFixed(1)}%\n\n`;
    
    if (options.includeCharts) {
      md += `## 图表\n\n`;
      md += `![上下文演化](chart-context-evolution.png)\n\n`;
      md += `![Token 趋势](chart-token-trend.png)\n\n`;
    }
    
    if (options.includeRawData) {
      md += `## 详细数据\n\n`;
      md += `| 指标 | 值 |\n`;
      md += `|------|-----|\n`;
      for (const [key, value] of Object.entries(data.metrics)) {
        md += `| ${key} | ${value} |\n`;
      }
    }
    
    return new Blob([md], { type: 'text/markdown' });
  }
  
  /** 导出 JSON */
  private async exportJSON(
    sessionId: string,
    options: ExportOptions
  ): Promise<Blob> {
    const data = await this.loadSessionData(sessionId, options);
    const json = JSON.stringify(data, null, 2);
    return new Blob([json], { type: 'application/json' });
  }
  
  /** 导出 PNG */
  private async exportPNG(
    sessionId: string,
    options: ExportOptions
  ): Promise<Blob> {
    // 使用 html2canvas 截图
    const { default: html2canvas } = await import('html2canvas');
    const element = document.getElementById(`dashboard-${sessionId}`);
    if (!element) throw new Error('Dashboard element not found');
    
    const canvas = await html2canvas(element);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob!);
      }, 'image/png');
    });
  }
  
  /** 加载会话数据 */
  private async loadSessionData(
    sessionId: string,
    options: ExportOptions
  ): Promise<any> {
    // 从本地存储或 DSH API 加载
    // ...
  }
}
```

### 4.3 分享服务

```typescript
// services/shareService.ts

interface ShareLink {
  id: string;
  sessionId: string;
  url: string;
  expiresAt: number;
  accessControl: 'public' | 'password';
  password?: string;
  createdAt: number;
  viewCount: number;
}

class ShareService {
  private links: ShareLink[] = [];
  
  /** 生成分享链接 */
  async createShareLink(
    sessionId: string,
    options: {
      expiresIn: '7d' | '30d' | 'permanent';
      accessControl: 'public' | 'password';
      password?: string;
    }
  ): Promise<ShareLink> {
    const id = `share-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const url = `${window.location.origin}/shared/${id}`;
    
    const expiresAt = options.expiresIn === 'permanent'
      ? Number.MAX_SAFE_INTEGER
      : Date.now() + (options.expiresIn === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000;
    
    const link: ShareLink = {
      id,
      sessionId,
      url,
      expiresAt,
      accessControl: options.accessControl,
      password: options.password,
      createdAt: Date.now(),
      viewCount: 0,
    };
    
    this.links.push(link);
    await this.saveLinks();
    
    return link;
  }
  
  /** 获取分享链接 */
  async getShareLink(linkId: string): Promise<ShareLink | null> {
    const link = this.links.find(l => l.id === linkId);
    if (!link || link.expiresAt < Date.now()) return null;
    
    link.viewCount++;
    await this.saveLinks();
    
    return link;
  }
  
  /** 列出所有分享链接 */
  listShareLinks(): ShareLink[] {
    return this.links.filter(l => l.expiresAt >= Date.now());
  }
  
  /** 删除分享链接 */
  async deleteShareLink(linkId: string): Promise<void> {
    this.links = this.links.filter(l => l.id !== linkId);
    await this.saveLinks();
  }
  
  /** 保存链接到本地存储 */
  private async saveLinks(): Promise<void> {
    localStorage.setItem('dsh-share-links', JSON.stringify(this.links));
  }
}
```

### 4.4 导出菜单组件

```typescript
// components/ExportMenu.tsx

interface ExportMenuProps {
  sessionId: string;
  onExport: (options: ExportOptions) => void;
  onShare: (options: ShareOptions) => void;
}

const ExportMenu: React.FC<ExportMenuProps> = ({
  sessionId,
  onExport,
  onShare,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  
  const exportFormats = [
    { id: 'pdf', label: 'PDF 报告', icon: '📄' },
    { id: 'markdown', label: 'Markdown', icon: '📝' },
    { id: 'json', label: 'JSON 数据', icon: '📊' },
    { id: 'png', label: 'PNG 截图', icon: '🖼️' },
  ];
  
  const templates = [
    { id: 'compact', label: '简洁版' },
    { id: 'detailed', label: '详细版' },
    { id: 'team', label: '团队版' },
  ];
  
  const [selectedFormat, setSelectedFormat] = useState('pdf');
  const [selectedTemplate, setSelectedTemplate] = useState('detailed');
  const [includeCharts, setIncludeCharts] = useState(true);
  const [includeRawData, setIncludeRawData] = useState(false);
  
  return (
    <div className="export-menu">
      <button
        className="export-button"
        onClick={() => setIsOpen(!isOpen)}
      >
        📤 导出/分享
      </button>
      
      {isOpen && (
        <div className="export-dropdown">
          <div className="export-section">
            <h4>导出格式</h4>
            {exportFormats.map(format => (
              <button
                key={format.id}
                className={`format-btn ${selectedFormat === format.id ? 'active' : ''}`}
                onClick={() => setSelectedFormat(format.id)}
              >
                <span className="format-icon">{format.icon}</span>
                <span className="format-label">{format.label}</span>
              </button>
            ))}
          </div>
          
          <div className="export-section">
            <h4>报告模板</h4>
            {templates.map(template => (
              <button
                key={template.id}
                className={`template-btn ${selectedTemplate === template.id ? 'active' : ''}`}
                onClick={() => setSelectedTemplate(template.id)}
              >
                {template.label}
              </button>
            ))}
          </div>
          
          <div className="export-section">
            <label>
              <input
                type="checkbox"
                checked={includeCharts}
                onChange={e => setIncludeCharts(e.target.checked)}
              />
              包含图表
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeRawData}
                onChange={e => setIncludeRawData(e.target.checked)}
              />
              包含原始数据
            </label>
          </div>
          
          <div className="export-actions">
            <button
              className="export-btn"
              onClick={() => {
                onExport({
                  format: selectedFormat as any,
                  template: selectedTemplate as any,
                  includeCharts,
                  includeRawData,
                });
                setIsOpen(false);
              }}
            >
              导出
            </button>
            <button
              className="share-btn"
              onClick={() => {
                setShowShareDialog(true);
                setIsOpen(false);
              }}
            >
              分享
            </button>
          </div>
        </div>
      )}
      
      {showShareDialog && (
        <ShareDialog
          sessionId={sessionId}
          onClose={() => setShowShareDialog(false)}
          onShare={onShare}
        />
      )}
    </div>
  );
};
```

### 4.5 分享对话框

```typescript
// components/ShareDialog.tsx

interface ShareDialogProps {
  sessionId: string;
  onClose: () => void;
  onShare: (options: ShareOptions) => void;
}

const ShareDialog: React.FC<ShareDialogProps> = ({
  sessionId,
  onClose,
  onShare,
}) => {
  const [expiresIn, setExpiresIn] = useState<'7d' | '30d' | 'permanent'>('7d');
  const [accessControl, setAccessControl] = useState<'public' | 'password'>('public');
  const [password, setPassword] = useState('');
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  const handleGenerate = async () => {
    const link = await onShare({
      sessionId,
      expiresIn,
      accessControl,
      password: accessControl === 'password' ? password : undefined,
    });
    setGeneratedLink(link.url);
  };
  
  const handleCopy = () => {
    if (generatedLink) {
      navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  return (
    <div className="share-dialog-overlay" onClick={onClose}>
      <div className="share-dialog" onClick={e => e.stopPropagation()}>
        <h3>分享报告</h3>
        
        {!generatedLink ? (
          <>
            <div className="share-option">
              <label>有效期:</label>
              <select
                value={expiresIn}
                onChange={e => setExpiresIn(e.target.value as any)}
              >
                <option value="7d">7 天</option>
                <option value="30d">30 天</option>
                <option value="permanent">永久</option>
              </select>
            </div>
            
            <div className="share-option">
              <label>访问控制:</label>
              <select
                value={accessControl}
                onChange={e => setAccessControl(e.target.value as any)}
              >
                <option value="public">公开</option>
                <option value="password">密码保护</option>
              </select>
            </div>
            
            {accessControl === 'password' && (
              <div className="share-option">
                <label>密码:</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="设置访问密码"
                />
              </div>
            )}
            
            <div className="share-actions">
              <button onClick={onClose}>取消</button>
              <button onClick={handleGenerate}>生成链接</button>
            </div>
          </>
        ) : (
          <>
            <div className="share-result">
              <label>分享链接:</label>
              <div className="link-container">
                <input
                  type="text"
                  value={generatedLink}
                  readOnly
                  className="link-input"
                />
                <button onClick={handleCopy}>
                  {copied ? '✅ 已复制' : '📋 复制'}
                </button>
              </div>
            </div>
            
            <div className="share-actions">
              <button onClick={onClose}>关闭</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
```

---

## 5. 总结

### 5.1 技术栈

- **UI 框架**: React 18+ with TypeScript
- **状态管理**: Redux Toolkit
- **图表库**: Recharts / D3.js
- **虚拟化**: react-window
- **PDF 生成**: jsPDF
- **截图**: html2canvas
- **样式**: CSS Modules / Tailwind CSS

### 5.2 实现顺序

1. **Dashboard 重构** - 基础框架，其他功能依赖此
2. **智能告警** - 基于现有指标数据
3. **对比分析** - 需要多次运行数据
4. **导出分享** - 最后实现，依赖所有数据

### 5.3 关键依赖

- DSH 宿主 API（sessionStats、trajectoryAnalytics）
- 本地存储（localStorage）
- 第三方库（jsPDF、html2canvas、recharts）

---

**文档结束**
