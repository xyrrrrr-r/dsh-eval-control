/**
 * Team activity tab (ported from the shipped client half): per-member busy
 * timeline bars, concurrency facts, branch first-activity latencies, and the
 * wire-cap caveats the aggregate honestly reports.
 */
import { h, useState } from './react-binding.js';
import { BarChart, ChartViewport } from './charts.js';
import { formatMs, formatTokens } from './format.js';
import type { DashboardData } from './derive.js';
import type { MemberEntry, TeamAggregate } from './team.js';

export function TeamTab(props: {
  data: DashboardData;
  teamState: { phase: string; members: MemberEntry[] };
  team: TeamAggregate | null;
}): unknown {
  const { data, teamState, team } = props;
  const [hiddenMembers, setHiddenMembers] = useState<string[]>([]);
  const memberIds = data.analytics?.teamInput?.memberIds ?? [];
  if (memberIds.length === 0) {
    return h('div', { style: emptyStyle }, '本会话没有 Team 成员活动。');
  }
  const asOf = team?.asOf ?? null;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, [
    h('div', {
      key: 'facts',
      style: { display: 'flex', flexWrap: 'wrap', gap: '8px 24px', fontSize: '12.5px', alignItems: 'baseline' },
    }, [
      h('span', { key: 'title', style: { fontSize: '13px', fontWeight: 500 } }, 'Team 活动'),
      h('span', { key: 'members' }, `成员 ${memberIds.length} 名`),
      team !== null ? h('span', { key: 'active' }, `当前活跃 ${team.activeNow}`) : null,
      team !== null ? h('span', { key: 'peak' }, `并发峰值 ${team.peak}`) : null,
      team !== null && team.wallMs !== null ? h('span', { key: 'wall' }, `完成墙钟 ${formatMs(team.wallMs)}`) : null,
      teamState.phase === 'loading' ? h('span', { key: 'loading', style: { opacity: 0.6 } }, '成员会话读取中…') : null,
      teamState.phase === 'unavailable' ? h('span', { key: 'unavail', style: { opacity: 0.6 } }, '成员会话暂不可读（sessions 服务不可用）') : null,
      teamState.phase === 'none' ? h('span', { key: 'none', style: { opacity: 0.6 } }, '无成员输入') : null,
    ]),

    team !== null ? h('div', { key: 'activity-chart' }, [
      h(ChartViewport, {}, h(BarChart, { bars: memberIds.filter((id) => !hiddenMembers.includes(id)).map((id) => ({ label: id, value: team.busyMs[id] ?? 0, title: `${id} · 忙碌 ${formatMs(team.busyMs[id] ?? 0)} · ${team.openFlags[id] ? '进行中' : '空闲'}` })), height: 220, formatValue: formatMs })),
      h('div', { key: 'legend', style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, memberIds.map((id) => h('button', { key: id, 'aria-pressed': !hiddenMembers.includes(id), onClick: () => setHiddenMembers((current) => current.includes(id) ? current.filter((member) => member !== id) : [...current, id]) }, id))),
    ]) : null,
    team !== null ? h('div', {
      key: 'members',
      style: { display: 'flex', flexDirection: 'column', gap: '6px' },
    }, memberIds.map((memberId) => {
      const busy = team.busyMs[memberId] ?? 0;
      const maxBusy = Math.max(1, ...memberIds.map((id) => team.busyMs[id] ?? 0));
      const open = team.openFlags[memberId] ?? false;
      const entry = teamState.members.find((item) => item.memberId === memberId);
      const summary = entry?.summary ?? null;
      const inputTokens = summary && typeof summary === 'object' && 'inputTokens' in summary
        ? Number((summary as { inputTokens?: unknown }).inputTokens ?? 0)
        : null;
      return h('div', {
        key: memberId,
        style: {
          display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px',
          padding: '6px 8px', borderRadius: '8px',
          border: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
        },
      }, [
        h('span', { key: 'id', style: { fontFamily: 'ui-monospace, monospace', fontSize: '11px', opacity: 0.8, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, memberId),
        h('div', {
          key: 'bar',
          style: {
            flex: 1, height: '10px', borderRadius: '5px',
            background: 'color-mix(in srgb, currentColor 8%, transparent)', overflow: 'hidden',
          },
          title: `忙碌 ${formatMs(busy)}`,
        }, h('div', {
          key: 'fill',
          style: {
            width: `${(busy / maxBusy) * 100}%`, height: '100%',
            background: open ? 'var(--dsh-eval-yellow, #e6a700)' : 'var(--dsh-eval-blue, #4285f4)',
            opacity: 0.8, borderRadius: '5px',
          },
        })),
        h('span', { key: 'busy', style: { minWidth: '64px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, formatMs(busy)),
        h('span', {
          key: 'state',
          style: { minWidth: '36px', textAlign: 'center', fontSize: '11px', opacity: open ? 1 : 0.5 },
        }, open ? '进行中' : '空闲'),
        inputTokens !== null ? h('span', { key: 'tokens', style: { minWidth: '56px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.7 } }, formatTokens(inputTokens)) : null,
      ]);
    })) : null,

    /* Branch first activity */
    team !== null && team.branchFirst.length > 0 ? h('div', { key: 'branch' }, [
      h('div', { key: 'title', style: { fontSize: '12.5px', fontWeight: 500, marginBottom: '4px' } }, '分支首活动延迟'),
      h('ul', { key: 'list', style: { listStyle: 'none', margin: 0, padding: 0, fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '2px' } },
        team.branchFirst.map((branch) => h('li', {
          key: branch.childId,
          style: { display: 'flex', gap: '10px', opacity: branch.status !== undefined ? 0.6 : 1 },
        }, [
          h('span', { key: 'id', style: { fontFamily: 'ui-monospace, monospace', fontSize: '11px' } }, branch.childId),
          h('span', { key: 'value' }, branch.latencyMs !== undefined ? formatMs(branch.latencyMs) : (branch.status ?? '—')),
        ]))),
    ]) : null,

    /* Honest caveats */
    team !== null && team.wallCoverage.length > 0 ? h('div', {
      key: 'caveats',
      style: { fontSize: '11px', opacity: 0.55 },
    }, `覆盖提示：${team.wallCoverage.join('、')}${asOf !== null ? ` · 观测截至 ${new Date(asOf).toLocaleTimeString()}` : ''}`) : null,
    h('div', {
      key: 'note',
      style: { fontSize: '11px', opacity: 0.5 },
    }, '成员忙碌时长来自各成员会话的轮次区间合并（wire 上限内），是文档化的近似值，不与宿主精确路径对账。'),
  ]);
}

const emptyStyle = {
  textAlign: 'center', padding: '48px 20px', opacity: 0.55, fontSize: '13px',
} as const;
