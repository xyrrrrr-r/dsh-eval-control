/**
 * Message tokens tab (PRD §3.3): the message-level token ledger — role icons,
 * excerpts, input/output/cumulative token columns, kind + token-range filters,
 * sorting, Top-3 red highlight, anomaly (spike) yellow highlight, and an
 * expandable detail row with content, token split, and the linked tool call
 * (jump to the host Trajectory view).
 */
import { useState } from './react-binding.js';
import { h } from './react-binding.js';
import { formatFull, formatTime, formatTokens } from './format.js';
import { PieChart, type Segment } from './charts.js';
import { MESSAGE_KIND_LABELS, isInjected, type DashboardData } from './derive.js';
import type { ContextTimeline } from './types.js';

type Message = ContextTimeline['injections'][number];
type SortKey = 'time' | 'tokens' | 'output' | 'cumulative' | 'turn';

const KIND_FILTERS: Array<{ id: 'all' | 'injected' | Message['kind']; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'injected', label: '仅注入' },
  { id: 'user', label: '用户' },
  { id: 'assistant', label: '助手' },
  { id: 'tool-result', label: '工具结果' },
  { id: 'system', label: '系统' },
  { id: 'developer', label: '开发者' },
];

/** Compact role labels for the cause-summary line (助手 11 · 工具 1). */
const SHORT_KIND_LABELS: Record<string, string> = {
  user: '用户',
  assistant: '助手',
  'tool-result': '工具',
  system: '系统',
  developer: '开发者',
};

const KIND_ICONS: Record<string, string> = {
  user: '👤',
  assistant: '🤖',
  'tool-result': '🔧',
  system: '⚙️',
  developer: '🛠️',
};

/** Spike heuristic (PRD §3.3 异常消息): a row whose tokens are ≥3× the median
 * of its previous 5 messages (time order) and ≥1000 absolute. */
interface SpikeInfo { median: number; ratio: number }

function spikeMap(messages: Message[]): Map<number, SpikeInfo> {
  const result = new Map<number, SpikeInfo>();
  for (let i = 0; i < messages.length; i++) {
    const window = messages.slice(Math.max(0, i - 5), i).map((message) => message.tokens).sort((a, b) => a - b);
    if (window.length < 3) continue;
    const median = window[Math.floor(window.length / 2)]!;
    const tokens = messages[i]!.tokens;
    if (tokens >= 1000 && tokens >= median * 3) {
      result.set(messages[i]!.seq, { median, ratio: median > 0 ? tokens / median : 0 });
    }
  }
  return result;
}

/** Drop detection (累计上下文骤降): appends only ever grow the surface, so any
 * fall in the running cumulative between consecutive ledger rows means a
 * surface replace (compaction summary / history prune) reclaimed context in
 * between. The row right after the reclaim carries the drop. */
interface DropInfo { prev: number; next: number; drop: number; pct: number; prevSeq: number }

function dropMap(messages: Message[]): Map<number, DropInfo> {
  const result = new Map<number, DropInfo>();
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1]!.cumulativeTokens;
    const next = messages[i]!.cumulativeTokens;
    const drop = prev - next;
    if (drop >= 1000) {
      result.set(messages[i]!.seq, { prev, next, drop, pct: prev > 0 ? (drop / prev) * 100 : 0, prevSeq: messages[i - 1]!.seq });
    }
  }
  return result;
}

/** Dominant token component of a message (why it is big). */
export function dominantOf(message: Message): { label: string; tokens: number; share: number } {
  const total = message.textTokens + message.toolCallTokens + message.fileTokens;
  const parts: Array<[string, number]> = [
    ['文本', message.textTokens],
    ['工具调用', message.toolCallTokens],
    ['文件/图片', message.fileTokens],
  ];
  parts.sort((a, b) => b[1] - a[1]);
  const [label, tokens] = parts[0]!;
  return { label, tokens, share: total > 0 ? (tokens / total) * 100 : 0 };
}


