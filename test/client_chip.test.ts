/**
 * The Web status chip's read-only diagnosis.
 *
 * The chip ships as a browser script, so this suite loads the REAL
 * `client/client.js` through a fake `window.__ModuleLoader__` and drives it
 * with a tiny hook-capable React stand-in: `apply` → composer-dock component →
 * `load` → render. Assertions therefore run against the shipping code path,
 * not against a copy of its logic. The host payload shapes asserted here are
 * the ones the shipping Host produces (`pluginInventory/list` rows carry
 * `entryId`/`moduleName`/`enabled`/`fiberPhase`/`meta`, and
 * `pluginManager/listBundles` rows carry `error` with `code` and, for a peer
 * rejection, `incompatible`).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Compiled tests live in `.test-dist/test/`, so the repository root is two
// levels up (same convention as the other suites).
const root = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE = readFileSync(join(root, 'client', 'client.js'), 'utf8');

interface UiElement {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

type Component = () => UiElement;
interface ClientPlugin {
  inject: string[];
  apply(ctx: unknown): void;
}
type Factory = (require: (name: string) => unknown) => ClientPlugin;

const TRANSPORT_MODULE = './dist/sandbox_entry.js';
const CONTROL_MODULE = './dist/index.js';

interface Harness {
  readonly dict: Record<string, string>;
  readonly missingKeys: string[];
  readonly injected: string[];
  readonly plugin: ClientPlugin;
  readonly registrations: Array<{ options: Record<string, unknown>; component: (props?: unknown) => unknown }>;
  render(): UiElement;
  settle(): Promise<void>;
  /** The `plugins.detail.section` contributor, as the page renders it. */
  section(props: unknown): unknown;
}

/**
 * Load `client/client.js`, mount its plugin through a fake Cordis context, and
 * expose the composer-dock component as a re-renderable function.
 */
function createChip(remote: unknown): Harness {
  const dict: Record<string, string> = {};
  const missingKeys: string[] = [];
  const injected: string[] = [];
  const registrations: Array<{ options: Record<string, unknown>; component: (props?: unknown) => unknown }> = [];

  const states: unknown[] = [];
  const effects: Array<(() => void | (() => void)) | undefined> = [];
  const initialized = new Set<number>();
  const ran = new Set<number>();
  let cursor = 0;

  const React = {
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): UiElement {
      return {
        type,
        props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
      };
    },
    useState(initial: unknown): [unknown, (next: unknown) => void] {
      const index = cursor;
      cursor += 1;
      if (!initialized.has(index)) {
        initialized.add(index);
        states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      }
      const set = (next: unknown): void => {
        states[index] = typeof next === 'function' ? (next as (prev: unknown) => unknown)(states[index]) : next;
      };
      return [states[index], set];
    },
    useEffect(effect: () => void | (() => void)): void {
      const index = cursor;
      cursor += 1;
      effects[index] = effect;
    },
  };

  const ctx = {
    remote,
    // Cordis runs the effect body at registration time; the harness does the
    // same so the locale dictionary is installed before the first render.
    effect: (effect: () => unknown) => { effect(); },
    locale: {
      register: (_ns: string, dictionaries: Record<string, Record<string, string>>) => {
        const zh = dictionaries['zh'];
        if (zh !== undefined) Object.assign(dict, zh);
      },
      bind: () => (key: string) => {
        const value = dict[key];
        if (value === undefined) {
          missingKeys.push(key);
          return key;
        }
        return value;
      },
    },
    slots: {
      inject: (name: string, callback: () => void) => { injected.push(name); callback(); },
      register: (options: Record<string, unknown>, component: (props?: unknown) => unknown) => {
        registrations.push({ options, component });
        return component;
      },
    },
  };

  let factory: Factory | undefined;
  const windowStub = {
    __ModuleLoader__: {
      load(spec: { factory?: Factory }) { factory = spec.factory; },
    },
  };
  // The chip polls every 30 s; a real interval would keep the test process
  // alive after its assertions, so the script's `setInterval` is a stub.
  let nextTimer = 1;
  const intervalStub = (): number => nextTimer++;
  new Function('window', 'setInterval', SOURCE)(windowStub, intervalStub);
  if (factory === undefined) throw new Error('client/client.js registered no module factory');
  const plugin = factory((name: string): unknown => {
    if (name === 'react') return React;
    throw new Error(`the chip must not require ${name}`);
  });
  plugin.apply(ctx);
  const chipRegistration = registrations.find((entry) => entry.options['name'] === 'conversation.composer.dock');
  const sectionRegistration = registrations.find((entry) => entry.options['name'] === 'plugins.detail.section');
  if (chipRegistration === undefined || sectionRegistration === undefined) {
    throw new Error('the client half must register the dock chip and the plugin-page section');
  }
  const component = chipRegistration.component as Component;

  const render = (): UiElement => {
    cursor = 0;
    const element = component();
    for (let index = 0; index < effects.length; index += 1) {
      const effect = effects[index];
      if (effect === undefined || ran.has(index)) continue;
      ran.add(index);
      effect();
    }
    return element;
  };

  return {
    dict,
    missingKeys,
    injected,
    plugin,
    registrations,
    render,
    // The load path awaits the remotes and then a microtask-decided state set;
    // one macrotask turn is enough for both to settle.
    settle: async () => { await new Promise((resolve) => setTimeout(resolve, 0)); },
    section: (props: unknown) => sectionRegistration.component(props),
  };
}

