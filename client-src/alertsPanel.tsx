/** Overview diagnostic alerts, threshold settings and host configuration actions. */
import { useState } from './react-binding.js';
import { h } from './react-binding.js';
import { formatPercent } from './format.js';
import {
  DEFAULT_THRESHOLDS, evaluateAlerts,
  type Alert, type AlertThresholds, type AlertInput,
} from './alerts.js';
import { copyText } from './exporters.js';
import { ConfigurationAction, type ConfigurationRemote } from './configuration.js';

const SEVERITY_META: Record<Alert['severity'], { icon: string; color: string; label: string }> = {
  critical: { icon: '🔴', color: 'var(--dsh-eval-red, #e5484d)', label: '严重' },
  warning: { icon: '🟡', color: 'var(--dsh-eval-yellow, #e6a700)', label: '警告' },
  info: { icon: '🔵', color: 'var(--dsh-eval-blue, #4285f4)', label: '提示' },
};

export function AlertBell(props: {
  alerts: Alert[];
  onOpenTab: () => void;
  thresholdCount: number;
  onOpenSettings: () => void;
}): unknown {
  const [open, setOpen] = useState(false);
  const critical = props.alerts.filter((alert) => alert.severity === 'critical').length;
  const total = props.alerts.length;
  return h('div', { style: { position: 'relative' } }, [
    h('button', {
      type: 'button',
      title: total > 0 ? `${total} 条告警（严重 ${critical}）` : '无告警',
      'aria-label': `智能告警：${total} 条`,
      onClick: () => setOpen((value) => !value),
      className: total > 0 && critical > 0 ? 'dsh-eval-pulse' : undefined,
      style: {
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        background: 'transparent', border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
        borderRadius: '999px', padding: '2px 10px', cursor: 'pointer', font: 'inherit', fontSize: '12px',
        color: total > 0 ? SEVERITY_META[critical > 0 ? 'critical' : 'warning'].color : 'inherit',
      },
    }, [
      h('span', { key: 'icon', 'aria-hidden': true }, '🔔'),
      h('span', { key: 'count' }, total > 0 ? String(total) : '—'),
    ]),
    open ? h('div', {
      key: 'dropdown',
      style: {
        position: 'absolute', top: '100%', right: 0, zIndex: 40, marginTop: '6px',
        minWidth: '260px', maxWidth: '340px',
        background: 'var(--dsh-eval-surface, Canvas)', color: 'var(--dsh-eval-text, CanvasText)',
        border: '1px solid color-mix(in srgb, currentColor 25%, transparent)', borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: '10px 12px', fontSize: '12px', lineHeight: 1.5,
      },
    }, [
      h('div', { key: 'title', style: { fontWeight: 600, marginBottom: '6px' } }, `智能告警（${total}）`),
      total === 0 ? h('div', { key: 'empty', style: { opacity: 0.6 } }, '当前无触发的告警。') : props.alerts.map((alert) => h('div', {
        key: alert.id,
        style: { display: 'flex', gap: '6px', alignItems: 'baseline', padding: '3px 0', borderTop: '1px solid color-mix(in srgb, currentColor 10%, transparent)' },
      }, [
        h('span', { key: 'icon' }, SEVERITY_META[alert.severity]!.icon),
        h('span', { key: 'text' }, alert.rule),
      ])),
      h('div', { key: 'actions', style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
        h('button', {
          key: 'view', type: 'button', onClick: () => { setOpen(false); props.onOpenTab(); },
          style: buttonStyle,
        }, '查看全部'),
        h('button', {
          key: 'settings', type: 'button', onClick: () => { setOpen(false); props.onOpenSettings(); },
          style: buttonStyle,
        }, `阈值设置${props.thresholdCount > 0 ? '' : ''}`),
      ]),
    ]) : null,
  ]);
}

const buttonStyle = {
  background: 'transparent', border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
  borderRadius: '6px', padding: '2px 10px', font: 'inherit', fontSize: '12px', cursor: 'pointer', color: 'inherit',
} as const;

