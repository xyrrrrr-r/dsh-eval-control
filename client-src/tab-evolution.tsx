/**
 * Evolution timeline tab (PRD §3.4): the context growth line chart with
 * compaction/injection/retry markers, the window-limit line, hover tooltips,
 * drag-zoom, and legend toggles. Event sequence locates markers between
 * requests, including when timestamps collide.
 */
import { useState } from './react-binding.js';
import { h } from './react-binding.js';
import { formatFull, formatTime, formatTokens } from './format.js';
import { LineChart, type ChartMarker, type LineSeries } from './charts.js';
import { stepContextOf, type DashboardData } from './derive.js';
import { dominantOf, mechanismLabel } from './tab-tokens.js';

export function EvolutionTab(props: { data: DashboardData }): unknown {
  const { data } = props;
  const [hidden, setHidden] = useState<string[]>(['surface', 'output']);
  const [xMode, setXMode] = useState<'step' | 'time' | 'turn'>('step');
  const [markerKinds, setMarkerKinds] = useState<Array<ChartMarker['kind']>>(['compaction', 'prune', 'injection', 'spike']);
  const timeline = data.timeline;
  const steps = data.steps;

  if (steps.length === 0 && (timeline?.injections ?? []).length === 0 && (timeline?.compactions ?? []).length === 0) {
    return h('div', { style: emptyStyle }, '暂无演化数据。开始对话后，这里将展示上下文随时间的增长曲线与压缩事件。');
  }

  const contextWindow = data.contextWindow;
  // Keep every request: the last request alone hides compactions within a turn.
  const sampleSteps = steps;
  const events = [...steps, ...(timeline?.injections ?? []), ...(timeline?.compactions ?? [])]
    .sort((a, b) => a.seq - b.seq);
  const eventSeqs = [...new Set(events.map((event) => event.seq))];
  const xOf = (seq: number, timeMs: number): number => {
    if (xMode === 'time') return timeMs;
    const index = steps.findIndex((step) => step.seq >= seq);
    const nextIndex = index < 0 ? steps.length : index;
    const previous = steps[nextIndex - 1];
    const next = steps[nextIndex];
    if (xMode === 'step') {
      if (next?.seq === seq) return nextIndex + 1;
      const lo = previous?.seq ?? (eventSeqs[0] ?? seq) - 1;
      const hi = next?.seq ?? (eventSeqs[eventSeqs.length - 1] ?? seq) + 1;
      return nextIndex + (seq - lo) / Math.max(1, hi - lo);
    }
    const turn = next?.turn ?? previous?.turn ?? 1;
    const members = eventSeqs.filter((value) => {
      const request = steps.find((step) => step.seq >= value) ?? steps[steps.length - 1];
      return (request?.turn ?? 1) === turn;
    });
    return turn + Math.max(0, members.indexOf(seq)) / Math.max(1, members.length);
  };
  const xs = sampleSteps.map((step) => xOf(step.seq, step.timeMs));
  const series: LineSeries[] = [
    {
      key: 'occupancy',
      label: '上下文窗口占用（含缓存读）',
      color: '#4285f4',
      points: sampleSteps.map((step, index) => ({ x: xs[index]!, y: stepContextOf(step) })),
    },
    {
      key: 'surface',
      label: '表面 Token（估算）',
      color: '#9b59b6',
      points: sampleSteps.map((step, index) => ({ x: xs[index]!, y: step.surfaceTokens })),
    },
    {
      key: 'output',
      label: '输出 Token（服务商）',
      color: '#8a8a8a',
      dashed: true,
      points: sampleSteps.map((step, index) => ({ x: xs[index]!, y: step.outputTokens })),
    },
  ];
  const injections = (timeline?.injections ?? []).filter((message) => message.kind !== 'assistant' && !(message.kind === 'user' && message.sourceKind === 'user'));
  const spikes = tokenSpikes(timeline?.injections ?? []);
  const markers: ChartMarker[] = [];
  {
    for (const compaction of timeline?.compactions ?? []) {
      const markerKind = compaction.kind === 'summary' ? 'compaction' : 'prune';
      if (!markerKinds.includes(markerKind)) continue;
      const x = xOf(compaction.seq, compaction.timeMs);
      if (x === null) continue;
      const kind = compaction.kind === 'summary' ? '摘要压缩' : '历史修剪';
      const turn = compaction.kind === 'summary' && compaction.turn !== null ? `（第 ${compaction.turn} 轮）` : '';
      const before = compaction.beforeTokens === null ? '?' : formatTokens(compaction.beforeTokens);
      const after = compaction.afterTokens === null ? '?' : formatTokens(compaction.afterTokens);
      const reclaimed = compaction.reclaimedTokens === null ? '回收未回填' : `回收 ${formatTokens(compaction.reclaimedTokens)}`;
      const ratio = compaction.reclaimRatio === null ? '' : `，回收比 ${(compaction.reclaimRatio * 100).toFixed(1)}%`;
      markers.push({
        x,
        kind: markerKind,
        title: `${kind}${turn} @ ${formatTime(compaction.timeMs)}：${before} → ${after}，${reclaimed}${ratio}`,
      });
    }
  }
  if (markerKinds.includes('injection')) {
    for (const message of injections) {
      const x = xOf(message.seq, message.timeMs);
      if (x === null) continue;
      markers.push({
        x,
        kind: 'injection',
        title: `注入事件（${message.kind} / ${message.sourceKind}）@ ${formatTime(message.timeMs)} · 约 ${formatTokens(message.tokens)} Token`,
      });
    }
  }
  if (markerKinds.includes('spike')) {
    for (const message of spikes) {
      const x = xOf(message.seq, message.timeMs);
      if (x === null) continue;
      const dominant = dominantOf(message);
      markers.push({
        x,
        kind: 'spike',
        title: `单条消息 #${message.seq} 约 ${formatTokens(message.tokens)} Token · 归因推断：${mechanismLabel(message)} · 主导成分 ${dominant.label} ${dominant.share.toFixed(0)}% · @ ${formatTime(message.timeMs)}`,
      });
    }
  }

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, [
    h('div', {
      key: 'controls',
      style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
    }, [
      h('span', { key: 'title', style: { fontSize: '13px', fontWeight: 500 } }, '上下文演化'),
      h('div', { key: 'xmode', style: { display: 'inline-flex', border: '1px solid color-mix(in srgb, currentColor 22%, transparent)', borderRadius: '6px', overflow: 'hidden' } }, [
        h('button', {
          key: 'step', type: 'button', onClick: () => setXMode('step'),
          style: xModeButtonStyle(xMode === 'step'),
        }, '按步骤'),
        h('button', {
          key: 'turn', type: 'button', onClick: () => setXMode('turn'),
          style: xModeButtonStyle(xMode === 'turn'),
        }, '按轮次'),
        h('button', {
          key: 'time', type: 'button', onClick: () => setXMode('time'),
          style: xModeButtonStyle(xMode === 'time'),
        }, '按时间'),
      ]),
      h('span', { key: 'hint', style: { fontSize: '11px', opacity: 0.55 } }, `请求样本 ${sampleSteps.length} 条 · 事件标记来自已保留记录${contextWindow !== null ? ` · 窗口上限 ${formatFull(contextWindow)}` : ''}`),
      h('span', { key: 'gap', style: { flex: '1 1 8px' } }),
      markerChip('compaction', `摘要压缩 ${timeline?.compactions.filter((event) => event.kind === 'summary').length ?? 0}`, 'var(--dsh-eval-green, #30a46c)', markerKinds.includes('compaction'), () => toggleKind(markerKinds, setMarkerKinds, 'compaction')),
      markerChip('prune', `历史修剪 ${timeline?.compactions.filter((event) => event.kind === 'prune').length ?? 0}`, '#0891b2', markerKinds.includes('prune'), () => toggleKind(markerKinds, setMarkerKinds, 'prune')),
      markerChip('injection', `注入 ${injections.length}`, 'var(--dsh-eval-orange, #e8791a)', markerKinds.includes('injection'), () => toggleKind(markerKinds, setMarkerKinds, 'injection')),
      markerChip('spike', `激增 ${spikes.length}`, 'var(--dsh-eval-red, #e5484d)', markerKinds.includes('spike'), () => toggleKind(markerKinds, setMarkerKinds, 'spike')),
    ]),
    h(LineChart, {
      key: xMode,
      series,
      markers,
      limit: contextWindow !== null && !hidden.includes('limit') ? { value: contextWindow, label: `上下文窗口上限 ${formatFull(contextWindow)} Token` } : null,
      height: 360,
      yLabel: 'Token',
      hidden: new Set(hidden),
      onToggle: (key: string) => setHidden((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]),
      formatX: xMode === 'step'
        ? (value: number) => `#${Math.round(value)}`
        : xMode === 'turn'
          ? (value: number) => `第 ${Math.floor(value)} 轮`
          : (value: number) => formatTime(value),
    }),
    h('p', { key: 'basis', style: { margin: 0, fontSize: '11px', opacity: 0.65 } }, '蓝线为每次模型请求的输入占用（含缓存读）；紫线为请求前消息表面的估算值。事件按发生顺序定位，轮次内保留全部请求。'),
    h('div', {
      key: 'legend-markers',
      style: { display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: '11px', opacity: 0.75 },
    }, [
      h('span', { key: 'm0', style: { opacity: 0.6, width: '100%' } }, '标记说明（点击上方芯片可筛选）：'),
      h('span', { key: 'm1', style: { color: 'var(--dsh-eval-green, #30a46c)' } }, '▲ 摘要压缩（绿色）'),
      h('span', { key: 'prune', style: { color: '#0891b2' } }, '■ 历史修剪（青色，独立一行）'),
      h('span', { key: 'm2', style: { color: 'var(--dsh-eval-orange, #e8791a)' } }, '● 注入事件（橙色竖线）'),
      h('span', { key: 'm3', style: { color: 'var(--dsh-eval-red, #e5484d)' } }, '◆ Token 激增'),
      h('button', { key: 'm4', type: 'button', 'aria-pressed': !hidden.includes('limit'), onClick: () => setHidden((current) => current.includes('limit') ? current.filter((key) => key !== 'limit') : [...current, 'limit']), style: { background: 'transparent', border: 0, cursor: 'pointer', font: 'inherit', color: 'var(--dsh-eval-red, #e5484d)', opacity: hidden.includes('limit') ? 0.4 : 1 } }, '― ― 窗口上限（红色虚线）'),
    ]),
    /* Compaction savings summary */
    (timeline?.compactions?.length ?? 0) > 0 ? h('div', {
      key: 'savings',
      style: {
        border: '1px solid color-mix(in srgb, currentColor 14%, transparent)', borderRadius: '10px',
        padding: '10px 14px', fontSize: '12px', display: 'flex', flexWrap: 'wrap', gap: '6px 20px',
      },
    }, [
      h('span', { key: 't', style: { fontWeight: 600 } }, '上下文回收'),
      h('span', { key: 'count' }, `已记录：摘要压缩 ${timeline!.compactions.filter((event) => event.kind === 'summary').length} 次 · 历史修剪 ${timeline!.compactions.filter((event) => event.kind === 'prune').length} 次（每条为一次修剪事件）`),
      h('span', { key: 'reclaimed' }, `回收 ${formatTokens(timeline!.compactionTotals.reclaimedTokens)} Token`),
      h('span', { key: 'elapsed' }, `累计耗时 ${(timeline!.compactionTotals.elapsedMs / 1000).toFixed(1)}s`),
    ]) : null,
  ]);
}