export function TokensTab(props: { data: DashboardData; inspectCall?: (callId: string) => void; onOpenCompaction?: () => void }): unknown {
  const { data } = props;
  const [filter, setFilter] = useState<'all' | 'injected' | Message['kind']>('all');
  const [sort, setSort] = useState<SortKey>('time');
  const [descending, setDescending] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [minTokens, setMinTokens] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [showCauses, setShowCauses] = useState(true);
  const [showAllSpikes, setShowAllSpikes] = useState(false);

  const messages = data.messages;
  const min = minTokens.trim() === '' ? null : Number(minTokens);
  const max = maxTokens.trim() === '' ? null : Number(maxTokens);
  const rangeValid = (min === null || Number.isFinite(min)) && (max === null || Number.isFinite(max));

  const filtered = messages.filter((message) => {
    if (filter === 'all') return true;
    if (filter === 'injected') return isInjected(message);
    if (message.kind !== filter) return false;
    return true;
  }).filter((message) => {
    if (!rangeValid) return true;
    if (min !== null && message.tokens < min) return false;
    if (max !== null && message.tokens > max) return false;
    return true;
  });
  const sorted = filtered.slice().sort((a, b) => {
    const direction = descending ? -1 : 1;
    if (sort === 'tokens') return (a.tokens - b.tokens) * direction;
    if (sort === 'output') return ((a.outputTokens ?? 0) - (b.outputTokens ?? 0)) * direction;
    if (sort === 'cumulative') return (a.cumulativeTokens - b.cumulativeTokens) * direction;
    if (sort === 'turn') return ((a.turn ?? -1) - (b.turn ?? -1)) * direction;
    return (a.timeMs - b.timeMs) * direction;
  });
  const topThree = new Set(
    messages.slice().sort((a, b) => b.tokens - a.tokens).slice(0, 3).map((message) => message.seq),
  );
  const spikes = spikeMap(messages);
  const drops = dropMap(messages);
  const totalTokens = filtered.reduce((sum, message) => sum + message.tokens, 0);
  const average = filtered.length > 0 ? totalTokens / filtered.length : 0;
  const visibleSpikes = sorted.filter((message) => spikes.has(message.seq)).length;
  const visibleDrops = sorted.filter((message) => drops.has(message.seq)).length;
  const topRows = messages.slice().sort((a, b) => b.tokens - a.tokens).slice(0, 3);
  const spikeRows = messages.filter((message) => spikes.has(message.seq));
  const dropRows = messages.filter((message) => drops.has(message.seq));
  const locate = (seq: number): void => {
    setExpanded(seq);
    const row = document.getElementById(`dsh-msg-row-${seq}`);
    if (row !== null && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, [
    h('div', {
      key: 'controls',
      style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
    }, [
      h('span', { key: 'title', style: { fontSize: '13px', fontWeight: 500 } }, '消息 Token'),
      h('div', { key: 'filters', style: { display: 'inline-flex', flexWrap: 'wrap', gap: '0', border: '1px solid color-mix(in srgb, currentColor 22%, transparent)', borderRadius: '6px', overflow: 'hidden' } },
        KIND_FILTERS.map((item) => h('button', {
          key: item.id,
          type: 'button',
          onClick: () => setFilter(item.id),
          style: {
            background: filter === item.id ? 'color-mix(in srgb, currentColor 12%, transparent)' : 'transparent',
            border: 'none', borderRight: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
            padding: '2px 10px', font: 'inherit', fontSize: '11.5px', cursor: 'pointer', color: 'inherit',
          },
        }, item.label))),
      h('label', {
        key: 'range',
        style: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', opacity: 0.8 },
      }, [
        'Token 范围',
        h('input', {
          key: 'min', type: 'number', min: '0', placeholder: '最小',
          value: minTokens,
          onInput: (event: { target: { value: string } }) => setMinTokens(event.target.value),
          style: inputStyle,
        }),
        '–',
        h('input', {
          key: 'max', type: 'number', min: '0', placeholder: '最大',
          value: maxTokens,
          onInput: (event: { target: { value: string } }) => setMaxTokens(event.target.value),
          style: inputStyle,
        }),
      ]),
    ]),
    h('div', {
      key: 'stats',
      style: { display: 'flex', gap: '8px 22px', flexWrap: 'wrap', fontSize: '12px', opacity: 0.8 },
    }, [
      h('span', { key: 'count' }, `显示 ${sorted.length} / ${messages.length} 条`),
      h('span', { key: 'total' }, `合计约 ${formatTokens(totalTokens)} Token`),
      h('span', { key: 'avg' }, `平均 ${Math.round(average)} Token/条`),
      h('span', { key: 'top', style: { color: 'var(--dsh-eval-red, #d64545)' } }, '👑 红色 = Top 3 Token 消耗'),
      h('span', { key: 'spike', style: { color: 'var(--dsh-eval-yellow, #b98900)' } }, `⚡ 突增 ${visibleSpikes} 条（≥3× 前条中位数且 ≥1K）`),
      h('span', { key: 'drop', style: { color: 'var(--dsh-eval-yellow, #b98900)' } }, `🔻 突降 ${visibleDrops} 条（累计降 ≥1K，压缩/修剪回收）`),
      h('span', { key: 'cap', style: { opacity: 0.7 } }, data.messageCapNote ? '（最近 64 条，更早消息已截断）' : ''),
      h('span', { key: 'note', style: { opacity: 0.7 } }, '估算值 · 点击行查看详情'),
    ]),
    renderCausePanel({
      data, topRows, spikeRows, dropRows, drops, spikes, showCauses, setShowCauses, showAllSpikes, setShowAllSpikes, locate, onOpenCompaction: props.onOpenCompaction,
    }),
    messages.length === 0
      ? h('div', { key: 'empty', style: emptyStyle }, '暂无消息记录。开始对话后此处列出每条消息的 Token 估算、角色与时间。')
      : h('table', {
        key: 'table',
        style: { borderCollapse: 'collapse', width: '100%', fontSize: '12px' },
      }, [
        h('thead', { key: 'head' }, h('tr', null, [
          th('seq', '#'),
          th('kind', '角色'),
          th('summary', '摘要'),
          th('turn', '轮次', 'turn'),
          sortableTh('time', '时间', 'time', sort, descending, () => toggleSort('time', setSort, setDescending)),
          sortableTh('input', '输入 Token', 'tokens', sort, descending, () => toggleSort('tokens', setSort, setDescending)),
          sortableTh('output', '输出 Token', 'output', sort, descending, () => toggleSort('output', setSort, setDescending)),
          sortableTh('cumulative', '累计 Token', 'cumulative', sort, descending, () => toggleSort('cumulative', setSort, setDescending)),
        ])),
        h('tbody', { key: 'body' }, sorted.map((message) => {
          const isTop = topThree.has(message.seq);
          const spike = spikes.get(message.seq) ?? null;
          const isSpike = spike !== null;
          const drop = drops.get(message.seq) ?? null;
          const isOpen = expanded === message.seq;
          const background = isTop
            ? 'color-mix(in srgb, var(--dsh-eval-red, #d64545) 13%, transparent)'
            : isSpike || drop !== null
              ? 'color-mix(in srgb, var(--dsh-eval-yellow, #e6a700) 16%, transparent)'
              : isOpen ? 'color-mix(in srgb, currentColor 6%, transparent)' : undefined;
          const mainRow = h('tr', {
            key: String(message.seq),
            id: `dsh-msg-row-${message.seq}`,
            onClick: () => setExpanded(isOpen ? null : message.seq),
            style: { cursor: 'pointer', background },
          }, [
            h('td', { key: 'seq', style: { ...tdStyle, whiteSpace: 'nowrap' } }, [
              isTop ? h('span', { key: 'crown', title: 'Top 3 Token 消耗' }, '👑') : null,
              isSpike && spike !== null
                ? h('span', {
                  key: 'spike',
                  title: spikeLabel(spike, message.tokens),
                }, '⚡')
                : null,
              drop !== null
                ? h('span', {
                  key: 'drop',
                  title: `累计上下文骤降 ${formatTokens(drop.drop)} Token（${formatTokens(drop.prev)} → ${formatTokens(drop.next)}，−${drop.pct.toFixed(1)}%）· 压缩/修剪回收`,
                }, '🔻')
                : null,
              `#${message.seq}`,
            ]),
            h('td', { key: 'kind', style: { ...tdStyle, whiteSpace: 'nowrap' } }, [
              h('span', { key: 'icon', style: { marginRight: '4px' } }, KIND_ICONS[message.kind] ?? '📄'),
              MESSAGE_KIND_LABELS[message.kind] ?? message.kind,
            ]),
            h('td', { key: 'summary', style: { ...tdStyle, maxWidth: '380px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              `${message.preview.replace(/\n/g, ' ').slice(0, 50)}${message.preview.length > 50 ? '…' : ''}`),
            h('td', { key: 'turn', style: tdStyle }, message.turn === null ? '—' : String(message.turn)),
            h('td', { key: 'time', style: { ...tdStyle, whiteSpace: 'nowrap' } }, formatTime(message.timeMs)),
            h('td', { key: 'tokens', style: { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: isTop ? 600 : 400 } }, formatFull(message.tokens)),
            h('td', { key: 'output', style: { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: message.outputTokens === null ? 0.35 : 1 } },
              message.outputTokens === null ? '—' : formatFull(message.outputTokens)),
            h('td', { key: 'cumulative', style: { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.75 } }, formatTokens(message.cumulativeTokens)),
          ]);
          if (!isOpen) return mainRow;
          return [
            mainRow,
            h('tr', { key: `${message.seq}-detail` }, h('td', {
              key: 'detail',
              colSpan: 8,
              style: { ...tdStyle, background: 'color-mix(in srgb, currentColor 5%, transparent)', fontSize: '11.5px' },
            }, [
              h('div', { key: 'meta', style: { display: 'flex', flexWrap: 'wrap', gap: '4px 18px', marginBottom: '8px' } }, [
                h('span', { key: 'seq' }, `事件序号 ${message.seq}`),
                h('span', { key: 'source' }, `来源 ${sourceLabel(message)}`),
                h('span', { key: 'turn' }, message.turn === null ? '轮次 —' : `轮次 ${message.turn}`),
                h('span', { key: 'time' }, `时间 ${formatTime(message.timeMs)}`),
                h('span', { key: 'tokens' }, `输入估算 ${formatFull(message.tokens)} Token${data.surfaceTotal > 0 ? ` · 占当前表面 ${((message.tokens / data.surfaceTotal) * 100).toFixed(1)}%` : ''}`),
                message.outputTokens !== null ? h('span', { key: 'output' }, `模型输出 ${formatFull(message.outputTokens)} Token（服务商上报）`) : null,
              ]),
              drop !== null
                ? h('div', {
                  key: 'reclaim',
                  style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', padding: '6px 10px', borderRadius: '6px', background: 'color-mix(in srgb, var(--dsh-eval-yellow, #e6a700) 14%, transparent)' },
                }, [
                  h('span', { key: 'icon' }, '🔻'),
                  h('span', { key: 'text' },
                    `累计上下文骤降：${formatTokens(drop.prev)} → ${formatTokens(drop.next)}（回收 ${formatTokens(drop.drop)} Token，−${drop.pct.toFixed(1)}%）· 此前发生了压缩摘要或历史修剪`),
                  props.onOpenCompaction !== undefined
                    ? h('button', {
                      key: 'open',
                      type: 'button',
                      style: linkButtonStyle,
                      onClick: props.onOpenCompaction,
                    }, '查看压缩事件 →')
                    : null,
                ])
                : null,
              tokenSplitBar(message),
              h('div', {
                key: 'content',
                style: { marginTop: '8px' },
              }, [
                h('div', { key: 'label', style: { opacity: 0.6, marginBottom: '3px' } },
                  `消息内容（有界节选，最多 1000 字符${message.preview.length >= 1000 ? '，已截断' : ''}）`),
                h('div', {
                  key: 'text',
                  style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: 1.55, wordBreak: 'break-word', whiteSpace: 'pre-wrap', maxHeight: '180px', overflowY: 'auto', border: '1px solid color-mix(in srgb, currentColor 10%, transparent)', borderRadius: '6px', padding: '8px 10px' },
                }, message.preview),
              ]),
              message.callId !== null && props.inspectCall !== undefined
                ? h('div', { key: 'linked', style: { marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' } }, [
                    h('span', { key: 'label', style: { opacity: 0.6 } }, '关联调用'),
                    h('span', { key: 'tool', style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } },
                      message.callTool !== null ? `${message.callTool}（${message.callId}）` : message.callId),
                    h('button', {
                      key: 'locate',
                      type: 'button',
                      style: linkButtonStyle,
                      onClick: () => props.inspectCall?.(message.callId ?? ''),
                    }, '在 Trajectory 定位'),
                  ])
                : null,
            ])),
          ];
        })),
      ]),
  ]);
}

/** Token-weighted message composition by role (for the pie chart). */
function roleSegmentsOf(messages: Message[]): Segment[] {
  const colors: Record<string, string> = {
    user: '#4285f4',
    assistant: '#30a46c',
    'tool-result': '#e67e22',
    system: '#9b59b6',
    developer: '#16a3b6',
  };
  const totals = new Map<string, number>();
  for (const message of messages) totals.set(message.kind, (totals.get(message.kind) ?? 0) + message.tokens);
  return [...totals.entries()].map(([kind, tokens]) => ({
    key: kind,
    label: MESSAGE_KIND_LABELS[kind] ?? kind,
    tokens,
    color: colors[kind] ?? '#8a8a8a',
  }));
}

/** Token-weighted message composition by component (text / tool-call / file-image). */
function componentSegmentsOf(messages: Message[]): Segment[] {
  let text = 0, toolCall = 0, file = 0;
  for (const message of messages) {
    text += message.textTokens;
    toolCall += message.toolCallTokens;
    file += message.fileTokens;
  }
  return [
    { key: 'text', label: '文本', tokens: text, color: '#4285f4' },
    { key: 'tool-call', label: '工具调用', tokens: toolCall, color: '#e67e22' },
    { key: 'file', label: '文件/图片', tokens: file, color: '#30a46c' },
  ].filter((segment) => segment.tokens > 0);
}

function pieBlock(title: string, segments: Segment[], total: number): unknown {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 250px', minWidth: '250px' } }, [
    h('div', { key: 't', style: { fontSize: '11px', fontWeight: 600, opacity: 0.7 } }, title),
    h('div', { key: 'row', style: { display: 'flex', gap: '10px', alignItems: 'center' } }, [
      h(PieChart, { key: 'pie', segments, total, size: 104 }),
      h('div', { key: 'legend', style: { display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '10.5px' } },
        segments.filter((segment) => segment.tokens > 0).map((segment) => h('div', {
          key: segment.key,
          style: { display: 'flex', alignItems: 'center', gap: '5px' },
        }, [
          h('span', { key: 'dot', style: { width: '8px', height: '8px', borderRadius: '2px', background: segment.color, flexShrink: 0 } }),
          h('span', { key: 'label', style: { opacity: 0.85 } }, segment.label),
          h('span', { key: 'pct', style: { fontVariantNumeric: 'tabular-nums', fontWeight: 600 } }, `${total > 0 ? ((segment.tokens / total) * 100).toFixed(1) : 0}%`),
          h('span', { key: 'tokens', style: { opacity: 0.55, fontVariantNumeric: 'tabular-nums' } }, formatTokens(segment.tokens)),
        ]))),
    ]),
  ]);
}

/** Cause summary panel: attributes Top-3 / spike / drop rows to a mechanism so
 * the reader knows WHY the row is flagged, not just that it is. */
function renderCausePanel(args: {
  data: DashboardData;
  topRows: Message[];
  spikeRows: Message[];
  dropRows: Message[];
  drops: Map<number, DropInfo>;
  spikes: Map<number, SpikeInfo>;
  showCauses: boolean;
  setShowCauses: (value: boolean) => void;
  showAllSpikes: boolean;
  setShowAllSpikes: (value: boolean) => void;
  locate: (seq: number) => void;
  onOpenCompaction?: (() => void) | undefined;
}): unknown {
  const {
    data, topRows, spikeRows, dropRows, drops, spikes,
    showCauses, setShowCauses, showAllSpikes, setShowAllSpikes, locate, onOpenCompaction,
  } = args;
  const header = h('div', {
    key: 'causes-header',
    style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  }, [
    h('span', { key: 'icon' }, '🔍'),
    h('span', { key: 'title', style: { fontSize: '12.5px', fontWeight: 600 } }, '原因总结'),
    h('span', { key: 'hint', style: { fontSize: '11px', opacity: 0.55 } },
      'Top 3 / 突增 / 突降 的归因 · 点击 #序号 定位到行'),
    h('button', {
      key: 'toggle',
      type: 'button',
      style: { ...linkButtonStyle, marginLeft: 'auto' },
      onClick: () => setShowCauses(!showCauses),
    }, showCauses ? '收起' : '展开'),
  ]);
  if (!showCauses) {
    return h('div', { key: 'causes', style: panelStyle }, [header]);
  }

  const ledgerTotal = data.messages.reduce((sum, message) => sum + message.tokens, 0);
  const topSum = topRows.reduce((sum, message) => sum + message.tokens, 0);
  const spikeSum = spikeRows.reduce((sum, message) => sum + message.tokens, 0);
  const dropSum = dropRows.reduce((sum, message) => sum + (drops.get(message.seq)?.drop ?? 0), 0);
  const pct = (value: number): string => (ledgerTotal > 0 ? ((value / ledgerTotal) * 100).toFixed(1) : '0.0');

  /* One-line overview so the whole picture reads before any list. */
  const overview = h('div', {
    key: 'overview',
    style: { display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: '11.5px', lineHeight: 1.6 },
  }, [
    h('span', { key: 'top' }, [
      h('span', { key: 'icon', style: { color: 'var(--dsh-eval-red, #d64545)' } }, '👑 '),
      `Top 3 合计 ${formatTokens(topSum)} Token（占已记录消息 ${pct(topSum)}%）`,
    ]),
    h('span', { key: 'spike' }, [
      h('span', { key: 'icon', style: { color: 'var(--dsh-eval-yellow, #b98900)' } }, '⚡ '),
      `共 ${spikeRows.length} 条突增，累计 +${formatTokens(spikeSum)} Token（占 ${pct(spikeSum)}%）`,
    ]),
    h('span', { key: 'drop' }, [
      h('span', { key: 'icon', style: { color: 'var(--dsh-eval-green, #2f9e44)' } }, '🔻 '),
      dropRows.length > 0
        ? `${dropRows.length} 条突降，回收 ${formatTokens(dropSum)} Token`
        : '无突降',
    ]),
  ]);

  const charts = h('div', {
    key: 'charts',
    style: { display: 'flex', flexWrap: 'wrap', gap: '14px', padding: '2px 0 4px' },
  }, [
    pieBlock('消息构成 · 按角色（Token 占比）', roleSegmentsOf(data.messages), ledgerTotal),
    pieBlock('消息构成 · 按成分（Token 占比）', componentSegmentsOf(data.messages), ledgerTotal),
  ]);

  const cards: unknown[] = [];
  if (topRows.length > 0) {
    cards.push(h('div', { key: 'card-top', style: { ...cardStyle, ...CARD_TONES.top } }, [
      h('div', { key: 'head', style: cardHeadStyle }, [
        h('span', { key: 'title', style: { color: 'var(--dsh-eval-red, #d64545)' } }, '👑 Top 3 Token 消耗'),
        h('span', { key: 'sum', style: { opacity: 0.65, fontWeight: 400 } }, `合计 ${formatTokens(topSum)} · 占 ${pct(topSum)}%`),
      ]),
      ...topRows.map((message) => tagRow({ message, badge: '👑', locate, chips: mechanismChips(message), extra: null })),
    ]));
  }

  if (spikeRows.length > 0) {
    /* Collapsed: the 5 heaviest by tokens. Expanded: every row, grouped by turn. */
    const visible = showAllSpikes
      ? spikeRows
      : spikeRows.slice().sort((a, b) => b.tokens - a.tokens).slice(0, 5);
    const rows = showAllSpikes
      ? groupByTurn(spikeRows).flatMap(([turn, group]) => [
        h('div', { key: `turn-${turn}`, style: { fontSize: '10.5px', fontWeight: 600, opacity: 0.55, marginTop: '3px' } },
          `${turn === null ? '轮次未知' : `第 ${turn} 轮`} · ${group.length} 条`),
        ...group.map((message) => tagRow({ message, badge: '⚡', locate, chips: spikeChips(message, spikes.get(message.seq)!), extra: null })),
      ])
      : visible.map((message) => tagRow({ message, badge: '⚡', locate, chips: spikeChips(message, spikes.get(message.seq)!), extra: null }));
    cards.push(h('div', { key: 'card-spike', style: { ...cardStyle, ...CARD_TONES.spike } }, [
      h('div', { key: 'head', style: cardHeadStyle }, [
        h('span', { key: 'title', style: { color: 'var(--dsh-eval-yellow, #b98900)' } }, `⚡ 突增 ${spikeRows.length} 条`),
        h('span', { key: 'sum', style: { opacity: 0.65, fontWeight: 400 } }, `累计 +${formatTokens(spikeSum)} · ${summarizeRows(spikeRows)}`),
      ]),
      ...rows,
      !showAllSpikes && spikeRows.length > 5
        ? h('span', { key: 'hint', style: { fontSize: '10.5px', opacity: 0.5 } }, '已按 Token 降序取前 5 条')
        : null,
      spikeRows.length > 5
        ? h('button', {
          key: 'expand',
          type: 'button',
          style: { ...linkButtonStyle, alignSelf: 'flex-start', padding: '2px 0', fontSize: '11px' },
          onClick: () => setShowAllSpikes(!showAllSpikes),
        }, showAllSpikes ? '▴ 收起（只看前 5 条）' : `▾ 展开全部 ${spikeRows.length} 条（按轮次分组）`)
        : null,
    ]));
  }

  if (dropRows.length > 0) {
    cards.push(h('div', { key: 'card-drop', style: { ...cardStyle, ...CARD_TONES.drop } }, [
      h('div', { key: 'head', style: cardHeadStyle }, [
        h('span', { key: 'title', style: { color: 'var(--dsh-eval-green, #2f9e44)' } }, `🔻 突降 ${dropRows.length} 条`),
        h('span', { key: 'sum', style: { opacity: 0.65, fontWeight: 400 } }, `窗口内累计回收 ${formatTokens(dropSum)} Token`),
      ]),
      ...dropRows.map((message) => {
        const drop = drops.get(message.seq)!;
        return tagRow({
          message,
          badge: '🔻',
          locate,
          chips: dropChips(drop, message.seq, data.timeline?.compactions ?? []),
          extra: onOpenCompaction !== undefined
            ? h('button', { key: 'open', type: 'button', style: actionButtonStyle, onClick: onOpenCompaction }, '查看压缩事件 →')
            : null,
        });
      }),
    ]));
  }

  if (cards.length === 0) {
    cards.push(h('div', { key: 'none', style: { fontSize: '11.5px', opacity: 0.6 } }, '当前台账无 Top3 / 突增 / 突降 条目，无需归因。'));
  }
  return h('div', { key: 'causes', style: panelStyle }, [
    header,
    overview,
    charts,
    ...cards,
    h('div', { key: 'footnote', style: { fontSize: '10.5px', opacity: 0.5, marginTop: '2px' } },
      '归因基于 Token 构成与事件关联推导（工具结果体积 / 工具调用参数 / 文本长度 / 压缩事件），非模型自述；🔻 直接对应压缩事件，可信度最高。'),
  ]);
}

/** Compact tag chips for a heavy message: mechanism + dominant component. */
function mechanismChips(message: Message): Array<[string, string | null]> {
  const dominant = dominantOf(message);
  return [
    [mechanismLabel(message), null],
    [`${dominant.label} ${dominant.share.toFixed(0)}%`, null],
  ];
}

/** Chips for a spike row: mechanism + component + the spike ratio. */
function spikeChips(message: Message, spike: SpikeInfo): Array<[string, string | null]> {
  return [...mechanismChips(message), [`${spike.ratio.toFixed(0)}×`, spikeLabel(spike, message.tokens)]];
}

/** Short mechanism tag (long prose lives in the expanded message row). */
export function mechanismLabel(message: Message): string {
  if (message.kind === 'tool-result') return `工具输出 ${message.toolName ?? '未知工具'}`;
  if (message.kind === 'assistant') {
    return message.toolCallTokens >= message.textTokens && message.toolCallTokens > 0
      ? `大参数调用 ${message.callTool ?? '未知工具'}`
      : '长文本推理';
  }
  if (message.kind === 'user') return message.sourceKind === 'user' ? '用户长输入' : `注入 ${message.sourceKind}`;
  return message.kind === 'system' ? '系统提示' : '开发者提示';
}

/** Tag chips for a cumulative drop: matched compaction event + magnitude. */
function dropChips(
  drop: DropInfo,
  curSeq: number,
  compactions: NonNullable<DashboardData['timeline']>['compactions'],
): Array<[string, string | null]> {
  const hits = compactions.filter((row) => row.seq > drop.prevSeq && row.seq <= curSeq);
  const chips: Array<[string, string | null]> = [];
  if (hits.length === 0) {
    chips.push(['未匹配压缩事件', '窗口内无对应压缩/修剪事件']);
  } else {
    for (const row of hits) {
      const kind = row.kind === 'summary' ? '摘要压缩' : '历史修剪';
      const turn = row.kind === 'summary' && row.turn !== null ? `第 ${row.turn} 轮` : null;
      chips.push([`${kind}${turn === null ? '' : ` ${turn}`}`, row.reclaimedTokens === null ? '回收未回填' : `回收 ${formatTokens(row.reclaimedTokens)}`]);
    }
  }
  chips.push([`−${drop.pct.toFixed(1)}%`, `台账 ${formatTokens(drop.prev)} → ${formatTokens(drop.next)}（回收 ${formatTokens(drop.drop)}）`]);
  return chips;
}

function groupByTurn(rows: Message[]): Array<[number | null, Message[]]> {
  const groups = new Map<number | null, Message[]>();
  for (const message of rows) {
    const list = groups.get(message.turn);
    if (list === undefined) groups.set(message.turn, [message]);
    else list.push(message);
  }
  return [...groups.entries()].sort((a, b) => (a[0] ?? -1) - (b[0] ?? -1));
}

function tagRow(args: {
  message: Message;
  badge: string;
  locate: (seq: number) => void;
  chips: Array<[string, string | null]>;
  extra: unknown;
}): unknown {
  const { message, badge, locate, chips, extra } = args;
  const turnHint = message.turn === null ? '' : ` 第 ${message.turn} 轮`;
  return h('div', {
    key: `tag-${message.seq}`,
    title: `${MESSAGE_KIND_LABELS[message.kind] ?? message.kind} · ${formatFull(message.tokens)} Token${turnHint} · 点击定位到消息行`,
    onClick: () => locate(message.seq),
    style: {
      display: 'flex', alignItems: 'baseline', gap: '6px', fontSize: '11.5px', lineHeight: 1.7,
      flexWrap: 'wrap', cursor: 'pointer', borderRadius: '6px', padding: '0 3px',
    },
  }, [
    h('span', { key: 'badge', style: { flexShrink: 0 } }, badge),
    h('button', {
      key: 'seq',
      type: 'button',
      title: '定位到下方行并展开详情',
      style: {
        ...linkButtonStyle, padding: '0 2px', fontVariantNumeric: 'tabular-nums',
        textDecoration: 'underline', textUnderlineOffset: '2px', fontWeight: 600,
      },
      onClick: (event: { stopPropagation?: () => void }) => {
        event.stopPropagation?.();
        locate(message.seq);
      },
    }, `#${message.seq}`),
    h('span', { key: 'tokens', style: { fontVariantNumeric: 'tabular-nums', flexShrink: 0, fontWeight: 500 } }, formatTokens(message.tokens)),
    ...chips.map(([label, title], index) => h('span', {
      key: `chip-${index}`,
      title: title ?? undefined,
      style: chipStyle,
    }, label)),
    extra ?? null,
  ]);
}

/** Group aggregate: kind mix + dominant-component mix. */
function summarizeRows(rows: Message[]): string {
  const byKind = new Map<string, number>();
  for (const message of rows) {
    const kind = SHORT_KIND_LABELS[message.kind] ?? message.kind;
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  return [...byKind.entries()]
    .sort((a, b) => b[1] - a[1]).map(([label, count]) => `${label} ${count}`).join(' · ');
}

function spikeLabel(spike: SpikeInfo, tokens: number): string {
  return `Token 突增：前 5 条中位数 ${formatTokens(spike.median)} → 本条 ${formatTokens(tokens)}（${spike.ratio.toFixed(0)}×）`;
}

/** Token 分布 mini bar: text / tool-call / file-image (PRD §3.3). */
function tokenSplitBar(message: Message): unknown {
  const total = message.textTokens + message.toolCallTokens + message.fileTokens;
  if (total <= 0) return null;
  const parts = ([
    ['文本', message.textTokens, '#4285f4'],
    ['工具调用', message.toolCallTokens, '#e67e22'],
    ['文件/图片', message.fileTokens, '#30a46c'],
  ] as Array<[string, number, string]>).filter((entry) => entry[1] > 0);
  return h('div', { key: 'split', style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } }, [
    h('span', { key: 'label', style: { opacity: 0.6 } }, 'Token 分布'),
    h('div', { key: 'bar', style: { display: 'flex', width: '220px', height: '8px', borderRadius: '4px', overflow: 'hidden' } },
      parts.map(([label, tokens, color]) => h('div', {
        key: label,
        title: `${label} ${formatFull(tokens)}`,
        style: { width: `${(tokens / total) * 100}%`, background: color },
      }))),
    h('span', { key: 'legend', style: { fontSize: '11px', opacity: 0.75 } },
      parts.map(([label, tokens]) => `${label} ${formatFull(tokens)}`).join(' · ')),
  ]);
}

function sourceLabel(message: Message): string {
  if (message.kind === 'user') return message.sourceKind === 'user' ? '直接输入' : `注入（${message.sourceKind}）`;
  if (message.kind === 'assistant') return '模型输出';
  return message.sourceKind;
}

function toggleSort(
  key: SortKey,
  setSort: (value: SortKey) => void,
  setDescending: (updater: (value: boolean) => boolean) => void,
): void {
  setSort(key);
  setDescending((value) => !value);
}

function th(key: string, label: string, sortKey?: SortKey): unknown {
  return h('th', { key, style: thStyle }, label);
}

function sortableTh(key: string, label: string, sortKey: SortKey, sort: SortKey, descending: boolean, onClick: () => void): unknown {
  return h('th', {
    key,
    style: { ...thStyle, cursor: 'pointer', textAlign: key === 'time' ? 'left' : 'right' },
    onClick,
  }, `${label}${sort === sortKey ? (descending ? ' ↓' : ' ↑') : ''}`);
}

const panelStyle = {
  display: 'flex', flexDirection: 'column', gap: '6px',
  border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
  borderRadius: '8px', padding: '10px 12px',
  background: 'color-mix(in srgb, currentColor 4%, transparent)',
} as const;

const cardStyle = {
  display: 'flex', flexDirection: 'column', gap: '2px',
  border: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
  borderRadius: '9px', padding: '8px 11px',
} as const;

const CARD_TONES = {
  top: {
    background: 'color-mix(in srgb, #d64545 6%, transparent)',
    borderColor: 'color-mix(in srgb, #d64545 22%, transparent)',
  },
  spike: {
    background: 'color-mix(in srgb, #e6a700 8%, transparent)',
    borderColor: 'color-mix(in srgb, #e6a700 26%, transparent)',
  },
  drop: {
    background: 'color-mix(in srgb, #2f9e44 8%, transparent)',
    borderColor: 'color-mix(in srgb, #2f9e44 26%, transparent)',
  },
} as const;

const cardHeadStyle = {
  display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap',
  fontSize: '11.5px', fontWeight: 600,
} as const;

const actionButtonStyle = {
  display: 'inline-flex', alignItems: 'center', padding: '1px 9px',
  borderRadius: '6px', fontSize: '11px', lineHeight: '18px', fontWeight: 500,
  cursor: 'pointer', color: 'inherit', font: 'inherit',
  border: '1px solid color-mix(in srgb, #2f9e44 45%, transparent)',
  background: 'color-mix(in srgb, #2f9e44 12%, transparent)',
  alignSelf: 'flex-start',
} as const;

const chipStyle = {
  display: 'inline-flex', alignItems: 'center', padding: '0 6px',
  borderRadius: '999px', fontSize: '10.5px', lineHeight: '17px',
  border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
  background: 'color-mix(in srgb, currentColor 5%, transparent)',
  whiteSpace: 'nowrap',
} as const;

const groupHeadStyle = {
  display: 'flex', alignItems: 'baseline', gap: '10px',
  fontSize: '11.5px', fontWeight: 600,
} as const;

const thStyle = {
  textAlign: 'left', padding: '5px 8px', opacity: 0.6, fontWeight: 600,
  borderBottom: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
  whiteSpace: 'nowrap', userSelect: 'none',
} as const;

const tdStyle = {
  padding: '5px 8px', borderBottom: '1px solid color-mix(in srgb, currentColor 10%, transparent)',
  verticalAlign: 'top',
} as const;

const inputStyle = {
  width: '64px', padding: '2px 6px', font: 'inherit', fontSize: '11.5px',
  border: '1px solid color-mix(in srgb, currentColor 22%, transparent)', borderRadius: '4px',
  background: 'transparent', color: 'inherit',
} as const;

const linkButtonStyle = {
  background: 'none', border: 'none', padding: '2px 6px', cursor: 'pointer',
  fontSize: '12px', color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px', opacity: 0.75,
} as const;

const emptyStyle = {
  textAlign: 'center', padding: '48px 20px', opacity: 0.55, fontSize: '13px',
} as const;