/** Every string rendered anywhere under `node`. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  const element = node as UiElement;
  return element.props === undefined ? '' : textOf(element.props['children']);
}

function findButtons(node: unknown): UiElement[] {
  const found: UiElement[] = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (current === null || typeof current !== 'object') return;
    const element = current as UiElement;
    if (element.type === 'button') found.push(element);
    if (element.props !== undefined) visit(element.props['children']);
  };
  visit(node);
  return found;
}

interface RemoteOptions {
  inventory?: unknown;
  bundles?: unknown;
  manager?: boolean;
}

/**
 * A recording Remote stub: only the methods the chip is allowed to call exist,
 * so any write-shaped call would throw instead of passing silently.
 */
function stubRemote(options: RemoteOptions = {}): { remote: unknown; calls: string[] } {
  const calls: string[] = [];
  const remote: Record<string, unknown> = {
    pluginInventory: {
      list: async () => {
        calls.push('pluginInventory.list');
        return options.inventory ?? { ok: true, value: { entries: [] } };
      },
    },
  };
  if (options.manager !== false) {
    remote['pluginManager'] = {
      listBundles: async () => {
        calls.push('pluginManager.listBundles');
        return options.bundles ?? { ok: true, value: [] };
      },
    };
  }
  return { remote, calls };
}

function row(entryId: string, moduleName: string, fiberPhase: string | null, enabled = true): unknown {
  return { entryId, moduleName, enabled, fiberPhase, meta: { title: { en: 'aeval eval control' } } };
}

function bundle(rows: unknown[], extra: Record<string, unknown> = {}): unknown {
  return { name: 'dsh-eval-control', version: '0.2.6', enabled: true, installed: true, rows, ...extra };
}

async function renderReady(chip: Harness): Promise<UiElement> {
  chip.render();
  await chip.settle();
  return chip.render();
}

function open(chip: Harness, view: UiElement): UiElement {
  const button = findButtons(view)[0];
  assert.ok(button, 'the chip must render a button');
  const onClick = button.props['onClick'];
  assert.equal(typeof onClick, 'function', 'the chip must be clickable');
  (onClick as () => void)();
  return chip.render();
}

test('the client half registers the dock chip and the plugin-page section', () => {
  const { remote } = stubRemote();
  const chip = createChip(remote);
  assert.deepEqual(chip.plugin.inject, ['slots', 'locale']);
  assert.deepEqual(chip.injected, ['conversation.composer.dock', 'plugins.detail.section']);
  assert.equal(chip.registrations.length, 2);
  assert.deepEqual(chip.registrations.map((entry) => entry.options['id']), ['dsh-eval-control', 'dsh-eval-control-status']);
  assert.equal(chip.registrations[1]?.options['locale'], 'dsh.eval-control');
});

test('the chip reports active when the control row is live', async () => {
  const { remote, calls } = stubRemote({
    inventory: {
      ok: true,
      managementAvailable: true,
      value: {
        entries: [row('t', TRANSPORT_MODULE, 'active'), row('c', CONTROL_MODULE, 'active')],
      },
    },
    bundles: {
      ok: true,
      value: [bundle([
        { rowId: 'aeval-broker-transport', moduleName: TRANSPORT_MODULE, entryId: 't' },
        { rowId: 'aeval-eval-control', moduleName: CONTROL_MODULE, entryId: 'c' },
      ])],
    },
  });
  const chip = createChip(remote);
  const view = await renderReady(chip);
  assert.match(textOf(view), /active/);
  const opened = open(chip, view);
  assert.match(textOf(opened), /mode: active/);
  // An active stack needs no next step.
  assert.doesNotMatch(textOf(opened), /AEVAL_CONTROL_CONFIG/);
  assert.deepEqual(calls, ['pluginInventory.list', 'pluginManager.listBundles']);
  assert.deepEqual(chip.missingKeys, []);
});

