import { overviewDiagnosticChain } from './overviewDiagnosis.js';
import { AiDiagnosis } from './aiDiagnostic.js';
import { useInjectionHistory } from './injectionHistory.js';
import { EvidencePanel } from './evidencePanel.js';
import { aggregateEvidence, alertEvidence, type EvidenceChain } from './evidence.js';
import { ReportActions } from './reportActions.js';
import type { LoadedSession } from './tab-compare.js';
import { configurationRemote, type ConfigurationConnection } from './configuration.js';
/**
 * The conversation.view dashboard (PRD §3.6): status bar with occupancy badge
 * and export/share/alert controls, the metric card row, the tab bar, the tab
 * content, and the collapsible detail area. All data is read through
 * `useProjection` — the dashboard holds no session state of its own beyond
 * UI state (active tab, thresholds, alert dismissal).
 */
import { useEffect, useRef, useState } from './react-binding.js';
import { h } from './react-binding.js';
import { formatFull, formatMs, formatTokens, trendOf, utilizationColor } from './format.js';
import { alertInputOf, evaluateAlerts, loadAlertState, loadThresholds, saveAlertState, saveThresholds } from './alerts.js';
import { ThresholdSettings, AlertsDrawer } from './alertsPanel.js';
import { exportPng } from './exporters.js';
import { teamAggregate, readMemberSummary, type MemberEntry } from './team.js';
import { deriveDashboardData, stepContextOf, type DashboardData } from './derive.js';
import { DetailPanel } from './detailPanel.js';
import { OverviewTab } from './tab-overview.js';
import { EvolutionTab } from './tab-evolution.js';
import { TokensTab } from './tab-tokens.js';
import { CompactionTab } from './tab-compaction.js';
import { ToolsTab } from './tab-tools.js';
import { TeamTab } from './tab-team.js';
import { CompareTab } from './tab-compare.js';
import type {
  ContextPressure, ContextTimeline, SessionStats, TrajectoryAnalytics, ViewProps,
} from './types.js';

