import { EvidenceButton } from './evidencePanel.js';
import { compactionEvidence, messageEvidence, eventRef, type EvidenceProps } from './evidence.js';
/** PRD §3.5: expandable event cards and historical surface comparison. */
import { h, useRef, useState } from './react-binding.js';
import { formatDateTime, formatFull, formatMs, formatPercent, formatTokens } from './format.js';
import { MESSAGE_KIND_LABELS, isInjected, type DashboardData } from './derive.js';
import type { CompactionSnapshot, ContextTimeline } from './types.js';

type Compaction = ContextTimeline['compactions'][number];
const card = { border: '1px solid color-mix(in srgb, currentColor 18%, transparent)', borderRadius: 10, padding: '12px', fontSize: 12 };
const summaryStyle = { cursor: 'pointer', lineHeight: 1.8 };
const preStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0, font: 'inherit', lineHeight: 1.6 };

export function CompactionTab(props: EvidenceProps & { data: DashboardData; sessionId?: string | null }): unknown {
  const { data, sessionId } = props;
  const [filter, setFilter] = useState<'injected' | 'feedback' | 'direct'>('injected');
  const compactions = data.timeline?.compactions ?? [];
  const groups = groupCompactions(compactions);
  const totals = data.timeline?.compactionTotals;
  const injected = data.messages.filter(isInjected);
  const feedback = data.messages.filter((message) => message.kind === 'tool-result');
  const direct = data.messages.filter((message) => message.kind === 'user' && message.sourceKind === 'user');
  const shown = filter === 'injected' ? injected : filter === 'feedback' ? feedback : direct;
  const categoryLabel = filter === 'injected' ? '上下文注入' : filter === 'feedback' ? '工具结果回填' : '直接输入';
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } }, [
    h('div', { key: 'totals', style: { display: 'flex', flexWrap: 'wrap', gap: '8px 20px', fontSize: 12 } }, [
      h('strong', { key: 'title' }, '压缩与注入'),
      h('span', { key: 'count' }, `已记录：摘要压缩 ${compactions.filter((event) => event.kind === 'summary').length} 次 · 历史修剪 ${compactions.filter((event) => event.kind === 'prune').length} 次`),
      h('span', { key: 'savings' }, `累计回收 ${formatTokens(totals?.reclaimedTokens ?? 0)} Token · 耗时 ${formatMs(totals?.elapsedMs ?? 0)}`),
      logDownload(sessionId),
    ]),
    h('p', { key: 'hint', style: { margin: 0, fontSize: 11, opacity: 0.65 } }, '点击卡片展开详情。历史快照为有界内容节选，Token 为消息表面估算值；累计统计可能包含已超出保留范围的事件。'),
    ...(groups.length ? groups.slice().reverse().map((group) => {
      if (group.length === 1) return eventCard(group[0]!, sessionId, props);
      const first = group[0]!;
      const last = group[group.length - 1]!;
      const reclaimed = first.beforeTokens !== null && last.afterTokens !== null ? Math.max(0, first.beforeTokens - last.afterTokens) : null;
      const ratio = reclaimed !== null && first.beforeTokens !== null && first.beforeTokens > 0 ? reclaimed / first.beforeTokens : null;
      return h('details', { key: `prune-batch-${first.seq}`, style: card }, [
        h('summary', { key: 'summary', style: summaryStyle }, [
          h('strong', { key: 'title' }, `✂️ 历史修剪 · ${group.length} 次已聚合 · ${formatDateTime(first.timeMs)}`),
          h('div', { key: 'impact', style: { marginLeft: 16 } }, `${token(first.beforeTokens)} → ${token(last.afterTokens)} Token · 合计回收 ${token(reclaimed)} · 回收率 ${formatPercent(ratio)}`),
        ]),
        h(EvidenceButton, {...props, chain: () => compactionEvidence(sessionId ?? 'current', group), label: '查看修剪组证据链'}),
        h('p', { key: 'rule', style: { opacity: 0.65 } }, '按连续事件、2 秒内发生且前后 Token 衔接聚合展示；不代表宿主记录了同一事务。展开下列条目查看各次替换。'),
        h('div', { key: 'items', style: { display: 'grid', gap: 8 } }, group.map((event) => eventCard(event, sessionId, props))),
      ]);
    }) : [h('div', { key: 'empty', style: card }, '暂无压缩或历史修剪事件。')]),
    h('div', { key: 'filters', style: { display: 'flex', gap: 8, alignItems: 'center' } }, [
      h('strong', { key: 'title' }, '上下文追加事件'),
      ...(['injected', 'feedback', 'direct'] as const).map((value) => h('button', { key: value, type: 'button', 'aria-pressed': filter === value, onClick: () => setFilter(value), style: { cursor: 'pointer', opacity: filter === value ? 1 : 0.55 } }, value === 'injected' ? `上下文注入 ${injected.length}` : value === 'feedback' ? `工具结果回填 ${feedback.length}` : `直接输入 ${direct.length}`)),
    ]),
    h('p', { key: 'injection-grouping', style: { margin: 0, fontSize: 11, opacity: 0.65 } }, '工具结果回填按结果消息计数，通过 callId 关联工具调用，不保证数量严格一一对应。上下文注入不含工具结果、助手输出及用户直接输入。按秒聚合，Token 为消息估算值，不等于请求窗口实际增量。'),
    ...(shown.length ? groupInjections(shown).slice().reverse().map((group) => {
      if (group.length === 1) return injectionCard(group[0]!, sessionId, props);
      const sources = new Map<string, number>();
      for (const message of group) {
        const label = `${MESSAGE_KIND_LABELS[message.kind] ?? message.kind} / ${message.toolName ?? message.sourceKind}`;
        sources.set(label, (sources.get(label) ?? 0) + 1);
      }
      return h('details', { key: `injection-group-${Math.floor(group[0]!.timeMs / 1000)}`, style: card }, [
        h('summary', { key: 'summary', style: summaryStyle }, [
          h('strong', { key: 'title' }, `📥 ${categoryLabel} · ${group.length} 条已聚合 · ${formatDateTime(group[0]!.timeMs)}`),
          h('div', { key: 'total', style: { marginLeft: 16 } }, `合计 +${formatFull(group.reduce((sum, message) => sum + message.tokens, 0))} Token · ${[...sources].map(([source, count]) => `${source} ×${count}`).join(' · ')}`),
        ]),
        h(EvidenceButton, {...props, chain: () => ({title:`同秒${categoryLabel}证据`,conclusion:`${group.length} 条 · ${group.reduce((sum,item)=>sum+item.tokens,0)} Token`,level:'derived',rule:'按显示时间（秒）分组；不表示同一事务或因果关系。',facts:[],notes:['组内保留事件原始顺序。'],refs:group.map(item=>eventRef(sessionId ?? 'current',item.seq,categoryLabel))}),label:`查看${categoryLabel}组证据链`}),
        h('div', { key: 'items', style: { display: 'grid', gap: 8, marginTop: 8 } }, group.map((message) => injectionCard(message, sessionId, props))),
      ]);
    }) : [h('div', { key: 'no-injections', style: card }, `暂无${categoryLabel}事件。`)]),
  ]);
}

