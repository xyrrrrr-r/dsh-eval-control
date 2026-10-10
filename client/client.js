/**
 * Client half of dsh-eval-control: a compact status chip in the composer dock.
 *
 * Read-only by design. It asks the Host's `pluginInventory/list` Remote which
 * control rows are mounted and how their fibers settled, and renders one line.
 * When that Remote is not composed in the running deployment the chip says so
 * instead of failing; nothing here changes plugin state.
 */
window.__ModuleLoader__.load({
  id: 'dsh-eval-control',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh.eval-control';

    const DICTIONARIES = {
      zh: {
        label: 'aeval 控制',
        loading: '读取中',
        mounted: '已挂载',
        notMounted: '未挂载',
        noChannel: '宿主通道不可用',
        error: '查询失败',
        standalone: 'standalone（未注入配置）',
        active: 'active（已注入配置）',
        title: 'aeval 评测控制状态（只读）',
      },
      en: {
        label: 'aeval control',
        loading: 'reading',
        mounted: 'mounted',
        notMounted: 'not mounted',
        noChannel: 'host channel unavailable',
        error: 'query failed',
        standalone: 'standalone (no configuration)',
        active: 'active (configuration bound)',
        title: 'aeval evaluation control status (read-only)',
      },
    };

    /** Accept either a bare array or a `{ entries }` envelope. */
    function rowsOf(value) {
      if (Array.isArray(value)) return value;
      if (value && Array.isArray(value.entries)) return value.entries;
      if (value && Array.isArray(value.plugins)) return value.plugins;
      return [];
    }

    function isOurs(row) {
      const text = `${row && row.module ? row.module : ''} ${row && row.id ? row.id : ''}`;
      return text.includes('dsh-eval-control') || text.includes('aeval-broker-transport')
        || text.includes('aeval-eval-control');
    }

    function createChip(load, t) {
      return function EvalControlChip() {
        const [state, setState] = React.useState({ kind: 'loading' });
        React.useEffect(() => {
          let alive = true;
          const refresh = () => {
            Promise.resolve(load()).then(
              (next) => { if (alive) setState(next); },
              (error) => { if (alive) setState({ kind: 'error', detail: String(error && error.message ? error.message : error) }); },
            );
          };
          refresh();
          const timer = setInterval(refresh, 30_000);
          return () => { alive = false; clearInterval(timer); };
        }, []);

        const phase = state.rows && state.rows.length > 0 ? state.rows[0].phase : undefined;
        let text;
        if (state.kind === 'loading') text = t('loading');
        else if (state.kind === 'no-channel') text = t('noChannel');
        else if (state.kind === 'error') text = `${t('error')}: ${state.detail}`;
        else if (state.kind === 'not-mounted') text = t('notMounted');
        else text = `${t('mounted')}${phase ? ` · ${phase}` : ''}`;

        return h('span', {
          title: `${t('title')}${state.detail ? `\n${state.detail}` : ''}`,
          'aria-label': `${t('label')}: ${text}`,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35em',
            fontSize: '11px',
            lineHeight: '1.4',
            padding: '0 0.5em',
            border: '1px solid currentColor',
            borderRadius: '999px',
            opacity: state.kind === 'mounted' ? 0.85 : 0.55,
            color: 'currentColor',
            background: 'transparent',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
        }, h('span', { 'aria-hidden': true }, '◆'), `${t('label')} · ${text}`);
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'dsh-eval-control:dictionaries');
        const t = ctx.locale.bind(NS);

        const load = async () => {
          const inventory = ctx.remote && ctx.remote.pluginInventory;
          if (!inventory || typeof inventory.list !== 'function') return { kind: 'no-channel' };
          const result = await inventory.list();
          if (!result || result.ok !== true) {
            const error = result && result.error ? result.error : {};
            return { kind: 'error', detail: `${error.code || 'unknown'}${error.message ? `: ${error.message}` : ''}` };
          }
          const ours = rowsOf(result.value).filter(isOurs);
          if (ours.length === 0) return { kind: 'not-mounted' };
          return {
            kind: 'mounted',
            rows: ours.map((row) => ({
              id: row.id === undefined ? null : row.id,
              phase: row.phase === undefined ? null : row.phase,
              enabled: row.enabled === undefined ? null : row.enabled,
            })),
            detail: ours.map((row) => `${row.id || row.module || '?'} enabled=${String(row.enabled)} phase=${String(row.phase)}`).join('\n'),
          };
        };

        const Chip = createChip(load, t);
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'dsh-eval-control',
          order: 5,
        }, Chip));
      },
    };
  },
});