export function AlertCards(props: {
  alerts: Alert[];
  dismissed: string[];
  onDismiss: (id: string) => void;
  onResolve: (id: string) => void;
}): unknown {
  const [copied, setCopied] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const visible = props.alerts.filter((alert) => !props.dismissed.includes(alert.id));
  if (visible.length === 0) {
    return h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px',
        border: '1px solid color-mix(in srgb, currentColor 14%, transparent)', borderRadius: '10px',
        fontSize: '12px', opacity: 0.7,
      },
    }, [h('span', { key: 'i' }, '✓'), h('span', { key: 't' }, '✓ 当前没有未处理告警；已忽略或已处理的记录可在告警面板查看。')]);
  }
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
    visible.map((alert) => {
      const meta = SEVERITY_META[alert.severity]!;
      const open = expanded === alert.id;
      return h('div', {
        key: alert.id,
        style: {
          border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
          borderLeft: `3px solid ${meta.color}`,
          borderRadius: '8px', padding: '9px 12px', fontSize: '12px', lineHeight: 1.55,
        },
      }, [
        h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          h('span', { key: 'icon' }, meta.icon),
          h('span', { key: 'rule', style: { fontWeight: 600 } }, alert.rule),
          h('span', { key: 'sev', style: { color: meta.color, fontSize: '11px' } }, meta.label),
          h('span', { key: 'spacer', style: { marginLeft: 'auto' } }),
          h('button', {
            key: 'detail', type: 'button', onClick: () => setExpanded(open ? null : alert.id), style: linkButtonStyle,
          }, open ? '收起' : '详情'),
          h('button', {
            key: 'dismiss', type: 'button', title: '本次会话不再提示', onClick: () => props.onDismiss(alert.id), style: linkButtonStyle,
          }, '忽略'),
          h('button', {
            key: 'resolve', type: 'button', title: '标记为已处理', onClick: () => props.onResolve(alert.id), style: linkButtonStyle,
          }, '已处理'),
        ]),
        h('div', { key: 'detailText', style: { marginTop: '4px', opacity: 0.85 } }, alert.detail),
        open ? h('div', { key: 'more', style: { marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' } }, [
          h('div', {
            key: 'sug',
            style: { background: 'color-mix(in srgb, currentColor 6%, transparent)', borderRadius: '6px', padding: '6px 10px' },
          }, [
            h('div', { key: 'l', style: { fontWeight: 600, marginBottom: '2px' } }, '建议'),
            h('div', { key: 'v' }, alert.suggestion),
          ]),
          alert.configHint !== null ? h('div', { key: 'config' }, [
            h('div', { key: 'l', style: { marginBottom: '2px' } }, '参考配置（复制后手动应用）：'),
            h('pre', {
              key: 'pre',
              style: { margin: 0, whiteSpace: 'pre-wrap', font: 'inherit', fontSize: '11px', background: 'color-mix(in srgb, currentColor 6%, transparent)', borderRadius: '6px', padding: '6px 10px' },
            }, alert.configHint),
            h('button', {
              key: 'copy', type: 'button', style: { ...linkButtonStyle, marginTop: '4px' },
              onClick: () => { void copyText(alert.configHint ?? '').then(() => setCopied(alert.id)); },
            }, copied === alert.id ? '已复制 ✓' : '复制配置'),
          ]) : null,
        ]) : null,
      ]);
    }));
}

const linkButtonStyle = {
  background: 'transparent', border: 'none', padding: 0, font: 'inherit', fontSize: '11px',
  cursor: 'pointer', color: 'inherit', opacity: 0.7, textDecoration: 'underline',
} as const;

interface ThresholdField {
  key: Exclude<keyof AlertThresholds, 'disabledRules'>;
  label: string;
  help: string;
  format: (value: number) => string;
}

const THRESHOLD_FIELDS: ThresholdField[] = [
  { key: 'contextOverloadRatio', label: '窗口占用阈值', help: '超过即触发「上下文满载」严重告警', format: (v) => formatPercent(v, 0) },
  { key: 'compactionFrequencyPer1k', label: '压缩频率阈值', help: '次 / 千输入 Token，超过即触发「频繁压缩」警告', format: (v) => String(v) },
  { key: 'toolErrorRate', label: '工具错误率阈值', help: '超过即触发「高错误率」严重告警', format: (v) => formatPercent(v, 0) },
  { key: 'repeatCallGroups', label: '重复调用组数阈值', help: '达到即触发「Token 浪费」提示', format: (v) => String(v) },
  { key: 'longGapSegments', label: '长间隔段数阈值', help: '超过即触发「长间隔」提示', format: (v) => String(v) },
];