test('a fresh standalone install shows its mode and one actionable next step', async () => {
  const { remote } = stubRemote({
    inventory: { ok: true, value: { entries: [row('t', TRANSPORT_MODULE, 'active')] } },
    bundles: {
      ok: true,
      value: [bundle([{ rowId: 'aeval-broker-transport', moduleName: TRANSPORT_MODULE, entryId: 't' }])],
    },
  });
  const chip = createChip(remote);
  const view = await renderReady(chip);
  assert.match(textOf(view), /standalone/);
  const opened = open(chip, view);
  const text = textOf(opened);
  assert.match(text, /mode: standalone/);
  assert.match(text, /AEVAL_CONTROL_CONFIG=\/abs\/path\/control-config\.json/);
  assert.match(text, /cordis\.patch\.yml/);
  assert.match(text, /- id: aeval-broker-transport\n {2}config: \{ controlConfigPath: '\/abs\/path\/control-config\.json' \}/);
  // The guidance also names the row a configured patch has to add.
  assert.match(text, /aeval-eval-control/);
  assert.deepEqual(chip.missingKeys, []);
});

test('no composed row reads as not-mounted and points at the Plugins page', async () => {
  const { remote } = stubRemote();
  const chip = createChip(remote);
  const view = await renderReady(chip);
  assert.match(textOf(view), /not-mounted/);
  const text = textOf(open(chip, view));
  assert.match(text, /mode: not-mounted/);
  assert.match(text, /插件」页添加并启用 dsh-eval-control/);
  assert.doesNotMatch(text, /AEVAL_CONTROL_CONFIG/);
  assert.deepEqual(chip.missingKeys, []);
});

test('the host peer-mismatch label from listBundles is surfaced, not re-invented', async () => {
  const { remote } = stubRemote({
    inventory: {
      ok: true,
      value: { entries: [row('t', TRANSPORT_MODULE, 'active'), row('c', CONTROL_MODULE, 'active')] },
    },
    bundles: {
      ok: true,
      value: [bundle([
        { rowId: 'aeval-broker-transport', moduleName: TRANSPORT_MODULE, entryId: 't' },
        { rowId: 'aeval-eval-control', moduleName: CONTROL_MODULE, entryId: 'c' },
      ], {
        error: {
          code: 'incompatible-version',
          incompatible: [{
            name: 'dsh-eval-control',
            version: '0.2.6',
            runtimeVersion: '0.1.6',
            peers: { '@deepseek-ai/dsh': '>=0.2.0-0 <0.3.0-0' },
          }],
        },
      })],
    },
  });
  const chip = createChip(remote);
  const view = await renderReady(chip);
  assert.match(textOf(view), /⚠1/);
  const text = textOf(open(chip, view));
  assert.match(text, /incompatible-version/);
  assert.match(text, /dsh-eval-control@0\.2\.6 rejects @deepseek-ai\/dsh >=0\.2\.0-0 <0\.3\.0-0 on dsh 0\.1\.6/);
  // The chip states where the symptom is visible when it cannot render at all.
  assert.match(text, /插件/);
  assert.deepEqual(chip.missingKeys, []);
});

test('a failed host row is named as a host anomaly', async () => {
  const { remote } = stubRemote({
    inventory: { ok: true, value: { entries: [row('t', TRANSPORT_MODULE, 'failed')] } },
    bundles: {
      ok: true,
      value: [bundle([{ rowId: 'aeval-broker-transport', moduleName: TRANSPORT_MODULE, entryId: 't' }])],
    },
  });
  const chip = createChip(remote);
  const view = await renderReady(chip);
  assert.match(textOf(view), /failed/);
  const text = textOf(open(chip, view));
  assert.match(text, /mode: failed/);
  assert.match(text, /fiber failed/);
  assert.match(text, /stderr/);
  assert.deepEqual(chip.missingKeys, []);
});

test('a missing host channel and a refused inventory call degrade visibly', async () => {
  const absent = createChip({});
  const view = await renderReady(absent);
  assert.match(textOf(view), /宿主通道不可用/);
  assert.match(textOf(open(absent, view)), /mode: no-channel/);

  const { remote } = stubRemote({ inventory: { ok: false, error: { code: 'unauthorized', message: 'nope' } } });
  const refused = createChip(remote);
  const refusedView = await renderReady(refused);
  assert.match(textOf(refusedView), /查询失败: unauthorized: nope/);
});