const TABS = [
  { id: 'overview', label: '总览', icon: '📊' },
  { id: 'evolution', label: '上下文演化', icon: '📈' },
  { id: 'tokens', label: '消息 Token', icon: '💧' },
  { id: 'compaction', label: '压缩与注入', icon: '📦' },
  { id: 'tools', label: '工具分布', icon: '🔧' },
  { id: 'team', label: 'Team 活动', icon: '👥' },
  { id: 'compare', label: '对比分析', icon: '⚖️' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function createDashboardView(ctx: {
  connection?: ConfigurationConnection;
  sessions?: { using?: unknown; refreshProjections?: unknown };
}) {
  return function TrajectoryAnalyticsView(props: ViewProps): unknown {
    const useProjection = typeof props.useProjection === 'function' ? props.useProjection : undefined;
    const analytics = useProjection !== undefined ? useProjection('trajectoryAnalytics') as TrajectoryAnalytics | undefined : undefined;
    const timeline = useProjection !== undefined ? useProjection('contextTimeline') as ContextTimeline | undefined : undefined;
    const stats = useProjection !== undefined ? useProjection('sessionStats') as SessionStats | undefined : undefined;
    const pressure = useProjection !== undefined ? useProjection('contextPressure') as ContextPressure | undefined : undefined;

    const sessionKey = props.sessionId ?? analytics?.teamInput?.sessionId ?? 'current';
    const contentRef = useRef<HTMLElement | null>(null);
    const [tab, setTab] = useState<TabId>('overview');
    const [detailOpen, setDetailOpen] = useState(false);
    const [thresholds, setThresholds] = useState(loadThresholds);
    const [showThresholds, setShowThresholds] = useState(false);
    const [alertState, setAlertState] = useState(() => loadAlertState(sessionKey));
    const [imageError, setImageError] = useState<string | null>(null);
    const [evidence, setEvidence] = useState<EvidenceChain | null>(null);
    useEffect(() => setEvidence(null), [sessionKey]);
    const evidenceProps = { onEvidence: setEvidence, evidenceSessionId: sessionKey };
    const [comparison, setComparison] = useState<LoadedSession[]>([]);
    useEffect(() => setComparison([]), [sessionKey]);
    const containerRef = useRef<HTMLElement | null>(null);

    const data = deriveDashboardData(analytics ?? null, timeline ?? null, stats ?? null, pressure ?? null);

    const injectionHistory = useInjectionHistory(ctx.sessions as import('./types.js').SessionsService | undefined, sessionKey, tab === 'evolution' || tab === 'tools' || tab === 'tokens');

    /* Team member summaries: loaded once per member set. */
    const [teamState, setTeamState] = useState<{ phase: string; members: MemberEntry[] }>({ phase: 'idle', members: [] });
    const memberKey = analytics?.teamInput && Array.isArray(analytics.teamInput.memberIds)
      ? analytics.teamInput.memberIds.join(',')
      : '';
    useEffect(() => {
      const memberIds = memberKey ? memberKey.split(',') : [];
      if (memberIds.length === 0) {
        setTeamState({ phase: 'none', members: [] });
        return undefined;
      }
      const sessions = ctx && ctx.sessions;
      if (!sessions || typeof sessions.using !== 'function') {
        setTeamState({ phase: 'unavailable', members: [] });
        return undefined;
      }
      let cancelled = false;
      setTeamState({ phase: 'loading', members: [] });
      void Promise.all(memberIds.map((memberId: string) => readMemberSummary(sessions as never, memberId)
        .then((summary) => ({ memberId, summary: summary && typeof summary === 'object' ? summary : null }),
          (error: unknown) => ({ memberId, summary: null, error: String((error && (error as Error).message) || error) }))))
        .then((members) => { if (!cancelled) setTeamState({ phase: 'ready', members }); });
      return () => { cancelled = true; };
    }, [memberKey]);

    const team = analytics?.teamInput && teamState.phase === 'ready'
      ? teamAggregate(analytics.teamInput, teamState.members)
      : null;

    /* Alerts */
    const alertInput = alertInputOf({ utilization: data.utilization, analytics: analytics ?? undefined });
    const rawAlerts = evaluateAlerts(alertInput, thresholds);
    useEffect(() => { setAlertState(loadAlertState(sessionKey)); }, [sessionKey]);
    const alertKey = rawAlerts.map((alert) => alert.id).join(',');
    useEffect(() => {
      setAlertState((previous) => {
        const firstSeen = { ...previous.firstSeen };
        let changed = false;
        for (const alert of rawAlerts) if (firstSeen[alert.id] === undefined) { firstSeen[alert.id] = Date.now(); changed = true; }
        if (!changed) return previous;
        const next = { ...previous, firstSeen }; saveAlertState(next, sessionKey); return next;
      });
    }, [alertKey, sessionKey]);
    const allAlerts = rawAlerts.map((alert) => ({ ...alert, timeMs: alertState.firstSeen?.[alert.id] }));
    const navigate = (next: TabId) => { setTab(next); setTimeout(() => { contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); contentRef.current?.animate?.([{ background: '#4285f426' }, { background: 'transparent' }], { duration: 650 }); }, 0); };
    const activeAlerts = allAlerts.filter((alert) => !alertState.dismissed.includes(alert.id) && !alertState.resolved.includes(alert.id));

    const updateThresholds = (next: typeof thresholds) => {
      setThresholds(next);
      saveThresholds(next);
    };
    const dismissAlert = (id: string) => {
      const next = { ...alertState, dismissed: [...alertState.dismissed, id] };
      setAlertState(next);
      saveAlertState(next, sessionKey);
    };
    const resolveAlert = (id: string) => {
      const next = { ...alertState, resolved: [...alertState.resolved, id] };
      setAlertState(next);
      saveAlertState(next, sessionKey);
    };

    return h('div', {
      ref: containerRef as unknown as string,
      style: {
        display: 'flex', flexDirection: 'column', gap: '12px',
        fontSize: '13px', lineHeight: 1.5, color: 'inherit',
        '--dsh-eval-red': '#e5484d', '--dsh-eval-yellow': '#e6a700', '--dsh-eval-green': '#30a46c',
        '--dsh-eval-blue': '#4285f4', '--dsh-eval-purple': '#9b59b6',
      } as Record<string, unknown>,
    }, [
      /* ---------- Status bar ---------- */
      h('div', {
        key: 'status',
        style: {
          display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
          position: 'sticky', top: 0, zIndex: 20, background: 'var(--dsh-eval-surface, Canvas)', paddingTop: 8,
          paddingBottom: '10px', borderBottom: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
        },
      }, [
        h('h2', {
          key: 'title',
          style: { margin: 0, fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' },
        }, [
          '轨迹分析',
          data.utilization !== null ? h('span', {
            key: 'badge',
            className: data.utilization > 0.8 ? 'dsh-eval-pulse' : undefined,
            style: {
              fontSize: '11px', fontWeight: 600, padding: '1px 8px', borderRadius: '999px',
              color: '#fff', background: utilizationColor(data.utilization),
            },
          }, `占用 ${(data.utilization * 100).toFixed(0)}%`) : null,
        ]),
        h('span', {
          key: 'mode',
          style: { fontSize: '11.5px', opacity: 0.65, display: 'inline-flex', gap: '6px', alignItems: 'center' },
        }, [
          h('span', {
            key: 'dot',
            style: {
              width: '7px', height: '7px', borderRadius: '50%', display: 'inline-block',
              background: data.running ? 'var(--dsh-eval-green, #30a46c)' : 'color-mix(in srgb, currentColor 40%, transparent)',
            },
          }),
          data.running ? '进行中' : '空闲',
          data.wallMs !== null ? ` · 会话跨度 ${formatMs(data.wallMs)}` : '',
        ]),
        h('button', { key: 'diagnostics-link', type: 'button', onClick: () => navigate('overview') }, '总览诊断'),
        h('span', { key: 'spacer', style: { marginLeft: 'auto' } }),
        h(ReportActions, {key: `exports-${sessionKey}`, connection: ctx.connection, disabled: analytics === undefined, chartElement: () => contentRef.current, input: {sessionId:props.sessionId??null,analytics:analytics??null,timeline:timeline??null,stats:stats??null,alerts:activeAlerts,element:containerRef.current,comparison}}),
      ]),

      /* ---------- Metric cards ---------- */
      h('div', {
        key: 'cards',
        className: 'dsh-eval-metric-grid',
        style: { display: 'grid', gap: '8px' },
      }, [
        metricCard('input', 'Token 消耗', formatTokens((analytics?.inputTokens ?? 0) + (stats?.decodeTokens ?? 0)), `输入 ${formatTokens(analytics?.inputTokens ?? 0)} · 输出 ${formatTokens(stats?.decodeTokens ?? 0)}`, trendOf(data.steps.map((step) => stepContextOf(step)))),
        metricCard('tools', '工具调用', String(analytics?.toolCalls ?? 0), `显式错误 ${analytics?.toolErrors ?? 0}`, trendOf((analytics?.turnTrend ?? []).map((turn) => turn.toolCalls))),
        metricCard('compactions', '压缩频率', alertInput.compactionFrequency === null ? '—' : `${alertInput.compactionFrequency.toFixed(3)} 次/千 Token`, '摘要压缩口径 · 修剪另行统计', trendOf((analytics?.turnTrend ?? []).map((turn) => turn.compactionStarts))),
        metricCard('errors', '工具错误率', alertInput.toolErrorRate === null ? '—' : `${(alertInput.toolErrorRate * 100).toFixed(1)}%`, `分母：${analytics?.metricResults.find(item => item.metricId === 'tool.failure_rate')?.denominator ?? '—'} 个已知结果`, trendOf((analytics?.turnTrend ?? []).map((turn) => turn.toolCalls > 0 ? turn.toolErrors / turn.toolCalls : 0))),
      ]),

      /* ---------- Tab bar ---------- */
      h('div', {
        key: 'tabs',
        role: 'tablist',
        style: {
          display: 'flex', gap: '2px', flexWrap: 'wrap',
          borderBottom: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
        },
      }, TABS.map((entry) => h('button', {
        key: entry.id,
        type: 'button',
        role: 'tab',
        'aria-selected': tab === entry.id,
        onClick: () => setTab(entry.id),
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === entry.id ? 'var(--dsh-eval-blue, #4285f4)' : 'transparent'}`,
          padding: '6px 12px', font: 'inherit', fontSize: '12.5px', cursor: 'pointer', color: 'inherit',
          fontWeight: tab === entry.id ? 600 : 400, opacity: tab === entry.id ? 1 : 0.7,
          marginBottom: '-1px',
        },
      }, [
        h('span', { key: 'icon', 'aria-hidden': true }, entry.icon),
        h('span', { key: 'label' }, entry.label),
        entry.id === 'overview' && activeAlerts.length > 0 ? h('span', {
          key: 'badge',
          style: {
            fontSize: '10px', background: activeAlerts.some((a) => a.severity === 'critical') ? 'var(--dsh-eval-red, #e5484d)' : 'var(--dsh-eval-yellow, #e6a700)',
            color: '#fff', borderRadius: '999px', padding: '0 6px', minWidth: '14px', textAlign: 'center',
          },
        }, String(activeAlerts.length)) : null,
      ]))),

      h('div', { key: 'chart-export', style: { display: 'flex', gap: 12, justifyContent: 'flex-end', fontSize: 11 } }, [h('button', { key: 'png', onClick: () => { setImageError(null); void exportPng(contentRef.current, `trajectory-${tab}.png`).catch((error: unknown) => setImageError(String((error as Error).message))); } }, '导出当前图表 PNG'), imageError ? h('span', { key: 'error', role: 'status' }, imageError) : null]),
      /* ---------- Tab content ---------- */
      h('div', { key: `content-${tab}`, ref: contentRef as unknown as string, className: 'dsh-eval-tab-content', role: 'tabpanel', style: { minHeight: '120px', scrollMarginTop: 90 } }, renderTab()),
      evidence ? h(EvidencePanel, { key: sessionKey + JSON.stringify(evidence), chain: evidence, connection: ctx.connection, sessions: ctx.sessions, currentSessionId: sessionKey, inspectCall: props.inspectCall, onClose: () => setEvidence(null) }) : null,


    ]);

    function metricCard(key: string, label: string, value: string, sub: string, trend: 'up' | 'down' | 'stable' | null): unknown {
      return h('button', {
        key, type: 'button', onClick: () => { const chain = aggregateEvidence(sessionKey, label + ' · ' + value, analytics ?? null, timeline ?? null, key === 'input' ? 'tokens' : key === 'compactions' ? 'frequency' : key === 'errors' ? 'errors' : 'tools'); setEvidence({...chain, conclusion: `${label} ${value} · ${sub}`, facts: [...chain.facts, ...(key === 'input' ? [{label:'累计输出',value:String(stats?.decodeTokens ?? '未知'),source:'sessionStats.decodeTokens'}] : [])]}); },
        style: {
          border: '1px solid color-mix(in srgb, currentColor 14%, transparent)', borderRadius: '10px',
          background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit',
          padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0,
        },
      }, [
        h('span', { key: 'label', style: { fontSize: '10.5px', opacity: 0.55, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, label),
        h('span', { key: 'value', style: { fontSize: '17px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } }, value),
        h('span', { key: 'sub', style: { fontSize: '10.5px', opacity: 0.55, display: 'flex', gap: '5px', alignItems: 'center' } }, [
          sub,
          trend === 'up' ? h('span', { key: 'up', title: '近期上升', style: { color: 'var(--dsh-eval-yellow, #e6a700)' } }, '↗') : null,
          trend === 'down' ? h('span', { key: 'down', title: '近期下降', style: { color: 'var(--dsh-eval-green, #30a46c)' } }, '↘') : null,
          trend === 'stable' ? h('span', { key: 'stable', title: '平稳', style: { opacity: 0.6 } }, '→') : null,
        ]),
      ]);
    }

    function renderTab(): unknown {
      if (analytics === undefined) {
        return h('div', { role: 'status', 'aria-label': '正在加载分析数据', className: 'dsh-eval-skeleton', style: { height: 180, padding: 20, borderRadius: 10, background: 'color-mix(in srgb, currentColor 6%, transparent)' } }, '正在加载分析数据…');
      }
      switch (tab) {
        case 'overview':
          return h('div', { className: 'dsh-eval-overview-layout' }, [
            h('div', { key: 'analysis', style: { minWidth: 0 } }, h(OverviewTab, {
              ...evidenceProps, data, alerts: activeAlerts, thresholds, dismissed: alertState.dismissed,
              onDismiss: dismissAlert, onResolve: resolveAlert, teamState, team,
              onOpenEvolution: () => navigate('evolution'), inspectCall: props.inspectCall,
            })),
            h('aside', { key: 'diagnostics', className: 'dsh-eval-overview-diagnostics', 'aria-label': '总览诊断' }, [
              h('strong', { key: 'heading', style: { fontSize: 14 } }, '诊断中心'),
              h(AiDiagnosis,{key:`ai-${sessionKey}`,label:'AI 全链路诊断',currentSessionId:sessionKey,inspectCall:props.inspectCall,onSelectRef:(ref:import('./evidence.js').EvidenceRef)=>setEvidence({title:'轨迹证据',conclusion:ref.role,rule:'原始事件定位',level:'observed',facts:[],notes:[],refs:[ref]}),connection:ctx.connection,sessions:ctx.sessions,chain:overviewDiagnosticChain(sessionKey,data,allAlerts)}),
              h(AlertsDrawer, { key: 'alerts', configuration: configurationRemote(ctx.connection), inline: true, open: true, input: alertInput, thresholds,
                alerts: allAlerts, dismissed: alertState.dismissed, resolved: alertState.resolved,
                onClose: () => {}, onDismiss: dismissAlert, onResolve: resolveAlert,
                onEvidence: (id: string) => {
                  const alert = allAlerts.find(item => item.id === id);
                  const measurement = id === 'context-overload' ? [alertInput.utilization, thresholds.contextOverloadRatio] : id === 'frequent-compaction' ? [alertInput.compactionFrequency, thresholds.compactionFrequencyPer1k] : id === 'high-error-rate' ? [alertInput.toolErrorRate, thresholds.toolErrorRate] : id === 'token-waste' ? [alertInput.repeatGroups, thresholds.repeatCallGroups] : [alertInput.longGapCount, thresholds.longGapSegments];
                  setEvidence(alertEvidence(sessionKey, id, alert?.title ?? id, alert?.detail ?? '', analytics ?? null, timeline ?? null, measurement[0] ?? null, measurement[1] ?? 0));
                },
                onView: (id: string) => { if (id === 'long-gaps') { setDetailOpen(true); setTimeout(() => containerRef.current?.querySelector('[aria-label="搜索诊断数据"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); } else navigate(id === 'context-overload' ? 'evolution' : id === 'frequent-compaction' ? 'compaction' : 'tools'); },
                onSettings: () => setShowThresholds((value) => !value),
              }),
              showThresholds ? h(ThresholdSettings, { key: 'settings', thresholds, onChange: updateThresholds, onClose: () => setShowThresholds(false) }) : null,
              h(DetailPanel, { key: 'detail', ...evidenceProps, sessionId: sessionKey, data, inspectCall: props.inspectCall, open: detailOpen, onToggle: () => setDetailOpen((value) => !value) }),
            ]),
          ]);
        case 'evolution':
          return h(EvolutionTab, { ...evidenceProps, data, injectionHistory });
        case 'tokens':
          return h(TokensTab, { key: sessionKey, ...evidenceProps, data, history: injectionHistory, inspectCall: props.inspectCall, onOpenCompaction: () => setTab('compaction') });
        case 'compaction':
          return h(CompactionTab, { ...evidenceProps, key: props.sessionId ?? analytics?.teamInput?.sessionId ?? 'current', data, sessionId: props.sessionId ?? analytics?.teamInput?.sessionId ?? null });
        case 'tools':
          return h(ToolsTab, { ...evidenceProps, data, history: injectionHistory });
        case 'team':
          return h(TeamTab, { ...evidenceProps, sessions:ctx.sessions, data, teamState, team });
        case 'compare':
          return h(CompareTab, {
            ...evidenceProps, key: sessionKey, onResult: setComparison,
            useSessions: props.useSessions,
            sessionId: props.sessionId ?? (analytics?.teamInput?.sessionId ?? null),
            sessions: (ctx.sessions ?? null) as never,
            current: {
              id: props.sessionId ?? analytics?.teamInput?.sessionId ?? 'current',
              title: '当前会话',
              analytics: analytics ?? null,
              timeline: timeline ?? null,
              stats: stats ?? null,
            },
          });
        default:
          return null;
      }
    }
  };
}