/** Toggle one marker class in the filter set. */
function toggleKind(
  current: Array<ChartMarker['kind']>,
  setKinds: (value: Array<ChartMarker['kind']>) => void,
  kind: ChartMarker['kind'],
): void {
  setKinds(current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]);
}

/** Token spikes over the message ledger — same heuristic as the tokens tab
 * (≥3× the median of the previous 5 messages, ≥1000 absolute). */
function tokenSpikes(messages: NonNullable<DashboardData['timeline']>['injections']): Array<NonNullable<DashboardData['timeline']>['injections'][number]> {
  const result: Array<NonNullable<DashboardData['timeline']>['injections'][number]> = [];
  for (let index = 0; index < messages.length; index++) {
    const window = messages.slice(Math.max(0, index - 5), index).map((message) => message.tokens).sort((a, b) => a - b);
    if (window.length < 3) continue;
    const median = window[Math.floor(window.length / 2)]!;
    const tokens = messages[index]!.tokens;
    if (tokens >= 1000 && tokens >= median * 3) result.push(messages[index]!);
  }
  return result;
}

/** A filter chip for the marker classes. */
function markerChip(kind: ChartMarker['kind'], label: string, color: string, active: boolean, onToggle: () => void): unknown {
  return h('button', {
    key: `mk-${kind}`,
    type: 'button',
    onClick: onToggle,
    title: `显示/隐藏 ${label.replace(/ \d+$/, '')}标记`,
    'aria-pressed': active,
    style: {
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '1px 9px', borderRadius: '999px', font: 'inherit', fontSize: '11px',
      cursor: 'pointer', color: 'inherit',
      border: `1px solid ${active ? color : 'color-mix(in srgb, currentColor 18%, transparent)'}`,
      background: active ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent',
      opacity: active ? 1 : 0.45,
    },
  }, [
    h('span', { key: 'shape', style: { color } }, kind === 'compaction' ? '▲' : kind === 'prune' ? '■' : kind === 'injection' ? '●' : '◆'),
    h('span', { key: 'label' }, label),
  ]);
}

function xModeButtonStyle(active: boolean): Record<string, unknown> {
  return {
    background: active ? 'color-mix(in srgb, currentColor 12%, transparent)' : 'transparent',
    border: 'none', padding: '2px 10px', font: 'inherit', fontSize: '11.5px', cursor: 'pointer', color: 'inherit',
  };
}

const emptyStyle = {
  textAlign: 'center', padding: '48px 20px', opacity: 0.55, fontSize: '13px',
} as const;