export function CompactionDetails(props: { event: Compaction; sessionId?: string | null }): unknown {
  const { event, sessionId } = props;
  const [compare, setCompare] = useState(true);
  const [showRetained, setShowRetained] = useState(false);
  const [sync, setSync] = useState(true);
  const beforeRef = useRef<HTMLElement | null>(null);
  const afterRef = useRef<HTMLElement | null>(null);
  const syncing = useRef(false);
  const detail = event.detail;
  if (!detail) return h('div', { style: { marginTop: 12 } }, [h('p', { key: 'empty' }, '详情不可用：此事件未包含历史上下文快照。'), logDownload(sessionId)]);
  const scroll = (side: 'before' | 'after') => {
    if (!sync || syncing.current) return;
    const source = side === 'before' ? beforeRef.current : afterRef.current;
    const target = side === 'before' ? afterRef.current : beforeRef.current;
    if (!source || !target) return;
    const sourceRange = source.scrollHeight - source.clientHeight;
    const targetTop = sourceRange > 0 ? source.scrollTop / sourceRange * Math.max(0, target.scrollHeight - target.clientHeight) : 0;
    if (Math.abs(target.scrollTop - targetTop) < 1) return;
    syncing.current = true;
    // Override the host's smooth-scroll CSS so two animated panes cannot chase each other.
    if (typeof target.scrollTo === 'function') target.scrollTo({ top: targetTop, behavior: 'instant' });
    else target.scrollTop = targetTop;
    syncing.current = false;
  };
  const replacements = detail.after?.nodes.filter((node) => node.changed) ?? [];
  const affected = detail.before.nodes.filter((node) => node.changed);
  const replacedCount = detail.after ? detail.before.nodeCount - detail.after.nodeCount + replacements.length : null;
  const replacementTokens = replacements.reduce((sum, node) => sum + node.tokens, 0);
  const removedTokens = event.beforeTokens !== null && event.afterTokens !== null ? event.beforeTokens - event.afterTokens + replacementTokens : null;
  const replacementIds = replacements.map((node) => `#${node.seq}`).join('、');
  return h('div', { style: { marginTop: 12, display: 'grid', gap: 10 } }, [
    h('div', { key: 'algorithm' }, `算法信息：${detail.algorithm}`),
    h('div', { key: 'cause' }, `触发原因：${triggerLabel(event)}。宿主未提供的自动/手动原因不作推断。`),
    h('section', { key: 'method', style: { padding: '12px 14px', border: '1px solid color-mix(in srgb, currentColor 18%, transparent)', borderRadius: 8, lineHeight: 1.7 } }, [
      h('strong', { key: 'title' }, event.kind === 'summary' ? '替换手段：摘要压缩 → 检查点消息 → 上下文范围替换' : '替换手段：规则裁剪 → 精简消息 → 上下文范围替换'),
      h('ol', { key: 'steps', style: { margin: '6px 0', paddingLeft: 20 } }, (event.kind === 'summary' ? [
        detail.algorithm.includes('LLM 调用') ? `将选中的历史消息交给记录中的模型生成摘要（${detail.algorithm}）。` : `宿主为选中的历史消息生成摘要；${detail.algorithm}。具体生成调用方式未记录。`,
        '将生成的摘要包装成检查点消息，作为后续对话可继续使用的背景信息。',
        `用右侧的检查点消息 ${replacementIds || '（详情不可用）'} 替代左侧整批历史消息；范围外的上下文继续保留。`,
      ] : [
        '对选中的历史消息应用裁剪规则，不调用模型生成摘要。',
        replacements.some((node) => node.preview.includes('[... tool result middle pruned ...]')) ? '本条替代内容包含宿主的中段修剪标记：保留工具输出的头尾，移除中间长文本并插入省略标记。' : '本条具体裁剪规则未记录；实际保留了什么以右侧替代内容为准。',
        `用精简后的消息 ${replacementIds || '（详情不可用）'} 替代命中的历史范围；其余消息继续保留。`,
      ]).map((step, index) => h('li', { key: index }, step))),
      h('div', { key: 'storage', style: { fontSize: 11, opacity: 0.7 } }, '这里改变的是后续请求使用的有效上下文。原始事件仍保留在会话日志中，可以通过“下载完整日志”查看。'),
      h('details', { key: 'evidence' }, [
        h('summary', { key: 'head', style: { cursor: 'pointer', fontSize: 11 } }, '查看机制依据'),
        h('div', { key: 'record', style: { fontSize: 11, overflowWrap: 'anywhere' } }, `宿主事件 ${event.kind === 'summary' ? 'compaction/summary' : 'compaction/prune'} #${event.seq} → 紧邻且范围一致的 surfaceOp.replace → 实际替代消息 ${replacementIds || '未记录'}。${event.kind === 'summary' ? '模型信息来自该次摘要事件；检查点与范围替换行为已核对本地 DSH 宿主实现。' : '头尾保留规则仅在替代内容出现宿主中段修剪标记时确认；否则明确显示未记录。'}`),
      ]),
    ]),
    h('div', { key: 'replacement-relation', style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 20px', padding: 14, borderRadius: 8, background: 'color-mix(in srgb, #4285f4 7%, transparent)', border: '1px solid color-mix(in srgb, #4285f4 30%, transparent)' } }, [
      h('strong', { key: 'group' }, `替换组 #${event.seq}`),
      h('span', { key: 'from', style: { color: '#c53030' } }, `${replacedCount ?? '未知数量'} 条历史消息 · ${token(removedTokens)} Token`),
      h('strong', { key: 'arrow', 'aria-hidden': true }, '→'),
      h('span', { key: 'to', style: { color: '#218250' } }, detail.after ? `${replacements.length} 条${event.kind === 'summary' ? '摘要消息' : '修剪替代消息'} ${replacementIds} · ${formatFull(replacementTokens)} Token` : '详情不可用：未记录替换结果'),
    ]),
    h('p', { key: 'mapping-note', style: { margin: 0, fontSize: 11, opacity: 0.7 } }, `这是整批替换：左侧历史范围共同被右侧新消息替代，并非左右逐行对应。当前展示 ${affected.length} 条历史消息节选${replacedCount !== null && replacedCount > affected.length ? `（共 ${replacedCount} 条）` : ''}；未受影响的消息默认隐藏。`),
    h('div', { key: 'controls', style: { display: 'flex', gap: 12, flexWrap: 'wrap' } }, [
      h('button', { key: 'mode', type: 'button', 'aria-pressed': compare, onClick: () => setCompare((value) => !value) }, compare ? '退出对比视图' : '对比视图'),
      h('label', { key: 'retained' }, [h('input', { key: 'check', type: 'checkbox', checked: showRetained, onChange: () => setShowRetained((value) => !value) }), '显示保留上下文']),
      compare ? h('label', { key: 'sync' }, [h('input', { key: 'check', type: 'checkbox', checked: sync, onChange: () => setSync((value) => !value) }), '按进度同步滚动（非逐行对应）']) : null,
      logDownload(sessionId),
    ]),
    h('div', { key: 'snapshots', style: { display: 'grid', gridTemplateColumns: compare ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)', gap: 10 } }, [
      snapshotPanel('被替换的历史内容', detail.before, beforeRef, () => scroll('before'), false, showRetained, `替换组 #${event.seq}`),
      snapshotPanel('替换后的实际内容', detail.after, afterRef, () => scroll('after'), true, showRetained, `替换组 #${event.seq}`),
    ]),
  ]);
}

function snapshotPanel(label: string, snapshot: CompactionSnapshot | null, ref: { current: HTMLElement | null }, onScroll: () => void, after: boolean, showRetained: boolean, group: string): unknown {
  const displayed = snapshot?.nodes.filter((node) => showRetained || node.changed) ?? [];
  return h('section', { key: label, style: { minWidth: 0 } }, [
    h('strong', { key: 'label', style: { color: after ? '#218250' : '#c53030' } }, `${label} · ${group}`),
    h('p', { key: 'coverage', style: { margin: '4px 0', opacity: 0.6, fontSize: 11 } }, snapshot ? `展示 ${displayed.length} 条${showRetained ? `（快照共 ${snapshot.nodeCount} 条）` : after ? '实际替代消息' : '被替换消息'} · 内容为节选${snapshot.truncated ? '（含截断）' : ''}` : '详情不可用：尚未记录匹配的替换结果。'),
    h('div', { key: 'scroll', ref: ref as unknown as string, onScroll, 'aria-label': label, tabIndex: 0, style: { maxHeight: 300, overflowY: 'auto', border: '1px solid color-mix(in srgb, currentColor 15%, transparent)', borderRadius: 6 } },
      displayed.map((node) => h('div', { key: node.seq, style: { padding: 8, borderBottom: '1px solid color-mix(in srgb, currentColor 10%, transparent)', background: node.changed ? after ? '#30a46c18' : '#e5484d18' : 'transparent' } }, [
        h('div', { key: 'meta', style: { fontWeight: 600, color: node.changed ? after ? '#218250' : '#c53030' : 'inherit' } }, `${node.changed ? after ? '＋ 替代内容' : '− 被替换' : '保留'} · #${node.seq} ${node.label} · ${formatFull(node.tokens)} Token`),
        h('pre', { key: 'content', style: preStyle }, node.preview || '无文本预览'),
      ]))),
  ]);
}
function triggerLabel(event: Compaction): string { return event.detail?.trigger === 'manual' ? '手动（命令或轮次外独立事务）' : '未记录（自动/手动未知）'; }
function token(value: number | null): string { return value === null ? '—' : formatFull(value); }
function logDownload(sessionId?: string | null): unknown {
  return sessionId ? h('a', { key: 'download', href: `/api/session.export?sessionId=${encodeURIComponent(sessionId)}&includeDescendants=false`, download: true }, '下载完整日志') : h('span', { key: 'download', style: { opacity: 0.6 } }, '完整日志不可用：缺少会话标识');
}

/** Conservative presentation grouping; summary events and discontinuities split batches. */
export function groupCompactions(events: Compaction[]): Compaction[][] {
  const groups: Compaction[][] = [];
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const group = groups[groups.length - 1];
    const previous = group?.[group.length - 1];
    const first = group?.[0];
    if (event.kind === 'prune' && previous?.kind === 'prune' && first
      && event.seq === previous.seq + 2 && event.timeMs >= previous.timeMs && event.timeMs - first.timeMs <= 2000
      && previous.afterTokens !== null && event.beforeTokens === previous.afterTokens) group!.push(event);
    else groups.push([event]);
  }
  return groups;
}

