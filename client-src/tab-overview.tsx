import { EvidenceButton } from './evidencePanel.js';
import { aggregateEvidence, eventRef, type EvidenceProps } from './evidence.js';
/**
 * Overview tab: occupancy gauge, context composition (stacked bar + pie),
 * smart alert cards, and the compact team summary line (PRD §3.1/§3.2/§3.7).
 */
import { useEffect, useState } from './react-binding.js';
import { h } from './react-binding.js';
import { formatFull, formatPercent, formatTokens, utilizationColor } from './format.js';
import { PieChart, RingGauge, StackedBar } from './charts.js';
import { copyText } from './exporters.js';
import type { Alert, AlertThresholds } from './alerts.js';
import { currentContextOf, type DashboardData } from './derive.js';
import type { MemberEntry, TeamAggregate } from './team.js';

const thStyle: Record<string, string | number> = {
  textAlign: 'left', fontWeight: 500, fontSize: '11.5px', opacity: 0.65,
  padding: '4px 8px', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
};
const tdStyle: Record<string, string | number> = { padding: '7px 8px', verticalAlign: 'top' };
const linkButtonStyle: Record<string, string | number> = {
  background: 'none', border: 'none', padding: '2px 6px', cursor: 'pointer',
  fontSize: '12px', color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px', opacity: 0.75,
};

