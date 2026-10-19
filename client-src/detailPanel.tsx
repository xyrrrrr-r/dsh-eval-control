import { EvidenceButton } from './evidencePanel.js';
import { metricEvidence, eventRef, type EvidenceProps } from './evidence.js';
/**
 * Optional diagnostics: data quality, raw event locators and metric evidence.
 * Message analysis lives in the dedicated tokens tab.
 */
import { useState } from './react-binding.js';
import { h } from './react-binding.js';
import { formatFull, formatTime, formatTokens } from './format.js';
import { copyText, downloadText } from './exporters.js';
import { METRIC_LABELS, formatMetricValue } from './metricLabels.js';
import { type DashboardData } from './derive.js';
import type { MetricResult } from './types.js';

export function DetailPanel(props: EvidenceProps & {
  data: DashboardData;
  sessionId?: string | null;
  inspectCall: ((callId: string) => void) | undefined;
  open: boolean;
  onToggle: () => void;
}): unknown {
  const { data } = props;
  const issues = qualityIssuesOf(data);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('all');
  const [sort, setSort] = useState('desc');
  const [copied, setCopied] = useState(false);
  const matches = (value: unknown) => JSON.stringify(value).toLowerCase().includes(query.toLowerCase());
  const events = (data.analytics?.recentEvents ?? []).filter(matches).slice().sort((a,b) => sort === 'desc' ? b.seq - a.seq : a.seq - b.seq);
  const metrics = (data.analytics?.metricResults ?? []).filter((item) => matches([item, METRIC_LABELS[item.metricId]])).slice().sort((a,b) => sort === 'desc' ? b.metricId.localeCompare(a.metricId) : a.metricId.localeCompare(b.metricId));
  const filteredData = { ...data, analytics: data.analytics ? { ...data.analytics, recentEvents: events.slice().reverse(), metricResults: metrics } : null };
  const exportData = JSON.stringify({ events: section === 'metrics' ? [] : events, metrics: section === 'events' ? [] : metrics }, null, 2);
  return h('div', {
    style: {
      marginTop: '14px', border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
      borderRadius: '10px', background: 'color-mix(in srgb, currentColor 3%, transparent)',
    },
  }, [
    h('button', {
      key: 'header',
      type: 'button',
      onClick: props.onToggle,
      'aria-expanded': props.open,
      style: {
        display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
        background: 'transparent', border: 'none', padding: '10px 14px', cursor: 'pointer',
        font: 'inherit', fontSize: '13px', fontWeight: 600, color: 'inherit', textAlign: 'left',
      },
    }, [
      h('span', { key: 'chev', style: { display: 'inline-block', transform: props.open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' } }, '▸'),
      h('span', { key: 'title' }, '诊断数据'),
      issues.length > 0 ? h('span', { key: 'issues', style: { color: 'var(--dsh-eval-orange, #e8791a)', fontSize: 11, fontWeight: 400 } }, issues.join(' · ')) : null,
      h('span', { key: 'hint', style: { marginLeft: 'auto', fontWeight: 400, fontSize: '11px', opacity: 0.55 } }, props.open ? '点击收起' : '原始事件 · 指标明细 · 数据质量'),
    ]),
    props.open ? h('div', {
      key: 'body',
      style: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 14px 14px' },
    }, [
      h(QualitySection, { key: 'quality', data }),
      h('div', { key: 'filter', style: { display: 'flex', flexWrap: 'wrap', gap: 8 } }, [
        h('input', { key: 'search', type: 'search', placeholder: '搜索事件、工具、指标或状态', 'aria-label': '搜索诊断数据', value: query, onChange: (event: { target: { value: string } }) => setQuery(event.target.value) }),
        h('select', { key: 'section', 'aria-label': '诊断数据类型', value: section, onChange: (event: {target: {value: string}}) => setSection(event.target.value) }, ['all:全部','events:原始事件','metrics:指标明细'].map((entry)=>{const [value,label]=entry.split(':');return h('option',{key:value,value},label);})),
        h('select', { key: 'sort', 'aria-label': '诊断数据排序', value: sort, onChange: (event: {target: {value: string}}) => setSort(event.target.value) }, [h('option',{key:'desc',value:'desc'},'降序（事件序号 / 指标标识）'), h('option',{key:'asc',value:'asc'},'升序（事件序号 / 指标标识）')]),
        h('button', { key: 'copy', onClick: () => { void copyText(exportData).then(() => setCopied(true)); } }, copied ? '已复制筛选结果' : '复制筛选结果'),
        h('button', { key: 'export', onClick: () => downloadText('diagnostics-filtered.json','application/json',exportData) }, '导出筛选结果'),
        h('span', { key: 'count' }, `${events.length} 条事件 · ${metrics.length} 项指标`),
      ]),
      props.sessionId ? h('a', { key: 'download', href: `/api/session.export?sessionId=${encodeURIComponent(props.sessionId)}&includeDescendants=false`, download: true, style: { fontSize: 12 } }, '下载完整日志') : null,
      section !== 'metrics' ? h('div', { key: 'events', style: { maxHeight: 320, overflow: 'auto' } }, h(EventListSection, { ...props, data: filteredData, inspectCall: props.inspectCall })) : null,
      section !== 'events' ? h('div', { key: 'metrics', style: { maxHeight: 400, overflow: 'auto' } }, h(MetricsDetailSection, { ...props, data: filteredData })) : null,
    ]) : null,
  ]);
}

/* ---- 事件列表 --------------------------------------------------------- */

function EventListSection(props: EvidenceProps & {
  data: DashboardData;
  inspectCall: ((callId: string) => void) | undefined;
}): unknown {
  const { data, inspectCall } = props;
  const events = data.analytics?.recentEvents ?? [];
  return h('section', { style: detailSectionStyle }, [
    h('div', { key: 'head', style: detailHeadStyle }, [
      h('span', null, '原始事件'),
      h('span', { key: 'sub', style: detailSubStyle }, `最近 ${events.length} 条已提交事件`),
    ]),
    events.length === 0
      ? h('div', { key: 'empty', style: detailEmptyStyle }, '暂无事件。')
      : h('ul', {
        key: 'list',
        style: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px' },
      }, events.slice().reverse().map((event) => h('li', {
        key: `${event.seq}`,
        style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' },
      }, [
        h('span', { key: 'time', style: { opacity: 0.55, fontVariantNumeric: 'tabular-nums' } }, formatTime(event.time)),
        h('span', { key: 'type', style: { opacity: 0.75 } }, event.type),
        event.label !== undefined ? h('span', { key: 'label', style: { fontWeight: 500 } }, event.label) : null,
        h(EvidenceButton, {...props, chain: () => ({title:`事件 #${event.seq}`,conclusion:event.type,rule:'从宿主持久事件源核对原始记录。',level:'observed',facts:[],notes:['列表标签是投影摘要，原始内容请点击关联事件读取。'],refs:[eventRef(props.evidenceSessionId ?? data.analytics?.teamInput?.sessionId ?? 'current',event.seq,'原始事件')]})}),
        event.callId !== undefined && inspectCall !== undefined
          ? h('button', {
            key: 'locate',
            type: 'button',
            onClick: () => inspectCall(event.callId!),
            style: {
              marginLeft: 'auto', background: 'transparent', border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
              borderRadius: '6px', padding: '0 8px', font: 'inherit', fontSize: '11px', cursor: 'pointer', color: 'inherit',
            },
          }, '在 Trajectory 定位')
          : null,
      ]))),
  ]);
}

/* ---- 指标明细 --------------------------------------------------------- */

function MetricsDetailSection(props: EvidenceProps & { data: DashboardData }): unknown {
  const { data } = props;
  const [showTurnTrend, setShowTurnTrend] = useState(false);
  const results = data.analytics?.metricResults ?? [];
  const turnTrend = data.analytics?.turnTrend ?? [];
  return h('section', { style: detailSectionStyle }, [
    h('div', { key: 'head', style: detailHeadStyle }, [
      h('span', null, '指标明细'),
      h('span', { key: 'sub', style: detailSubStyle }, `${results.length} 项契约指标 · 证据分级：observed / derived / inferred`),
    ]),
    results.length === 0
      ? h('div', { key: 'empty', style: detailEmptyStyle }, '暂无指标。')
      : h('table', {
        key: 'table',
        style: { borderCollapse: 'collapse', width: '100%', fontSize: '12px' },
      }, [
        h('thead', { key: 'head' }, h('tr', null, [
          h('th', { key: 'name', style: thStyle }, '指标'),
          h('th', { key: 'value', style: thStyle }, '值'),
          h('th', { key: 'status', style: thStyle }, '状态'),
          h('th', { key: 'samples', style: thStyle }, '样本'),
          h('th', { key: 'evidence', style: thStyle }, '证据'),
        ])),
        h('tbody', { key: 'body' }, results.map((result: MetricResult) => h('tr', { key: result.metricId }, [
          h('td', { key: 'name', style: tdStyle }, METRIC_LABELS[result.metricId] ?? result.metricId),
          h('td', { key: 'value', style: { ...tdStyle, fontVariantNumeric: 'tabular-nums' } }, formatMetricValue(result.value)),
          h('td', { key: 'status', style: { ...tdStyle, opacity: result.status === 'available' ? 0.9 : 0.55 } }, result.status),
          h('td', { key: 'samples', style: tdStyle }, `${result.sampleCount}${result.denominator !== undefined ? `/${result.denominator}` : ''}`),
          h('td', { key: 'evidence', style: tdStyle }, [result.evidenceLevel, h(EvidenceButton, {...props, chain: () => metricEvidence(result)})]),
        ]))),
      ]),
    /* 轮次趋势 */
    turnTrend.length > 0 ? h('div', { key: 'trend', style: { marginTop: '10px' } }, [
      h('button', {
        key: 'toggle', type: 'button', onClick: () => setShowTurnTrend((value) => !value), style: linkButtonStyle2,
      }, `${showTurnTrend ? '收起' : '展开'}轮次趋势（${turnTrend.length} 轮）`),
      showTurnTrend ? h('div', {
        key: 'grid',
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: '6px', marginTop: '6px' },
      }, turnTrend.map((turn) => h('div', {
        key: turn.turn,
        title: `第 ${turn.turn} 轮：工具 ${turn.toolCalls}（错 ${turn.toolErrors}）· 重试 ${turn.retries} · 压缩 ${turn.compactionStarts} · 输入 ${formatFull(turn.inputTokens)} Token`,
        style: {
          border: '1px solid color-mix(in srgb, currentColor 14%, transparent)', borderRadius: '8px',
          padding: '6px 8px', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '2px',
        },
      }, [
        h('span', { key: 'turn', style: { fontWeight: 600 } }, `轮 ${turn.turn}`),
        h('span', { key: 'tools' }, `工具 ${turn.toolCalls}${turn.toolErrors > 0 ? `（错 ${turn.toolErrors}）` : ''}`),
        h('span', { key: 'in', style: { opacity: 0.65 } }, `输入 ${formatTokens(turn.inputTokens)}`),
        turn.retries > 0 || turn.compactionStarts > 0
          ? h('span', { key: 'flags', style: { color: 'var(--dsh-eval-yellow, #e6a700)' } },
            [turn.retries > 0 ? `重试 ${turn.retries}` : null, turn.compactionStarts > 0 ? `压缩 ${turn.compactionStarts}` : null].filter(Boolean).join(' · '))
          : null,
      ]))) : null,
    ]) : null,

  ]);
}

const detailSectionStyle = {
  display: 'flex', flexDirection: 'column', gap: '6px',
  borderTop: '1px dashed color-mix(in srgb, currentColor 14%, transparent)', paddingTop: '10px',
} as const;

const detailHeadStyle = {
  display: 'flex', alignItems: 'baseline', gap: '10px', fontSize: '13px', fontWeight: 600,
} as const;

const detailSubStyle = { fontWeight: 400, fontSize: '11px', opacity: 0.55 } as const;

const detailEmptyStyle = { fontSize: '12px', opacity: 0.55 } as const;

const thStyle = {
  textAlign: 'left', padding: '4px 8px', opacity: 0.6, fontWeight: 600,
  borderBottom: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
} as const;

const tdStyle = {
  padding: '4px 8px', borderBottom: '1px solid color-mix(in srgb, currentColor 10%, transparent)',
  verticalAlign: 'top',
} as const;

const linkButtonStyle2 = {
  background: 'transparent', border: 'none', padding: 0, font: 'inherit', fontSize: '12px',
  cursor: 'pointer', color: 'inherit', opacity: 0.7, textDecoration: 'underline',
} as const;

function qualityValueOf(data: DashboardData): Record<string, unknown> | null {
  const quality = data.analytics?.metricResults?.find((item) => item.metricId === 'data_quality.trajectory_coverage');
  return quality?.value !== null && typeof quality?.value === 'object' ? quality.value as Record<string, unknown> : null;
}
export function qualityIssuesOf(data: DashboardData): string[] {
  const value = qualityValueOf(data);
  if (!value) return [];
  return [['unknownEventTypes', '未知事件'], ['unpairedToolResults', '未配对结果'], ['qualityIssueCount', '质量问题']].flatMap(([key, label]) => {
    const count = value[key!];
    return typeof count === 'number' && count > 0 ? [`${label} ${count}`] : [];
  });
}
function QualitySection(props: { data: DashboardData }): unknown {
  const qualityValue = qualityValueOf(props.data);
  return h('section', { style: detailSectionStyle }, [
      h('div', { key: 'title', style: { fontSize: '12px', fontWeight: 600, marginBottom: '4px' } }, '数据质量'),
      h('div', {
        key: 'body', style: { display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: '11.5px' },
      }, qualityValue === null
        ? '质量数据不可用。'
        : [
          qualityValue['unknownEventTypes'] !== undefined ? `未知事件类型 ${String(qualityValue['unknownEventTypes'])}` : null,
          qualityValue['unpairedToolResults'] !== undefined ? `未配对工具结果 ${String(qualityValue['unpairedToolResults'])}` : null,
          qualityValue['openSpans'] !== undefined ? `开放区间 ${String(qualityValue['openSpans'])}` : null,
          qualityValue['qualityIssueCount'] !== undefined ? `质量问题 ${String(qualityValue['qualityIssueCount'])} 项` : null,
          Array.isArray(qualityValue['qualityCodes']) && qualityValue['qualityCodes'].length > 0
            ? `代码：${(qualityValue['qualityCodes'] as unknown[]).join('、')}`
            : null,
        ].filter(Boolean).map((line, index) => h('span', { key: index, style: { opacity: 0.8 } }, line as string))),
    ]);
}