function eventCard(event: Compaction, sessionId?: string | null, evidence: EvidenceProps = {}): unknown {
  return h('details', { key: event.id, style: card }, [
      h('summary', { key: 'summary', style: summaryStyle }, [
        h('strong', { key: 'kind' }, `${event.kind === 'summary' ? '📦 摘要压缩' : '✂️ 历史修剪'} · ${formatDateTime(event.timeMs)}`),
        h('div', { key: 'tokens', style: { marginLeft: 16 } }, `${token(event.beforeTokens)} → ${token(event.afterTokens)} Token · 回收 ${token(event.reclaimedTokens)} · 回收率 ${formatPercent(event.reclaimRatio)} · 耗时 ${formatMs(event.elapsedMs)}`),
        h('div', { key: 'reason', style: { marginLeft: 16, opacity: 0.65 } }, `触发原因：${triggerLabel(event)}${event.turn !== null ? ` · 第 ${event.turn} 轮` : ''}`),
      ]),
      h(EvidenceButton, {...evidence, chain: () => compactionEvidence(sessionId ?? 'current', [event])}),
      h(CompactionDetails, { key: 'detail', event, sessionId }),
    ]);
}

type Injection = ContextTimeline['injections'][number];
/** Match the second-resolution time shown on event cards; retain original sequence inside each group. */
export function groupInjections(messages: Injection[]): Injection[][] {
  const groups = new Map<number, Injection[]>();
  for (const message of [...messages].sort((a, b) => a.seq - b.seq)) {
    const second = Math.floor(message.timeMs / 1000);
    const group = groups.get(second);
    if (group) group.push(message);
    else groups.set(second, [message]);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, group]) => group);
}
function injectionCard(message: Injection, sessionId?: string | null, evidence: EvidenceProps = {}): unknown {
  return h('details', { key: `injection-${message.seq}`, style: card }, [
      h('summary', { key: 'summary', style: summaryStyle }, `📥 ${MESSAGE_KIND_LABELS[message.kind] ?? message.kind} · ${message.sourceKind}${message.toolName ? ` / ${message.toolName}` : ''} · ${formatDateTime(message.timeMs)} · +${formatFull(message.tokens)} Token`),
      h('div', { key: 'detail', style: { marginTop: 12, display: 'grid', gap: 10 } }, [
        h(EvidenceButton, {...evidence, chain: () => messageEvidence(sessionId ?? 'current', message, [message])}),
        h('div', { key: 'source' }, `来源：${MESSAGE_KIND_LABELS[message.kind] ?? message.kind} / ${message.sourceKind}${message.toolName ? ` / ${message.toolName}` : ''} · 事件 #${message.seq}${message.turn !== null ? ` · 第 ${message.turn} 轮` : ''}`),
        h('div', { key: 'call' }, message.kind === 'tool-result' ? `关联工具调用 callId：${message.callId ?? '未提供'}（按结果消息计数）` : '上下文消息追加'),
        h('div', { key: 'delta' }, `加入前 ${formatFull(Math.max(0, message.cumulativeTokens - message.tokens))} → 加入后 ${formatFull(message.cumulativeTokens)} Token（消息表面估算，增加 ${formatFull(message.tokens)}；非请求窗口实际增量）`),
        h('div', { key: 'split' }, `文本 ${formatFull(message.textTokens)} · 工具调用 ${formatFull(message.toolCallTokens)} · 文件/图像 ${formatFull(message.fileTokens)} Token`),
        h('div', { key: 'preview', style: { maxHeight: 240, overflowY: 'auto', padding: 10, background: 'color-mix(in srgb, currentColor 4%, transparent)', borderRadius: 6 } }, h('pre', { style: preStyle }, message.preview || '详情不可用：宿主未提供内容预览。')),
        h('span', { key: 'limit', style: { opacity: 0.6 } }, '预览最多 1000 字符；完整内容请下载会话日志。'),
        logDownload(sessionId),
      ]),
    ]);
}
