/**
 * The composer-dock status chip and the plugin-page section (ported from the
 * shipped client half; behavior is pinned by test/client_chip.test.ts).
 */
import { useEffect, useState } from './react-binding.js';
import { h } from './react-binding.js';
import {
  labelOf, panelFor,
  PACKAGE_NAME, rowsOf, diagnose, diagnoseSubject,
  type BundleRecord, type Diagnosis,
} from './remote.js';

interface LoadResult {
  kind: 'loading' | 'no-channel' | 'error' | 'ready';
  diag?: Diagnosis;
  detail?: string;
}

export function createChip(load: () => Promise<LoadResult>, t: (key: string) => string) {
  return function EvalControlChip() {
    const [state, setState] = useState<LoadResult>({ kind: 'loading' });
    const [open, setOpen] = useState(false);
    useEffect(() => {
      let alive = true;
      const refresh = () => {
        Promise.resolve(load()).then(
          (next) => { if (alive) setState(next); },
          (error: unknown) => {
            if (alive) setState({ kind: 'error', detail: String((error && (error as Error).message) || error) });
          },
        );
      };
      refresh();
      const timer = setInterval(refresh, 30_000);
      return () => { alive = false; clearInterval(timer); };
    }, []);

    const diag = state.diag;
    let modeKind: string;
    let short: string;
    if (state.kind === 'loading') { modeKind = 'loading'; short = t('loading'); }
    else if (state.kind === 'no-channel') { modeKind = 'no-channel'; short = t('noChannel'); }
    else if (state.kind === 'error') { modeKind = 'error'; short = `${t('error')}: ${state.detail}`; }
    else { modeKind = diag ? diag.mode : 'unknown'; short = modeKind; }

    const anomalies = diag ? diag.anomalies : [];
    const rows = diag ? diag.rows : [];
    const title = [
      t('title'),
      `${t('mode')}: ${modeKind}`,
      ...rows.map((row) => `${t('rows')} ${labelOf(row)} enabled=${String(row.enabled)} phase=${String(row.phase)}`),
      ...anomalies.map((line) => `! ${line}`),
    ].join('\n');

    const panel = panelFor(t, modeKind, diag ?? null);

    const chip = h('button', {
      type: 'button',
      'aria-label': `${t('label')}: ${modeKind}`,
      'aria-expanded': open,
      title,
      onClick: () => setOpen((value) => !value),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35em',
        font: 'inherit',
        fontSize: '11px',
        lineHeight: '1.4',
        padding: '0 0.5em',
        border: '1px solid currentColor',
        borderRadius: '999px',
        opacity: modeKind === 'active' ? 0.85 : 0.7,
        color: 'currentColor',
        background: 'transparent',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
    }, h('span', { 'aria-hidden': true }, '◆'), `${t('label')} · ${short}${anomalies.length > 0 ? ` ⚠${anomalies.length}` : ''}`);

    if (!open) return h('span', { style: { display: 'inline-flex', alignItems: 'center' } }, chip);
    return h('span', { style: { position: 'relative', display: 'inline-flex', alignItems: 'center' } }, [
      chip,
      h('div', {
        key: 'panel',
        role: 'dialog',
        style: {
          position: 'absolute',
          bottom: '100%',
          left: 0,
          zIndex: 30,
          minWidth: '18em',
          maxWidth: '28em',
          marginBottom: '0.35em',
          padding: '0.5em 0.6em',
          border: '1px solid currentColor',
          borderRadius: '6px',
          background: 'Canvas',
          color: 'CanvasText',
          fontSize: '11px',
          lineHeight: '1.5',
          textAlign: 'left',
          whiteSpace: 'normal',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
        },
      }, panel),
    ]);
  };
}

/**
 * The `plugins.detail.section` contributor: the chip's corollary on the
 * bundle's own detail page — same builder, same host facts. Renders nothing
 * for any subject that is not this bundle.
 */
export function createSection(t: (key: string) => string) {
  return function EvalControlSection(props: { t?: unknown; subject?: unknown }) {
    const diagnoseResult = diagnoseSubject(props && props.subject);
    if (diagnoseResult === undefined) return null;
    const pageT = props && typeof props.t === 'function' ? (props.t as (key: string) => string) : t;
    return h('div', {
      style: {
        marginTop: '0.5em',
        padding: '0.5em 0.6em',
        border: '1px solid currentColor',
        borderRadius: '6px',
        fontSize: '12px',
        lineHeight: '1.5',
        whiteSpace: 'normal',
      },
    }, panelFor(pageT, diagnoseResult.mode, diagnoseResult));
  };
}

/** The chip's async diagnosis over the two host surfaces. */
export function createLoader(ctx: {
  remote?: {
    pluginInventory?: { list?: () => Promise<unknown> };
    pluginManager?: { listBundles?: () => Promise<unknown> };
  };
}): () => Promise<LoadResult> {
  return async () => {
    const inventory = ctx.remote && ctx.remote.pluginInventory;
    if (!inventory || typeof inventory.list !== 'function') return { kind: 'no-channel' };
    const result = (await inventory.list()) as { ok?: boolean; error?: { code?: string; message?: string }; value?: unknown } | null;
    if (!result || result.ok !== true) {
      const error = result && result.error ? result.error : {};
      return { kind: 'error', detail: `${error.code || 'unknown'}${error.message ? `: ${error.message}` : ''}` };
    }
    let bundle: BundleRecord | null = null;
    const manager = ctx.remote && ctx.remote.pluginManager;
    if (manager && typeof manager.listBundles === 'function') {
      try {
        const bundles = (await manager.listBundles()) as { ok?: boolean; value?: unknown } | null;
        if (bundles && bundles.ok === true) {
          bundle = (rowsOf(bundles.value).find((item) => item && (item as BundleRecord).name === PACKAGE_NAME) as BundleRecord) || null;
        }
      } catch { /* the chip degrades to the inventory-only view */ }
    }
    const value = result.value;
    const diag = diagnose({ entries: rowsOf(value) }, bundle);
    return {
      kind: 'ready',
      diag,
      detail: [
        ...diag.rows.map((row) => `${labelOf(row)} enabled=${String(row.enabled)} phase=${String(row.phase)}`),
        ...diag.anomalies.map((line) => `! ${line}`),
      ].join('\n'),
    };
  };
}