test('without a bundle channel the chip still identifies its rows by host meta', async () => {
  // Management is unavailable on some deployments; the transport row is a
  // path (`./dist/sandbox_entry.js`), so identity has to come from the host's
  // own display metadata, which names 'aeval'.
  const { remote, calls } = stubRemote({
    manager: false,
    inventory: { ok: true, value: { entries: [row('t', TRANSPORT_MODULE, 'active')] } },
  });
  const chip = createChip(remote);
  const view = await renderReady(chip);
  assert.match(textOf(view), /standalone/);
  assert.deepEqual(calls, ['pluginInventory.list']);
  assert.deepEqual(chip.missingKeys, []);
});

test('the payloads a fresh shipping profile really answers read as standalone', async () => {
  // Captured from the shipping host on this machine: a profile whose only
  // bundle is dsh-eval-control composes one row, and `listBundles` answers
  // this bundle record with the real localized meta and the row name the
  // scratch install produced.
  const fileUrl = 'file:///Users/someone/profiles/probe/node_modules/dsh-eval-control/dist/sandbox_entry.js';
  const { remote } = stubRemote({
    inventory: {
      ok: true,
      managementAvailable: true,
      value: {
        entries: [{
          entryId: 'entry-transport',
          moduleName: fileUrl,
          enabled: true,
          fiberPhase: 'active',
          meta: { title: { en: 'aeval eval control', zh: 'aeval 评测控制' } },
        }],
      },
    },
    bundles: {
      ok: true,
      value: [{
        name: 'dsh-eval-control',
        version: '0.2.6',
        enabled: true,
        installed: true,
        meta: { title: { en: 'aeval eval control', zh: 'aeval 评测控制' } },
        rows: [{ rowId: 'aeval-broker-transport', moduleName: fileUrl, entryId: 'entry-transport' }],
        overrides: [],
      }],
    },
  });
  const chip = createChip(remote);
  const view = await renderReady(chip);
  assert.match(textOf(view), /standalone/);
  assert.match(textOf(open(chip, view)), /mode: standalone[\s\S]*AEVAL_CONTROL_CONFIG/);
  assert.deepEqual(chip.missingKeys, []);
});

test('the plugin-page section renders the same diagnosis for this bundle only', () => {
  const chip = createChip(stubRemote().remote);
  const pkg = {
    name: 'dsh-eval-control',
    version: '0.2.6',
    enabled: true,
    installed: true,
    rows: [{ rowId: 'aeval-broker-transport', moduleName: TRANSPORT_MODULE, entryId: 't', enabled: true, phase: 'active' }],
  };

  // Foreign bundles and row/item subjects get no contribution at all.
  assert.equal(chip.section({ subject: { kind: 'bundle', pkg: { name: 'someone-else' } } }), null);
  assert.equal(chip.section({ subject: { kind: 'row', pkg, row: {} } }), null);
  assert.equal(chip.section({ subject: undefined }), null);

  // The page's own `t` is used when it passes one; the closure binding is the
  // fallback when it does not.
  const pageT = (key: string): string => `page:${key}`;
  const withPageT = textOf(chip.section({ t: pageT, subject: { kind: 'bundle', pkg } }));
  assert.match(withPageT, /page:mode: standalone/);
  assert.match(withPageT, /page:stepTitle/);
  assert.match(withPageT, /page:stepEnv/);

  const withClosureT = textOf(chip.section({ subject: { kind: 'bundle', pkg } }));
  assert.match(withClosureT, /mode: standalone/);
  assert.match(withClosureT, /cordis\.patch\.yml/);
  assert.deepEqual(chip.missingKeys, []);

  // A peer-denied bundle record (rows: [], error label) renders that label.
  const denied = textOf(chip.section({
    subject: {
      kind: 'bundle',
      pkg: {
        ...pkg,
        rows: [],
        error: {
          code: 'incompatible-version',
          incompatible: [{ name: 'dsh-eval-control', version: '0.2.6', runtimeVersion: '0.1.7-rc.1', peers: { '@deepseek-ai/dsh': '>=0.2.0-0 <0.3.0-0' } }],
        },
      },
    },
  }));
  assert.match(denied, /incompatible-version/);
  assert.match(denied, /dsh-eval-control@0\.2\.6 rejects @deepseek-ai\/dsh >=0\.2\.0-0 <0\.3\.0-0 on dsh 0\.1\.7-rc\.1/);
});