export function ThresholdSettings(props: {
  thresholds: AlertThresholds;
  onChange: (next: AlertThresholds) => void;
  onClose: () => void;
}): unknown {
  return h('div', {
    style: {
      border: '1px solid color-mix(in srgb, currentColor 20%, transparent)', borderRadius: '10px',
      padding: '12px 14px', fontSize: '12px', lineHeight: 1.5,
      background: 'var(--dsh-eval-surface, Canvas)',
    },
  }, [
    h('div', { key: 'title', style: { fontWeight: 600, marginBottom: '4px' } }, '告警阈值设置'),
    h('div', { key: 'sub', style: { opacity: 0.6, marginBottom: '8px' } }, '阈值保存在本地浏览器（localStorage），即时生效。'),
    h('fieldset', { key: 'rules', style: { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10 } }, [h('legend', { key: 'legend' }, '启用告警类型'), ...['context-overload:上下文满载','frequent-compaction:频繁压缩','high-error-rate:高错误率','token-waste:Token 浪费','long-gaps:长间隔'].map((entry) => { const [id, label] = entry.split(':') as [string,string]; return h('label', {key:id}, [h('input', {type:'checkbox',checked:!props.thresholds.disabledRules?.includes(id),onChange:()=> props.onChange({...props.thresholds,disabledRules:props.thresholds.disabledRules?.includes(id) ? props.thresholds.disabledRules.filter((key)=>key!==id) : [...(props.thresholds.disabledRules ?? []),id]})}), label]); })]),
    ...THRESHOLD_FIELDS.map((field) => h('label', {
      key: field.key,
      style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', padding: '5px 0', borderTop: '1px solid color-mix(in srgb, currentColor 10%, transparent)' },
    }, [
      h('span', { key: 'label', style: { flex: '0 0 130px' } }, field.label),
      h('input', {
        key: 'input',
        type: 'number',
        step: field.key === 'contextOverloadRatio' ? '0.05' : field.key === 'toolErrorRate' ? '0.01' : '1',
        min: 0,
        max: field.key === 'contextOverloadRatio' || field.key === 'toolErrorRate' ? 1 : undefined,
        value: String(props.thresholds[field.key]),
        onChange: (event: unknown) => {
          const value = parseFloat((event as { target: { value: string } }).target.value);
          if (!Number.isFinite(value) || value < 0 || ((field.key === 'contextOverloadRatio' || field.key === 'toolErrorRate') && value > 1)) return;
          props.onChange({ ...props.thresholds, [field.key]: value });
        },
        style: {
          width: '80px', padding: '2px 6px', borderRadius: '6px', font: 'inherit', fontSize: '12px',
          border: '1px solid color-mix(in srgb, currentColor 25%, transparent)', background: 'transparent', color: 'inherit',
        },
      }),
      h('span', { key: 'help', style: { opacity: 0.55, fontSize: '11px' } }, `${field.help}（当前 ${field.format(props.thresholds[field.key])}）`),
    ])),
    h('div', { key: 'actions', style: { display: 'flex', gap: '8px', marginTop: '10px' } }, [
      h('button', {
        key: 'reset', type: 'button', style: buttonStyle, onClick: () => props.onChange({ ...DEFAULT_THRESHOLDS }),
      }, '恢复默认'),
      h('button', {
        key: 'close', type: 'button', style: buttonStyle, onClick: props.onClose,
      }, '关闭'),
    ]),
  ]);
}

/** Convenience: run the rule engine with current thresholds. */
export function runAlerts(input: Parameters<typeof evaluateAlerts>[0], thresholds: AlertThresholds): Alert[] {
  return evaluateAlerts(input, thresholds);
}