export function OverviewTab(props: EvidenceProps & {
  data: DashboardData;
  alerts: Alert[];
  thresholds: AlertThresholds;
  dismissed: string[];
  onDismiss: (id: string) => void;
  onResolve: (id: string) => void;
  teamState: { phase: string; members: MemberEntry[] };
  team: TeamAggregate | null;
  onOpenEvolution: () => void;
  inspectCall?: (callId: string) => void;
}): unknown {
  const { data } = props;
  const [selected, setSelected] = useState<string | null>(null);
  /* PRD §3.2 详细列表: sorting + content modal + copy feedback. */
  const [sortKey, setSortKey] = useState<'tokens' | 'type'>('tokens');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [modalKey, setModalKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const utilization = data.utilization;
  const memberCount = data.analytics?.teamInput?.memberIds?.length ?? 0;
  const selectedSegment = data.segments.find((segment) => segment.key === selected) ?? null;

  /* Pie sector click → highlight & scroll the matching table row into view. */
  useEffect(() => {
    if (selected === null || typeof document === 'undefined') return;
    const row = document.getElementById(`dsh-seg-row-${selected}`);
    if (row !== null) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  /* Esc closes the content modal. */
  useEffect(() => {
    if (modalKey === null || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const onKey = (event: { key: string }): void => {
      if (event.key === 'Escape') setModalKey(null);
    };
    window.addEventListener('keydown', onKey as never);
    return () => window.removeEventListener('keydown', onKey as never);
  }, [modalKey]);

  const visibleSegments = data.segments.filter((segment) => segment.tokens > 0);
  const modalSegment = modalKey !== null ? data.segments.find((segment) => segment.key === modalKey) ?? null : null;
  const modalDetail = modalKey !== null ? data.segmentDetail[modalKey] : undefined;
  const sortedSegments = [...visibleSegments].sort((a, b) => {
    const result = sortKey === 'tokens'
      ? a.tokens - b.tokens
      : a.label.localeCompare(b.label, 'zh');
    return sortDir === 'asc' ? result : -result;
  });

  const segmentShare = (tokens: number): string =>
    data.surfaceTotal > 0 ? formatPercent(tokens / data.surfaceTotal) : '—';

  /** Copyable text of one segment: header + bounded per-node excerpts. */
  const segmentText = (key: string): string => {
    const segment = data.segments.find((entry) => entry.key === key);
    if (segment === undefined) return '';
    const detail = data.segmentDetail[key];
    const lines = [`【${segment.label}】约 ${formatTokens(segment.tokens)} Token · 占比 ${segmentShare(segment.tokens)}`];
    if (detail !== undefined) {
      for (const node of detail.nodes) {
        lines.push(`#${node.seq}${node.turn !== null ? `（第 ${node.turn} 轮）` : ''} ${node.label} · ${formatTokens(node.tokens)} Token`);
        lines.push(node.preview);
      }
      if (detail.nodeCount > detail.nodes.length) {
        lines.push(`（节选：仅最近 ${detail.nodes.length} 条，另有 ${detail.nodeCount - detail.nodes.length} 条更早内容未包含）`);
      }
    }
    return lines.join('\n');
  };

  const doCopy = (key: string): void => {
    void copyText(segmentText(key)).then((ok) => {
      setCopiedKey(ok ? key : `${key}!failed`);
      setTimeout(() => setCopiedKey(null), 1600);
    });
  };

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } }, [
    h(EvidenceButton, {...props, chain: () => aggregateEvidence(props.evidenceSessionId ?? 'current', '上下文窗口占用', data.analytics, data.timeline, 'context'), label:'查看窗口占用证据链'}),
    /* Occupancy + composition side by side */
    h('div', {
      key: 'top',
      style: { display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-start' },
    }, [
      h('div', {
        key: 'gauge',
        style: { flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' },
      }, [
        h(RingGauge, {
          ratio: utilization,
          size: 132,
          label: '上下文窗口占用',
          sublabel: data.contextWindow !== null
            ? `${formatTokens(currentContextOf(data.timeline))} / ${formatFull(data.contextWindow)} Token`
            : '窗口大小未知（服务商未上报）',
          pulse: true,
          onClick: props.onOpenEvolution,
          title: '点击查看上下文演化时间线',
        }),
        h('div', { key: 'status', style: { fontSize: '11.5px', opacity: 0.7 } }, [
          h('span', {
            key: 'dot',
            style: {
              display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
              background: utilization !== null ? utilizationColor(utilization) : 'currentColor',
              marginRight: '6px',
            },
          }),
          utilization === null
            ? '暂无占用数据'
            : utilization > 0.8 ? '高占用 — 建议压缩会话'
              : utilization >= 0.6 ? '中等占用 — 关注增长趋势'
                : '低占用',
          data.timeline?.model ? h('span', { key: 'model', style: { marginLeft: '10px', opacity: 0.75 } }, `${data.timeline.provider ?? ''} / ${data.timeline.model}`) : null,
        ]),
      ]),
      h('div', { key: 'composition', style: { flex: '1 1 320px', minWidth: 260 } }, [
        h('div', { key: 'title', style: { fontSize: '13px', fontWeight: 500, marginBottom: '8px' } }, '上下文组成（估算）'),
        h(StackedBar, {
          segments: data.segments,
          total: data.surfaceTotal,
          selected,
          onSelect: setSelected,
        }),
        h('div', {
          key: 'crosscheck',
          style: { marginTop: '8px', fontSize: '11px', opacity: 0.6 },
        }, `合计约 ${formatTokens(data.surfaceTotal)} Token · 与 dsh-token-meter 同一估计算法（CHARS_PER_TOKEN=4），点击分区过滤饼图`),
      ]),
      h('div', {
        key: 'pie',
        style: { flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' },
      }, [
        h(PieChart, {
          segments: selected !== null
            ? data.segments.filter((segment) => segment.key === selected || segment.tokens <= 0)
            : data.segments,
          total: data.surfaceTotal,
          size: 140,
          selected,
          onSelect: setSelected,
        }),
        selectedSegment !== null
          ? h('div', { key: 'focus', style: { fontSize: '11.5px', textAlign: 'center' } }, [
            h('b', { key: 'l' }, selectedSegment.label),
            h('span', { key: 'v', style: { opacity: 0.7 } }, ` ${formatFull(selectedSegment.tokens)} Token`),
          ])
          : h('div', { key: 'hint', style: { fontSize: '11px', opacity: 0.5 } }, '点击查看分区占比 · 扇区可定位下方明细行'),
      ]),
    ]),

    /* PRD §3.2 详细列表: sortable table with 查看内容 modal + per-segment copy. */
    visibleSegments.length > 0 ? h('div', { key: 'segments-table' }, [
      h('div', {
        key: 'title',
        style: { fontSize: '13px', fontWeight: 500, marginBottom: '8px', display: 'flex', alignItems: 'baseline', gap: '10px' },
      }, [
        h('span', { key: 't' }, '组成明细'),
        h('span', { key: 'hint', style: { fontSize: '11px', opacity: 0.5, fontWeight: 400 } }, '点击列头排序 · 每条内容为有界节选（估算）'),
      ]),
      h('table', {
        key: 'table',
        style: { width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' },
      }, [
        h('thead', { key: 'head' }, h('tr', { key: 'r' }, [
          h('th', {
            key: 'type',
            style: thStyle,
            onClick: () => {
              if (sortKey === 'type') setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
              else { setSortKey('type'); setSortDir('asc'); }
            },
          }, `类型 ${sortKey === 'type' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}`),
          h('th', {
            key: 'tokens',
            style: { ...thStyle, textAlign: 'right' },
            onClick: () => {
              if (sortKey === 'tokens') setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
              else { setSortKey('tokens'); setSortDir('desc'); }
            },
          }, `Token（估算） ${sortKey === 'tokens' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}`),
          h('th', { key: 'share', style: { ...thStyle, width: '30%' } }, '占比'),
          h('th', { key: 'ops', style: { ...thStyle, textAlign: 'right' } }, '操作'),
        ])),
        h('tbody', { key: 'body' }, sortedSegments.map((segment) => {
          const detail = data.segmentDetail[segment.key];
          const share = data.surfaceTotal > 0 ? segment.tokens / data.surfaceTotal : 0;
          return h('tr', {
            key: segment.key,
            id: `dsh-seg-row-${segment.key}`,
            style: {
              borderTop: '1px solid color-mix(in srgb, currentColor 10%, transparent)',
              background: selected === segment.key ? 'color-mix(in srgb, currentColor 8%, transparent)' : undefined,
            },
          }, [
            h('td', { key: 'type', style: tdStyle }, [
              h('span', {
                key: 'dot',
                style: { display: 'inline-block', width: '9px', height: '9px', borderRadius: '2px', background: segment.color, marginRight: '7px' },
              }),
              segment.label,
              detail !== undefined && detail.nodeCount > 0
                ? h('span', { key: 'n', style: { opacity: 0.5, marginLeft: '6px', fontSize: '11px' } }, `${detail.nodeCount} 项`)
                : null,
            ]),
            h('td', { key: 'tokens', style: { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, formatTokens(segment.tokens)),
            h('td', { key: 'share', style: tdStyle }, [
              h('div', { key: 'bar', style: { height: '4px', width: `${Math.max(2, Math.round(share * 100))}%`, background: segment.color, borderRadius: '2px', marginBottom: '3px', opacity: 0.75 } }),
              h('span', { key: 'pct', style: { fontSize: '11.5px', opacity: 0.8 } }, segmentShare(segment.tokens)),
            ]),
            h('td', { key: 'ops', style: { ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' } }, [
              h('button', {
                key: 'view',
                type: 'button',
                style: linkButtonStyle,
                onClick: () => setModalKey(segment.key),
              }, '查看内容'),
              h('button', {
                key: 'copy',
                type: 'button',
                style: linkButtonStyle,
                onClick: () => doCopy(segment.key),
              }, copiedKey === segment.key ? '已复制 ✓' : copiedKey === `${segment.key}!failed` ? '复制失败 ✗' : '复制'),
            ]),
          ]);
        })),
      ]),
    ]) : null,

    /* Team summary */
    memberCount > 0 ? h('div', {
      key: 'team',
      style: {
        display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'baseline',
        border: '1px solid color-mix(in srgb, currentColor 14%, transparent)', borderRadius: '10px',
        padding: '10px 14px', fontSize: '12.5px',
      },
    }, [
      h('span', { key: 'title', style: { fontWeight: 600 } }, 'Team 摘要'),
      h('span', { key: 'members' }, `成员 ${memberCount} 名`),
      props.team !== null ? h('span', { key: 'active', style: { opacity: 0.8 } }, `当前活跃 ${props.team.activeNow}`) : null,
      props.team !== null ? h('span', { key: 'peak', style: { opacity: 0.8 } }, `并发峰值 ${props.team.peak}`) : null,
      props.team !== null && props.team.wallMs !== null ? h('span', { key: 'wall', style: { opacity: 0.8 } }, `成员结束跨度 ${Math.round(props.team.wallMs / 1000)}s（含空档）`) : null,
      props.teamState.phase === 'loading' ? h('span', { key: 'load', style: { opacity: 0.55 } }, '（成员数据读取中…）') : null,
      props.teamState.phase === 'unavailable' ? h('span', { key: 'unavail', style: { opacity: 0.55 } }, '（成员会话暂不可读）') : null,
    ]) : null,

    /* Key numbers strip */
    h('div', {
      key: 'numbers',
      style: { display: 'flex', flexWrap: 'wrap', gap: '8px 22px', fontSize: '12px', opacity: 0.85 },
    }, [
      h('span', { key: 'turns' }, `轮次 ${data.analytics?.turnsEnded ?? 0} / 步骤 ${data.analytics?.stepsEnded ?? 0}`),
      h('span', { key: 'tokens' }, `输入 ${formatFull(data.analytics?.inputTokens ?? 0)} · 输出 ${formatFull(data.stats?.decodeTokens ?? 0)} Token`),
      h('span', { key: 'tools' }, `工具调用 ${data.analytics?.toolCalls ?? 0}（错误 ${data.analytics?.toolErrors ?? 0}）`),
      h('span', { key: 'compactions' }, `压缩 ${data.timeline?.compactionTotals?.count ?? 0} 次`),
      h('span', { key: 'messages' }, `消息 ${data.messages.length} 条（估算 ${formatTokens(data.messages.reduce((sum, m) => sum + m.tokens, 0))} Token）`),
      data.utilization !== null ? h('span', { key: 'util' }, `窗口占用 ${formatPercent(data.utilization)}`) : null,
    ]),

    /* PRD §3.2 内容预览模态框: title + scrollable bounded excerpts + copy/close. */
    modalKey !== null && modalSegment !== null ? h('div', {
      key: 'segment-modal',
      style: {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.45)', zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      },
      onClick: (event: { target?: unknown; currentTarget?: unknown }) => {
        if (event !== undefined && event.target !== event.currentTarget) return;
        setModalKey(null);
      },
    }, [
      h('div', {
        key: 'card',
        style: {
          background: 'var(--dsh-bg-elevated, #fff)', color: 'inherit', borderRadius: '12px',
          maxWidth: '680px', width: '100%', maxHeight: '72vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 18px 48px rgba(0,0,0,0.28)',
        },
      }, [
        h('div', {
          key: 'head',
          style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: '1px solid color-mix(in srgb, currentColor 12%, transparent)' },
        }, [
          h('span', { key: 'dot', style: { width: '10px', height: '10px', borderRadius: '2px', background: modalSegment.color, flex: '0 0 auto' } }),
          h('span', { key: 'title', style: { fontWeight: 600, fontSize: '14px' } }, `${modalSegment.label} · ${formatTokens(modalSegment.tokens)} Token`),
          h('span', { key: 'share', style: { opacity: 0.6, fontSize: '12px' } }, `占比 ${segmentShare(modalSegment.tokens)}`),
          h('button', {
            key: 'close-x',
            type: 'button',
            style: { ...linkButtonStyle, marginLeft: 'auto', fontSize: '15px', padding: '2px 8px' },
            onClick: () => setModalKey(null),
          }, '×'),
        ]),
        h('div', {
          key: 'body',
          style: { overflowY: 'auto', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: '10px' },
        }, [
          h('div', { key: 'order-hint', style: { fontSize: '11px', opacity: 0.5, textAlign: 'center' } },
            `按时间顺序（早 → 晚）· 每条为有界节选（估算 Token）${props.inspectCall !== undefined ? ' · 助手消息的「定位」跳到其发出的工具调用行（正文行紧邻其上）' : ''}`),
          ...(modalDetail?.nodes ?? []).map((node) => h('div', {
            key: `node-${node.seq}`,
            style: { border: '1px solid color-mix(in srgb, currentColor 10%, transparent)', borderRadius: '8px', padding: '8px 10px' },
          }, [
            h('div', {
              key: 'meta',
              style: { display: 'flex', gap: '10px', fontSize: '11.5px', opacity: 0.65, marginBottom: '4px', fontVariantNumeric: 'tabular-nums', alignItems: 'baseline' },
            }, [
              h('span', { key: 'seq' }, `#${node.seq}`),
              h(EvidenceButton, {...props, chain: () => ({title:`上下文组成 · #${node.seq}`,conclusion:`${node.label} · ${node.tokens} Token`,level:'derived',rule:'有效表面消息的内容估算。',facts:[],notes:['当前组成不代表全历史消耗。'],refs:[eventRef(props.evidenceSessionId ?? 'current',node.seq,'有效上下文消息')]})}),
              node.turn !== null ? h('span', { key: 'turn' }, `第 ${node.turn} 轮`) : null,
              h('span', { key: 'label' }, node.label),
              h('span', { key: 'tokens', style: { marginLeft: 'auto' } }, `${formatTokens(node.tokens)} Token`),
              node.callId !== null && props.inspectCall !== undefined
                ? h('button', {
                  key: 'locate',
                  type: 'button',
                  style: { ...linkButtonStyle, opacity: 0.85 },
                  onClick: () => {
                    setModalKey(null);
                    props.inspectCall?.(node.callId ?? '');
                  },
                }, node.callTool !== null ? `在 Trajectory 定位 · ${node.callTool}` : '在 Trajectory 定位')
                : null,
            ]),
            h('div', {
              key: 'preview',
              style: { fontSize: '12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: 1.55, wordBreak: 'break-word', whiteSpace: 'pre-wrap' },
            }, node.preview),
          ])),
          modalDetail !== undefined && modalDetail.nodeCount > modalDetail.nodes.length
            ? h('div', { key: 'truncated', style: { fontSize: '11.5px', opacity: 0.55, textAlign: 'center', padding: '4px' } },
              `仅展示最近 ${modalDetail.nodes.length} 条（另有 ${modalDetail.nodeCount - modalDetail.nodes.length} 条更早内容，投影有界输出）`)
            : null,
          (modalDetail?.nodes ?? []).length === 0
            ? h('div', { key: 'empty', style: { fontSize: '12.5px', opacity: 0.6, textAlign: 'center', padding: '18px 0' } }, '该分区暂无可展示的内容节选（如工具定义为空或宿主未上报）。')
            : null,
        ]),
        h('div', {
          key: 'foot',
          style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid color-mix(in srgb, currentColor 12%, transparent)' },
        }, [
          h('button', {
            key: 'copy',
            type: 'button',
            style: linkButtonStyle,
            onClick: () => doCopy(modalKey),
          }, copiedKey === modalKey ? '已复制 ✓' : copiedKey === `${modalKey}!failed` ? '复制失败 ✗（请手动选择文本复制）' : '复制'),
          h('button', {
            key: 'close',
            type: 'button',
            style: linkButtonStyle,
            onClick: () => setModalKey(null),
          }, '关闭'),
        ]),
      ]),
    ]) : null,
  ]);
}
