/**
 * Read-only diagnosis over the host's plugin surfaces (ported unchanged from
 * the shipped client half): `pluginInventory/list` rows + the
 * `pluginManager/listBundles` bundle record. The chip and the plugin-page
 * section share this so they can never disagree.
 */
import { h } from './react-binding.js';

export const PACKAGE_NAME = 'dsh-eval-control';
export const TRANSPORT_ROW_ID = 'aeval-broker-transport';
export const CONTROL_ROW_ID = 'aeval-eval-control';
export const CONFIG_ENV = 'AEVAL_CONTROL_CONFIG';
export const CONFIG_EXAMPLE = '/abs/path/control-config.json';

interface RowLike {
  entryId?: unknown;
  moduleName?: unknown;
  module?: unknown;
  rowId?: unknown;
  id?: unknown;
  enabled?: unknown;
  fiberPhase?: unknown;
  phase?: unknown;
  meta?: unknown;
}

export interface NormalizedRow {
  rowId: string | null;
  moduleName: string;
  entryId: unknown;
  enabled: unknown;
  phase: string | null | undefined;
  meta: unknown;
}

export interface BundleRecord {
  name?: unknown;
  rows?: unknown;
  error?: unknown;
}

export interface Diagnosis {
  mode: string;
  rows: NormalizedRow[];
  anomalies: string[];
  bundle: BundleRecord | null;
}

/** Accept either a bare array or an `{ entries }` / `{ plugins }` envelope. */
export function rowsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const entries = (value as { entries?: unknown }).entries;
    if (Array.isArray(entries)) return entries;
    const plugins = (value as { plugins?: unknown }).plugins;
    if (Array.isArray(plugins)) return plugins;
  }
  return [];
}

/** The Loader specifier of a row, under either host spelling. */
export function moduleNameOf(row: unknown): string {
  if (!row) return '';
  const typed = row as RowLike;
  if (typeof typed.moduleName === 'string') return typed.moduleName;
  return typeof typed.module === 'string' ? typed.module : '';
}

/** The row's patch id (`listBundles` rows) or Loader entry id. */
export function rowIdOf(row: unknown): string {
  if (!row) return '';
  const typed = row as RowLike;
  if (typeof typed.rowId === 'string') return typed.rowId;
  return typeof typed.id === 'string' ? typed.id : '';
}

/** The Loader row's fiber phase (`fiberPhase` preferred, `phase` accepted). */
export function phaseOf(row: unknown): string | null | undefined {
  if (!row) return undefined;
  const typed = row as RowLike;
  if (Object.prototype.hasOwnProperty.call(typed, 'fiberPhase')) {
    const phase = typed.fiberPhase;
    if (phase === null) return null;
    return typeof phase === 'string' ? phase : undefined;
  }
  if (Object.prototype.hasOwnProperty.call(typed, 'phase')) {
    const phase = typed.phase;
    if (phase === null) return null;
    return typeof phase === 'string' ? phase : undefined;
  }
  return undefined;
}

/** True for a row belonging to this plugin's bundle, by id or module path. */
export function isOurs(text: string): boolean {
  return text.includes(PACKAGE_NAME) || text.includes(TRANSPORT_ROW_ID) || text.includes(CONTROL_ROW_ID);
}

function metaTextOf(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return '';
  const parts: string[] = [];
  for (const key of ['title', 'description', 'error']) {
    const value = (meta as Record<string, unknown>)[key];
    if (typeof value === 'string') parts.push(value);
    else if (value && typeof value === 'object') {
      parts.push(Object.values(value).filter((item): item is string => typeof item === 'string').join(' '));
    }
  }
  return parts.join(' ');
}

function metaNamesAeval(meta: unknown): boolean {
  return /\baeval\b/i.test(metaTextOf(meta));
}

function isTransport(text: string): boolean {
  return text.includes('sandbox_entry') || text.includes(TRANSPORT_ROW_ID);
}

/** Split the plugin's rows into the transport row and the control row. */
function classify(rows: NormalizedRow[]): { transport: NormalizedRow | undefined; control: NormalizedRow | undefined } {
  let transport: NormalizedRow | undefined;
  let control: NormalizedRow | undefined;
  for (const row of rows) {
    const text = `${row.rowId ?? ''} ${row.moduleName}`;
    if (isTransport(text)) {
      if (transport === undefined) transport = row;
      continue;
    }
    if (control === undefined && (text.includes(CONTROL_ROW_ID) || text.includes(PACKAGE_NAME) || row.moduleName !== '')) control = row;
  }
  return { transport, control };
}

/**
 * The current mode, read from the live rows only: `active` requires the
 * control row itself to be live and active; a mounted transport alone is
 * `standalone`.
 */
