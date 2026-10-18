/** Smart alert rules; thresholds persist in the browser. Host policy edits
 * are owned by the separate verified configuration Remote. */

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface AlertThresholds {
  disabledRules?: string[];
  contextOverloadRatio: number;
  compactionFrequencyPer1k: number;
  toolErrorRate: number;
  repeatCallGroups: number;
  longGapSegments: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  contextOverloadRatio: 0.8,
  compactionFrequencyPer1k: 5,
  toolErrorRate: 0.1,
  repeatCallGroups: 3,
  longGapSegments: 0,
};

export interface AlertInput {
  /** 0–1 context occupancy, or null when unknown. */
  utilization: number | null;
  /** Compactions per 1k input tokens, or null when no sample. */
  compactionFrequency: number | null;
  /** 0–1 explicit tool failure rate, or null when no denominator. */
  toolErrorRate: number | null;
  /** Repeat-call loop groups (max run length ≥ threshold), or null. */
  repeatGroups: number | null;
  /** Count of ≥30 s long-gap segments, or null. */
  longGapCount: number | null;
}

export interface Alert {
  id: string;
  rule: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  suggestion: string;
  /** Copyable configuration text for "apply suggestion" (read-only surface). */
  configHint: string | null;
  timeMs?: number | undefined;
}

interface Rule {
  id: string;
  name: string;
  severity: AlertSeverity;
  evaluate: (input: AlertInput, thresholds: AlertThresholds) => { detail: string; suggestion: string; configHint: string | null } | null;
}

const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

const RULES: Rule[] = [
  {
    id: 'context-overload',
    name: '上下文满载',
    severity: 'critical',
    evaluate: (input, thresholds) => {
      if (input.utilization === null || input.utilization <= thresholds.contextOverloadRatio) return null;
      return {
        detail: `当前上下文占用 ${percent(input.utilization)}，超过阈值 ${percent(thresholds.contextOverloadRatio)}。`,
        suggestion: '考虑执行 /compact 压缩会话，或开启更激进的自动压缩策略；长会话可拆分为多个子任务。',
        configHint: null,
      };
    },
  },
  {
    id: 'frequent-compaction',
    name: '频繁压缩',
    severity: 'warning',
    evaluate: (input, thresholds) => {
      if (input.compactionFrequency === null || input.compactionFrequency <= thresholds.compactionFrequencyPer1k) return null;
      return {
        detail: `压缩频率 ${input.compactionFrequency.toFixed(2)} 次/千输入 Token，超过阈值 ${thresholds.compactionFrequencyPer1k}。`,
        suggestion: '减少同时启用的工具定义数量；精简系统提示；或切换到更大上下文窗口的模型。',
        configHint: null,
      };
    },
  },
  {
    id: 'high-error-rate',
    name: '高错误率',
    severity: 'critical',
    evaluate: (input, thresholds) => {
      if (input.toolErrorRate === null || input.toolErrorRate <= thresholds.toolErrorRate) return null;
      return {
        detail: `工具显式错误率 ${percent(input.toolErrorRate)}，超过阈值 ${percent(thresholds.toolErrorRate)}。`,
        suggestion: '检查高频报错工具的参数格式与路径权限；查看「工具分布」Tab 找到错误集中的工具。',
        configHint: null,
      };
    },
  },
  {
    id: 'token-waste',
    name: 'Token 浪费',
    severity: 'info',
    evaluate: (input, thresholds) => {
      if (input.repeatGroups === null || input.repeatGroups <= thresholds.repeatCallGroups) return null;
      return {
        detail: `检测到同一调用参数最长连续重复 ${input.repeatGroups} 次。`,
        suggestion: '为重复调用的工具启用结果缓存；调整提示词减少重复尝试。',
        configHint: null,
      };
    },
  },
  {
    id: 'long-gaps',
    name: '长间隔',
    severity: 'info',
    evaluate: (input, thresholds) => {
      if (input.longGapCount === null || input.longGapCount <= thresholds.longGapSegments) return null;
      return {
        detail: `${input.longGapCount} 个 ≥30s 的长间隔段，模型/工具响应可能偏慢。`,
        suggestion: '查看「指标明细」中的步骤首块延迟；为慢工具设置更合理的超时或改用异步任务。',
        configHint: null,
      };
    },
  },
];

