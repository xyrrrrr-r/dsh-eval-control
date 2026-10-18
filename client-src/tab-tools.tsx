/**
 * Tool distribution tab (PRD §3.6): call counts with error overlay, from the
 * contextTimeline projection's bounded top-20 tool table.
 */
import { useState } from './react-binding.js';
import { h } from './react-binding.js';
import { formatFull } from './format.js';
import { BarChart, ChartViewport } from './charts.js';
import type { DashboardData } from './derive.js';

export function ToolsTab(props: { data: DashboardData }): unknown {
  const { data } = props;
  const [showOk, setShowOk] = useState(true);
  const [showErrors, setShowErrors] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const tools = data.timeline?.tools ?? [];
  const totalCalls = tools.reduce((sum, tool) => sum + tool.calls, 0);
  const totalErrors = tools.reduce((sum, tool) => sum + tool.errors, 0);
  const selectedTool = tools.find((tool) => tool.name === selected) ?? null;

  if (tools.length === 0) {
    return h('div', { style: emptyStyle }, '暂无工具调用记录。开始使用工具后此处展示调用分布与错误情况。');
  }
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, [
    h('div', {
      key: 'stats',
      style: { display: 'flex', flexWrap: 'wrap', gap: '8px 24px', fontSize: '12.5px', alignItems: 'baseline' },
    }, [
      h('span', { key: 'title', style: { fontSize: '13px', fontWeight: 500 } }, '工具调用分布'),
      h('span', { key: 'calls' }, `调用 ${formatFull(totalCalls)} 次`),
      h('span', { key: 'errors' }, `错误 ${formatFull(totalErrors)} 次${totalCalls > 0 ? `（${((totalErrors / totalCalls) * 100).toFixed(1)}%）` : ''}`),
      h('span', { key: 'count' }, `工具 ${tools.length} 个`),
    ]),
    h(ChartViewport, { key: 'chart' }, h(BarChart, {
      bars: tools.map((tool) => ({
        label: tool.name,
        value: showOk ? tool.calls - tool.errors : 0,
        secondary: showErrors ? tool.errors : 0,
        title: `${tool.name}：调用 ${tool.calls} 次，错误 ${tool.errors} 次`,
      })),
      height: 220,
      formatValue: (value: number) => String(Math.round(value)),
      formatSecondary: (value: number) => String(Math.round(value)),
      selected,
      onSelect: (label: string) => setSelected(selected === label ? null : label),
    })),
    h('div', { key: 'legend', style: { display: 'flex', gap: '16px', fontSize: '11px', opacity: 0.7 } }, [
      h('button', { key: 'ok', 'aria-pressed': showOk, onClick: () => setShowOk((value) => !value) }, '■ 成功调用'),
      h('button', { key: 'err', 'aria-pressed': showErrors, onClick: () => setShowErrors((value) => !value) }, '■ 错误（叠加）'),
      h('span', { key: 'hint' }, '点击柱子查看明细'),
    ]),
    selectedTool !== null ? h('div', {
      key: 'detail',
      style: {
        border: '1px solid color-mix(in srgb, currentColor 16%, transparent)', borderRadius: '10px',
        padding: '10px 14px', fontSize: '12px', display: 'flex', flexWrap: 'wrap', gap: '6px 22px',
      },
    }, [
      h('span', { key: 'name', style: { fontWeight: 600 } }, selectedTool.name),
      h('span', { key: 'calls' }, `调用 ${selectedTool.calls} 次`),
      h('span', { key: 'errors' }, `错误 ${selectedTool.errors} 次`),
      h('span', { key: 'share' }, `占总调用 ${totalCalls > 0 ? ((selectedTool.calls / totalCalls) * 100).toFixed(1) : '0.0'}%`),
      selectedTool.errors > 0
        ? h('span', { key: 'warn', style: { color: 'var(--dsh-eval-red, #e5484d)' } }, `错误率 ${((selectedTool.errors / selectedTool.calls) * 100).toFixed(1)}%`)
        : null,
    ]) : null,
  ]);
}

const emptyStyle = {
  textAlign: 'center', padding: '48px 20px', opacity: 0.55, fontSize: '13px',
} as const;