export function modeOf(rows: NormalizedRow[]): string {
  if (rows.length === 0) return 'not-mounted';
  const { transport, control } = classify(rows);
  if (control && control.phase === 'active') return 'active';
  if (rows.some((row) => row.phase === 'failed')) return 'failed';
  if (transport && transport.phase === 'active') return 'standalone';
  return 'unknown';
}

/** A short row label for the popover and the collapsed title. */
export function labelOf(row: NormalizedRow): string {
  return row.rowId ?? row.moduleName ?? (row.entryId === null ? '?' : String(row.entryId));
}

/** One line describing the incompatible packages a bundle error names. */
function incompatibleDetail(error: unknown): string {
  const typed = (error ?? {}) as {
    incompatible?: Array<Record<string, unknown>>;
  };
  const peers = Array.isArray(typed.incompatible) ? typed.incompatible : [];
  return peers.map((entry) => {
    const name = entry && typeof entry['name'] === 'string' ? entry['name'] : '?';
    const version = entry && typeof entry['version'] === 'string' ? entry['version'] : '?';
    const runtime = entry && typeof entry['runtimeVersion'] === 'string' ? entry['runtimeVersion'] : '?';
    const peerMap = (entry && entry['peers']) as Record<string, unknown> | undefined;
    const ranges = Object.entries(peerMap ?? {})
      .map(([peer, range]) => `${peer} ${String(range)}`)
      .join(' ');
    return `${name}@${version} rejects ${ranges || 'its peers'} on dsh ${runtime}`;
  }).join('; ');
}

export function anomaliesOf(rows: NormalizedRow[], bundle: BundleRecord | null): string[] {
  const out: string[] = [];
  const error = bundle && bundle.error;
  if (typeof error === 'string' && error !== '') out.push(`bundle ${error}`);
  else if (error && typeof error === 'object') {
    const typed = error as { code?: unknown };
    const detail = typed.code === 'incompatible-version' ? incompatibleDetail(error) : '';
    out.push(`bundle ${String(typed.code || 'error')}${detail === '' ? '' : ` — ${detail}`}`);
  }
  for (const row of rows) {
    const label = labelOf(row);
    if (row.phase === 'failed') out.push(`${label}: fiber failed`);
    if (row.phase === null && row.enabled !== false) out.push(`${label}: no live fiber`);
    if (row.enabled === false) out.push(`${label}: disabled`);
    const meta = row.meta as Record<string, unknown> | null | undefined;
    if (meta && typeof meta['error'] === 'string' && meta['error'] !== '') out.push(`${label}: ${String(meta['error'])}`);
  }
  return out;
}

/** Join the bundle's declared rows with the live inventory. */
export function collectRows(inventoryRows: unknown[], bundle: BundleRecord | null): NormalizedRow[] {
  const byEntryId = new Map<unknown, unknown>();
  for (const row of inventoryRows) {
    const typed = row as RowLike | null;
    if (row && typed && typed.entryId !== undefined && typed.entryId !== null) byEntryId.set(typed.entryId, row);
  }
  const rows: NormalizedRow[] = [];
  const seen = new Set<unknown>();
  if (bundle && Array.isArray(bundle.rows)) {
    for (const declared of bundle.rows) {
      const declaredRow = declared as RowLike;
      const live = declaredRow.entryId === undefined ? undefined : byEntryId.get(declaredRow.entryId);
      rows.push({
        rowId: rowIdOf(declared) || rowIdOf(live) || null,
        moduleName: moduleNameOf(declared) || moduleNameOf(live),
        entryId: declaredRow.entryId === undefined ? null : declaredRow.entryId,
        enabled: live ? (live as RowLike).enabled : undefined,
        // Declared but with no live entry: the Loader has no root fiber.
        phase: live ? phaseOf(live) : null,
        meta: (live && (live as RowLike).meta) || declaredRow.meta,
      });
      if (declaredRow.entryId !== undefined) seen.add(declaredRow.entryId);
      if (moduleNameOf(declared) !== '') seen.add(moduleNameOf(declared));
    }
  }
  for (const live of inventoryRows) {
    const liveRow = (live ?? {}) as RowLike;
    const moduleName = moduleNameOf(live);
    const rowId = rowIdOf(live);
    if (!isOurs(`${moduleName} ${rowId}`) && !metaNamesAeval(liveRow.meta)) continue;
    if ((liveRow.entryId !== undefined && seen.has(liveRow.entryId)) || (moduleName !== '' && seen.has(moduleName))) continue;
    rows.push({
      rowId: rowId || null,
      moduleName,
      entryId: liveRow.entryId === undefined ? null : liveRow.entryId,
      enabled: liveRow.enabled,
      phase: phaseOf(live),
      meta: liveRow.meta,
    });
  }
  return rows;
}