export function evaluateAlerts(input: AlertInput, thresholds: AlertThresholds): Alert[] {
  const alerts: Alert[] = [];
  for (const rule of RULES) {
    if (thresholds.disabledRules?.includes(rule.id)) continue;
    const result = rule.evaluate(input, thresholds);
    if (result === null) continue;
    alerts.push({
      id: rule.id,
      rule: rule.name,
      severity: rule.severity,
      title: rule.name,
      detail: result.detail,
      suggestion: result.suggestion,
      configHint: result.configHint,
    });
  }
  const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity]! - order[b.severity]!);
}

/* ---- localStorage persistence ---------------------------------------- */

const THRESHOLDS_KEY = 'dsh-eval-control.alerts.thresholds.v1';
const STATE_KEY = 'dsh-eval-control.alerts.state.v2';

export function loadThresholds(): AlertThresholds {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(THRESHOLDS_KEY);
    if (!raw) return { ...DEFAULT_THRESHOLDS };
    const parsed = JSON.parse(raw) as Partial<AlertThresholds>;
    const next = { ...DEFAULT_THRESHOLDS };
    for (const key of ['contextOverloadRatio','compactionFrequencyPer1k','toolErrorRate','repeatCallGroups','longGapSegments'] as const) {
      const value = parsed[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && (!['contextOverloadRatio','toolErrorRate'].includes(key) || value <= 1)) next[key] = value;
    }
    next.disabledRules = Array.isArray(parsed.disabledRules) ? parsed.disabledRules.filter((value) => typeof value === 'string') : [];
    return next;
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

export function saveThresholds(thresholds: AlertThresholds): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(thresholds));
  } catch { /* private mode etc. — thresholds stay in-memory */ }
}

export interface AlertState {
  /** Alert ids the user dismissed this session. */
  firstSeen?: Record<string, number>;
  dismissed: string[];
  /** Alert ids the user marked resolved. */
  resolved: string[];
}

export function loadAlertState(sessionId = 'current'): AlertState {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(`${STATE_KEY}:${sessionId}`);
    if (!raw) return { dismissed: [], resolved: [] };
    const parsed = JSON.parse(raw) as Partial<AlertState>;
    return {
      firstSeen: parsed.firstSeen && typeof parsed.firstSeen === 'object' ? parsed.firstSeen : {},
      dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed : [],
      resolved: Array.isArray(parsed.resolved) ? parsed.resolved : [],
    };
  } catch {
    return { dismissed: [], resolved: [] };
  }
}

export function saveAlertState(state: AlertState, sessionId = 'current'): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(`${STATE_KEY}:${sessionId}`, JSON.stringify(state));
  } catch { /* storage unavailable — state stays in-memory */ }
}

/**
 * Derive the rule-engine inputs from the dashboard's data sources.
 */
export function alertInputOf(data: {
  utilization: number | null;
  analytics?: {
    metricResults?: Array<{ metricId: string; status: string; value?: number | Record<string, unknown>; denominator?: number }>;
  } | undefined;
}): AlertInput {
  const metric = (id: string) => data.analytics?.metricResults?.find((item) => item.metricId === id);
  const frequency = metric('context.compaction_frequency_per_1k_input_tokens');
  const failure = metric('tool.failure_rate');
  const repeat = metric('tool.repeat_loop');
  const longGap = metric('model.long_gap_segments');
  const numberOr = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const repeatValue = repeat && typeof repeat.value === 'object' ? repeat.value : undefined;
  const longGapValue = longGap && typeof longGap.value === 'object' ? longGap.value : undefined;
  return {
    utilization: data.utilization,
    compactionFrequency: frequency && frequency.status === 'available' ? numberOr(frequency.value) : null,
    toolErrorRate: failure && failure.status === 'available' && typeof failure.value === 'number'
      ? failure.value
      : (failure?.denominator && failure.denominator > 0 && typeof failure.value === 'number' ? failure.value : null),
    repeatGroups: repeatValue && typeof repeatValue['maxRunLength'] === 'number' ? repeatValue['maxRunLength'] : null,
    longGapCount: longGapValue && typeof longGapValue['gapCount'] === 'number' ? longGapValue['gapCount'] : null,
  };
}