/** Right-side triage panel; state filters preserve resolved and ignored records. */
export function AlertsDrawer(props: {
  inline?: boolean;
  configuration?: ConfigurationRemote | undefined;
  input?: AlertInput; thresholds?: AlertThresholds;
  open: boolean; alerts: Alert[]; dismissed: string[]; resolved: string[];
  onClose: () => void; onDismiss: (id: string) => void; onResolve: (id: string) => void;
  onView: (id: string) => void; onSettings: () => void;
}): unknown {
  const [status, setStatus] = useState('pending');
  const [level, setLevel] = useState('all');
  if (!props.open) return null;
  const statusOf = (id: string) => props.dismissed.includes(id) ? 'ignored' : props.resolved.includes(id) ? 'resolved' : 'pending';
  const order = { critical: 0, warning: 1, info: 2 };
  const pending = props.alerts.filter((alert) => statusOf(alert.id) === 'pending');
  const visible = props.alerts.filter((alert) => (status === 'all' || statusOf(alert.id) === status) && (level === 'all' || alert.severity === level)).sort((a,b) => order[a.severity] - order[b.severity]);
  const measurement = (id: string) => {
    const key = id === 'context-overload' ? 'utilization' : id === 'frequent-compaction' ? 'compactionFrequency' : id === 'high-error-rate' ? 'toolErrorRate' : id === 'token-waste' ? 'repeatGroups' : 'longGapCount';
    const thresholdKey = id === 'context-overload' ? 'contextOverloadRatio' : id === 'frequent-compaction' ? 'compactionFrequencyPer1k' : id === 'high-error-rate' ? 'toolErrorRate' : id === 'token-waste' ? 'repeatCallGroups' : 'longGapSegments';
    return { value: props.input?.[key], threshold: props.thresholds?.[thresholdKey] };
  };
  const renderAlert = (alert: Alert) => h('details', { key: alert.id, style: { border: '1px solid color-mix(in srgb, currentColor 20%, transparent)', borderLeft: `3px solid ${SEVERITY_META[alert.severity].color}`, borderRadius: 8, padding: 10 } }, [
    h('summary', { key: 'head', style: { cursor: 'pointer' } }, `${SEVERITY_META[alert.severity].icon} ${alert.title} · ${SEVERITY_META[alert.severity].label}${alert.timeMs ? ` · ${new Date(alert.timeMs).toLocaleTimeString()}` : ''}`),
    h('p', { key: 'detail' }, alert.detail),
    h('div', { key: 'time', style: { fontSize: 11, opacity: 0.65 } }, `首次检测：${alert.timeMs ? new Date(alert.timeMs).toLocaleString() : '等待记录'} · 状态：${statusOf(alert.id) === 'pending' ? '未处理' : statusOf(alert.id) === 'ignored' ? '已忽略' : '已处理'}`),
    h('div', { key: 'actions', style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 } }, [
      h('button', { key: 'view', onClick: () => props.onView(alert.id), style: buttonStyle }, alert.id === 'long-gaps' ? '查看相关指标' : '查看相关图表'),
      statusOf(alert.id) === 'pending' ? h('button', { key: 'ignore', onClick: () => props.onDismiss(alert.id), style: buttonStyle }, '忽略') : null,
      statusOf(alert.id) === 'pending' ? h('button', { key: 'resolve', onClick: () => props.onResolve(alert.id), style: buttonStyle }, '标记已处理') : null,
    ]),
    (() => { const sample = measurement(alert.id); return typeof sample.value === 'number' && typeof sample.threshold === 'number' ? h('div', { key: 'measurement' }, [h('div', {key:'label'}, `当前值 ${sample.value.toFixed(3)} / 阈值 ${sample.threshold}`), h('meter', { key: 'meter', min: 0, max: Math.max(1, sample.value, sample.threshold) * 1.1, value: sample.value, style: { width: '100%' }, 'aria-label': `${alert.title}当前值与阈值` })]) : null; })(),
    h('p', { key: 'suggestion' }, `优化建议：${alert.suggestion}`),
    h(ConfigurationAction, { key: 'configuration', rule: alert.id, remote: props.configuration }),
  ]);
  return h(props.inline ? 'section' : 'aside', { role: props.inline ? 'region' : 'dialog', 'aria-label': '智能告警面板', style: { ...(props.inline ? { minWidth: 0 } : { position: 'fixed', right: 12, top: 70, bottom: 90, width: 'min(440px, calc(100vw - 24px))', zIndex: 60, overflowY: 'auto', boxShadow: '0 12px 40px #0003' }), padding: 12, borderRadius: 10, background: 'var(--dsh-eval-surface, Canvas)', color: 'CanvasText', border: '1px solid #9995', display: 'flex', flexDirection: 'column', gap: 10 } }, [
    h('div', { key: 'head', style: { display: 'flex', justifyContent: 'space-between', gap: 8 } }, [h('strong', { key: 'title' }, `智能告警 · 未处理 ${pending.length}`), h('button', { key: 'settings', onClick: props.onSettings, style: buttonStyle }, '规则设置'), props.inline ? null : h('button', { key: 'close', onClick: props.onClose, 'aria-label': '关闭告警面板', style: buttonStyle }, '关闭')]),
    h('label', { key: 'status' }, ['状态 ', h('select', { value: status, onChange: (event: {target: {value: string}}) => setStatus(event.target.value) }, ['pending:只看未处理','resolved:已处理','ignored:已忽略','all:全部'].map((entry) => { const [value,label] = entry.split(':'); return h('option', {key:value,value},label); }))]),
    h('label', { key: 'level' }, ['级别 ', h('select', { value: level, onChange: (event: {target: {value: string}}) => setLevel(event.target.value) }, ['all:全部级别','critical:严重','warning:警告','info:建议'].map((entry) => { const [value,label] = entry.split(':'); return h('option', {key:value,value},label); }))]),
    visible.length ? h('div', { key: 'list', style: { display: 'grid', gap: 10 } }, [ ...visible.slice(0, 5).map(renderAlert), visible.length > 5 ? h('details', { key: 'overflow' }, [h('summary', {key:'summary'}, `展开其余 ${visible.length - 5} 条告警`), ...visible.slice(5).map(renderAlert)]) : null ]) : h('div', { key: 'empty', style: { color: pending.length === 0 ? '#218250' : 'inherit', padding: 12 } }, pending.length === 0 && status === 'pending' ? '✓ 一切正常：当前没有未处理告警。' : '没有符合筛选条件的告警。'),
  ]);
}