export function diagnose(inventory: unknown, bundle: BundleRecord | null): Diagnosis {
  const rows = collectRows(rowsOf(inventory), bundle);
  return { mode: modeOf(rows), rows, anomalies: anomaliesOf(rows, bundle), bundle: bundle || null };
}

/** The `plugins.detail.section` page's own subject row normalization. */
function rowsFromPage(pkgRows: unknown): NormalizedRow[] {
  return (Array.isArray(pkgRows) ? pkgRows : []).map((row) => ({
    rowId: rowIdOf(row) || null,
    moduleName: moduleNameOf(row),
    entryId: (row as RowLike).entryId === undefined ? null : (row as RowLike).entryId,
    enabled: (row as RowLike).enabled,
    phase: phaseOf(row),
    meta: (row as RowLike).meta,
  }));
}

/** The diagnosis for one plugin-page subject, or undefined when it is not ours. */
export function diagnoseSubject(subject: unknown): Diagnosis | undefined {
  if (!subject || typeof subject !== 'object') return undefined;
  const typed = subject as { kind?: unknown; pkg?: unknown };
  if (typed.kind !== 'bundle' || !typed.pkg) return undefined;
  const pkg = typed.pkg as { name?: unknown; rows?: unknown; error?: unknown };
  if (pkg.name !== PACKAGE_NAME) return undefined;
  const rows = rowsFromPage(pkg.rows);
  return { mode: modeOf(rows), rows, anomalies: anomaliesOf(rows, pkg as BundleRecord), bundle: pkg as BundleRecord };
}

/* ---- The shared panel body ------------------------------------------- */

export function modeTextOf(t: (key: string) => string, modeKind: string): string {
  if (modeKind === 'active') return t('modeActive');
  if (modeKind === 'standalone') return t('modeStandalone');
  if (modeKind === 'not-mounted') return t('modeNotMounted');
  if (modeKind === 'failed') return t('modeFailed');
  if (modeKind === 'unknown') return t('modeUnknown');
  if (modeKind === 'no-channel') return t('noChannel');
  return t('loading');
}

export function panelFor(t: (key: string) => string, modeKind: string, diag: Diagnosis | null): unknown[] {
  const anomalies = diag ? diag.anomalies : [];
  const panel: unknown[] = [
    h('div', { key: 'mode', style: { fontWeight: 600 } }, `${t('mode')}: ${modeKind}`),
    h('div', { key: 'modeText' }, modeTextOf(t, modeKind)),
  ];
  if (modeKind === 'standalone') panel.push(h('div', { key: 'design', style: { marginTop: '0.4em' } }, t('standaloneIsDesign')));
  if (modeKind === 'standalone' || modeKind === 'unknown') {
    panel.push(h('div', { key: 'stepTitle', style: { marginTop: '0.4em', fontWeight: 600 } }, t('stepTitle')));
    panel.push(h('div', { key: 'stepEnv' }, `1. ${t('stepEnv')}`));
    panel.push(h('div', { key: 'stepPatch' }, `2. ${t('stepPatch')}`));
    panel.push(h('pre', {
      key: 'patchBody',
      style: { margin: '0.2em 0', whiteSpace: 'pre-wrap', font: 'inherit' },
    }, t('patchBody')));
    panel.push(h('div', { key: 'controlRow' }, t('controlRowNote')));
  }
  if (modeKind === 'not-mounted') {
    panel.push(h('div', { key: 'stepInstallTitle', style: { marginTop: '0.4em', fontWeight: 600 } }, t('stepInstallTitle')));
    panel.push(h('div', { key: 'stepInstall' }, t('stepInstall')));
  }
  if (modeKind === 'failed') {
    panel.push(h('div', { key: 'stepFailedTitle', style: { marginTop: '0.4em', fontWeight: 600 } }, t('stepFailedTitle')));
    panel.push(h('div', { key: 'stepFailed' }, t('stepFailed')));
  }
  if (anomalies.length > 0) {
    panel.push(h('div', { key: 'anomaliesTitle', style: { marginTop: '0.4em', fontWeight: 600 } }, t('anomalies')));
    panel.push(h('ul', { key: 'anomalies', style: { margin: '0.2em 0', paddingLeft: '1.2em' } },
      anomalies.map((line, index) => h('li', { key: index }, line))));
  }
  panel.push(h('div', { key: 'peerHint', style: { marginTop: '0.4em', opacity: 0.8 } }, t('peerHint')));
  panel.push(h('div', { key: 'readonly', style: { marginTop: '0.4em', opacity: 0.8 } }, t('readonly')));
  return panel;
}
