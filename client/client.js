/**
 * Client half of dsh-eval-control: a compact status chip in the composer dock.
 *
 * Read-only by design, and derived entirely from host surfaces that already
 * exist — `pluginInventory/list` for the live Loader rows and
 * `pluginManager/listBundles` for the profile's bundle record and its anomaly
 * label — so the chip never becomes a second source of truth for plugin state.
 *
 * Why those two surfaces:
 * - `pluginInventory/list` rows carry `{ entryId, moduleName, enabled,
 *   fiberPhase, meta }` — the live Loader projection.
 * - A bundle whose peer window DSH refuses is skipped whole: a real host
 *   prints `dsh: skipping profile bundle "dsh-eval-control": …` on stderr and
 *   composes no row at all (measured on a peer-mismatched scratch profile).
 *   `pluginManager/listBundles` still names that bundle and carries
 *   `error: { code: 'incompatible-version', incompatible: [...] }`, which is
 *   the label the sidebar Plugins page renders.
 * - The chip CANNOT render a skipped bundle: `dsh-client-modules` mounts this
 *   client half from the nearest package.json of the Loader entry, so a bundle
 *   that DSH skips mounts no chip at all. The sidebar Plugins page is the
 *   surface that answers "why is nothing here"; this chip repeats the same
 *   host label whenever its own rows are still live, and never invents a
 *   status of its own.
 */
window.__ModuleLoader__.load({
  id: 'dsh-eval-control',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh.eval-control';

    /** Package name of this plugin; also the bundle name in listBundles. */
    const PACKAGE_NAME = 'dsh-eval-control';
    /** Row id of the always-applying transport row (see cordis.patch.yml). */
    const TRANSPORT_ROW_ID = 'aeval-broker-transport';
    /** Row id of the full control row, inserted only by a configured patch. */
    const CONTROL_ROW_ID = 'aeval-eval-control';
    /** Environment variable the transport falls back to for its configuration. */
    const CONFIG_ENV = 'AEVAL_CONTROL_CONFIG';
    /** Example file the guidance points at; the user replaces it with their own. */
    const CONFIG_EXAMPLE = '/abs/path/control-config.json';

    const DICTIONARIES = {
      zh: {
        label: 'aeval 控制',
        title: 'aeval 评测控制状态（只读）',
        loading: '读取中',
        noChannel: '宿主通道不可用',
        error: '查询失败',
        mode: 'mode',
        modeActive: 'active — 控制栈已挂载（run 绑定 / 预算 / descriptor 生效）',
        modeStandalone: 'standalone — 只挂了 transport 行，未绑定控制配置，模型调用不被改写',
        modeNotMounted: 'not-mounted — 本 profile 未组合本插件',
        modeFailed: 'failed — host 半区加载失败',
        modeUnknown: 'unknown — 行已组合但阶段不可判定',
        standaloneIsDesign: 'standalone 是默认设计，不是故障：装完插件不会接管任何模型调用。',
        stepTitle: '下一步：挂上控制栈（任选一条）',
        stepEnv: `导出 ${CONFIG_ENV}=${CONFIG_EXAMPLE}（无需改 patch，重启 profile 后生效）`,
        stepPatch: '或在 profile 的 cordis.patch.yml 补两行（按 id 覆盖 transport 行的 config）：',
        patchBody: `- id: ${TRANSPORT_ROW_ID}\n  config: { controlConfigPath: '${CONFIG_EXAMPLE}' }`,
        controlRowNote: `控制行 ${CONTROL_ROW_ID} 由 aeval runner 写出的 patch 插入（本 bundle 的默认 patch 只插 transport 行）。`,
        stepInstallTitle: '下一步：组合本插件',
        stepInstall: '在侧栏「插件」页添加并启用 dsh-eval-control；组合包带 incompatible-version 异常标签时，DSH 不会加载它的任何一行。',
        stepFailedTitle: '下一步：修好 host 半区',
        stepFailed: 'host 半区加载失败的原因由宿主写在 stderr / profile 日志里；修好后重启 profile，本胶囊会重新读取阶段。',
        anomalies: '宿主报告的异常',
        rows: '行',
        peerHint: 'peer 版本窗口不匹配时 DSH 会跳过整个 bundle：本胶囊那时不会出现，请到侧栏「插件」页看该组合包的异常标签（incompatible-version）。',
        readonly: '只读：本胶囊不启停插件、不改 profile。',
      },
      en: {
        label: 'aeval control',
        title: 'aeval evaluation control status (read-only)',
        loading: 'reading',
        noChannel: 'host channel unavailable',
        error: 'query failed',
        mode: 'mode',
        modeActive: 'active — the control stack is mounted (run binding / budget / descriptor live)',
        modeStandalone: 'standalone — only the transport row is mounted, no control configuration is bound, model calls are not redirected',
        modeNotMounted: 'not-mounted — this profile does not compose the plugin',
        modeFailed: 'failed — the host half failed to load',
        modeUnknown: 'unknown — rows are composed but their phase cannot be classified',
        standaloneIsDesign: 'standalone is the designed default, not a fault: installing the plugin redirects no model call.',
        stepTitle: 'next step: attach the control stack (either one)',
        stepEnv: `export ${CONFIG_ENV}=${CONFIG_EXAMPLE} (no patch edit; takes effect after the profile restarts)`,
        stepPatch: 'or add two lines to the profile cordis.patch.yml (an id override of the transport row config):',
        patchBody: `- id: ${TRANSPORT_ROW_ID}\n  config: { controlConfigPath: '${CONFIG_EXAMPLE}' }`,
        controlRowNote: `The control row ${CONTROL_ROW_ID} is inserted by the patch the aeval runner writes (this bundle's default patch only inserts the transport row).`,
        stepInstallTitle: 'next step: compose the plugin',
        stepInstall: 'add and enable dsh-eval-control on the sidebar Plugins page; when a bundle carries the incompatible-version anomaly label, DSH loads none of its rows.',
        stepFailedTitle: 'next step: repair the host half',
        stepFailed: 'the host writes the reason its half failed to load to stderr / the profile log; fix it and restart the profile — this chip re-reads the phase.',
        anomalies: 'host-reported anomalies',
        rows: 'rows',
        peerHint: 'When the peer version window does not match, DSH skips the whole bundle: this chip will not appear at all then — open the sidebar Plugins page and read that bundle\'s anomaly label (incompatible-version).',
        readonly: 'read-only: this chip never enables, disables, or edits the profile.',
      },
    };

    /** Accept either a bare array or an `{ entries }` / `{ plugins }` envelope. */
    function rowsOf(value) {
      if (Array.isArray(value)) return value;
      if (value && Array.isArray(value.entries)) return value.entries;
      if (value && Array.isArray(value.plugins)) return value.plugins;
      return [];
    }

    /** The Loader specifier of a row, under either host spelling. */
    function moduleNameOf(row) {
      if (!row) return '';
      if (typeof row.moduleName === 'string') return row.moduleName;
      return typeof row.module === 'string' ? row.module : '';
    }

    /** The row's patch id (`listBundles` rows) or Loader entry id. */
    function rowIdOf(row) {
      if (!row) return '';
      if (typeof row.rowId === 'string') return row.rowId;
      return typeof row.id === 'string' ? row.id : '';
    }

    /**
     * The Loader row's fiber phase.
     *
     * `fiberPhase` (the documented `pluginInventory/list` name) is preferred;
     * `phase` is accepted so an older or future spelling still renders. The
     * difference between `null` and `undefined` matters: `null` means the row
     * exists with no live root fiber, `undefined` means the surface did not
     * report a phase at all.
     */
    function phaseOf(row) {
      if (!row) return undefined;
      if (Object.prototype.hasOwnProperty.call(row, 'fiberPhase')) return row.fiberPhase;
      if (Object.prototype.hasOwnProperty.call(row, 'phase')) return row.phase;
      return undefined;
    }

    /** True for a row belonging to this plugin's bundle, by id or module path. */
    function isOurs(text) {
      return text.includes(PACKAGE_NAME) || text.includes(TRANSPORT_ROW_ID) || text.includes(CONTROL_ROW_ID);
    }

    /**
     * Flatten the host's display metadata into one searchable string.
     *
     * `title` and `description` are either a string or a per-language map; the
     * chip only reads them to recognise its own rows when the bundle channel is
     * absent, never to render them.
     */
    function metaTextOf(meta) {
      if (!meta || typeof meta !== 'object') return '';
      const parts = [];
      for (const key of ['title', 'description', 'error']) {
        const value = meta[key];
        if (typeof value === 'string') parts.push(value);
        else if (value && typeof value === 'object') {
          parts.push(Object.values(value).filter((item) => typeof item === 'string').join(' '));
        }
      }
      return parts.join(' ');
    }

    /**
     * The plugin's published meta names 'aeval' as a whole word.
     *
     * This is the fallback identity when `listBundles` is unavailable and the
     * Loader row is a path (`./dist/sandbox_entry.js`) that carries neither the
     * package name nor a row id. The word boundary matters: a profile living
     * under a directory like `…/agenteval/` must not make every row this
     * plugin's.
     */
    function metaNamesAeval(meta) {
      return /\baeval\b/i.test(metaTextOf(meta));
    }

    /** True for the always-applying broker transport row. */
    function isTransport(text) {
      return text.includes('sandbox_entry') || text.includes(TRANSPORT_ROW_ID);
    }

    /**
     * Join the bundle's declared rows with the live inventory.
     *
     * The bundle record is the only surface that names a row that never went
     * live (or was denied); the inventory is the only surface that carries the
     * fiber phase. Rows the profile patch inserted outside the bundle patch —
     * the aeval runner's control row, for one — appear only in the inventory,
     * so both are merged instead of picking one.
     */
    function collectRows(inventoryRows, bundle) {
      const byEntryId = new Map();
      for (const row of inventoryRows) {
        if (row && row.entryId !== undefined && row.entryId !== null) byEntryId.set(row.entryId, row);
      }
      const rows = [];
      const seen = new Set();
      if (bundle && Array.isArray(bundle.rows)) {
        for (const declared of bundle.rows) {
          const live = declared.entryId === undefined ? undefined : byEntryId.get(declared.entryId);
          rows.push({
            rowId: rowIdOf(declared) || rowIdOf(live) || null,
            moduleName: moduleNameOf(declared) || moduleNameOf(live),
            entryId: declared.entryId === undefined ? null : declared.entryId,
            enabled: live ? live.enabled : undefined,
            // Declared but with no live entry: the Loader has no root fiber.
            phase: live ? phaseOf(live) : null,
            meta: (live && live.meta) || declared.meta,
          });
          if (declared.entryId !== undefined) seen.add(declared.entryId);
          if (moduleNameOf(declared) !== '') seen.add(moduleNameOf(declared));
        }
      }
      for (const live of inventoryRows) {
        const moduleName = moduleNameOf(live);
        const rowId = rowIdOf(live);
        if (!isOurs(`${moduleName} ${rowId}`) && !metaNamesAeval(live.meta)) continue;
        if ((live.entryId !== undefined && seen.has(live.entryId)) || (moduleName !== '' && seen.has(moduleName))) continue;
        rows.push({
          rowId: rowId || null,
          moduleName,
          entryId: live.entryId === undefined ? null : live.entryId,
          enabled: live.enabled,
          phase: phaseOf(live),
          meta: live.meta,
        });
      }
      return rows;
    }

    /** Split the plugin's rows into the transport row and the control row. */
    function classify(rows) {
      let transport;
      let control;
      for (const row of rows) {
        const text = `${row.rowId || ''} ${row.moduleName || ''}`;
        if (isTransport(text)) {
          if (transport === undefined) transport = row;
          continue;
        }
        if (control === undefined && (text.includes(CONTROL_ROW_ID) || text.includes(PACKAGE_NAME) || row.moduleName !== '')) control = row;
      }
      return { transport, control };
    }

    /**
     * The current mode, read from the live rows only.
     *
     * `active` requires the control row itself to be live and active: that row
     * is what a resolved control configuration buys (it injects `evalBroker`,
     * which only a configured transport provides), and it is the row that
     * writes the bundle descriptor. A mounted transport alone is `standalone`.
     */
    function modeOf(rows) {
      if (rows.length === 0) return 'not-mounted';
      const { transport, control } = classify(rows);
      if (control && control.phase === 'active') return 'active';
      if (rows.some((row) => row.phase === 'failed')) return 'failed';
      if (transport && transport.phase === 'active') return 'standalone';
      return 'unknown';
    }

    /** A short row label for the popover and the collapsed title. */
    function labelOf(row) {
      return row.rowId || row.moduleName || (row.entryId === null ? '?' : String(row.entryId));
    }

    /** One line describing the incompatible packages a bundle error names. */
    function incompatibleDetail(error) {
      const peers = Array.isArray(error.incompatible) ? error.incompatible : [];
      return peers.map((entry) => {
        const name = entry && typeof entry.name === 'string' ? entry.name : '?';
        const version = entry && typeof entry.version === 'string' ? entry.version : '?';
        const runtime = entry && typeof entry.runtimeVersion === 'string' ? entry.runtimeVersion : '?';
        const ranges = Object.entries((entry && entry.peers) || {})
          .map(([peer, range]) => `${peer} ${String(range)}`)
          .join(' ');
        return `${name}@${version} rejects ${ranges || 'its peers'} on dsh ${runtime}`;
      }).join('; ');
    }

    /**
     * Anomalies the HOST reports, never a locally invented status: the bundle
     * error from `listBundles`, a failed or dead row from the inventory, a row
     * disabled in this profile, and the host's own display-metadata diagnostic.
     */
    function anomaliesOf(rows, bundle) {
      const out = [];
      const error = bundle && bundle.error;
      if (typeof error === 'string' && error !== '') out.push(`bundle ${error}`);
      else if (error && typeof error === 'object') {
        const detail = error.code === 'incompatible-version' ? incompatibleDetail(error) : '';
        out.push(`bundle ${error.code || 'error'}${detail === '' ? '' : ` — ${detail}`}`);
      }
      for (const row of rows) {
        const label = labelOf(row);
        if (row.phase === 'failed') out.push(`${label}: fiber failed`);
        if (row.phase === null && row.enabled !== false) out.push(`${label}: no live fiber`);
        if (row.enabled === false) out.push(`${label}: disabled`);
        if (row.meta && typeof row.meta.error === 'string' && row.meta.error !== '') out.push(`${label}: ${row.meta.error}`);
      }
      return out;
    }

    /** The whole read-only diagnosis, derived from the two host surfaces. */
    function diagnose(inventory, bundle) {
      const rows = collectRows(rowsOf(inventory), bundle);
      return { mode: modeOf(rows), rows, anomalies: anomaliesOf(rows, bundle), bundle: bundle || null };
    }

    /**
     * The same diagnosis from the sidebar Plugins page's own subject.
     *
     * `ui-plugin-manager` describes a bundle as `{ name, enabled, installed,
     * rows: [{ rowId, moduleName, entryId?, enabled, phase, meta? }], error? }`
     * — the rows already carry the Loader phase, so this needs no Remote call.
     * The section contributes to the page the bundle record belongs to, which
     * is what a user opens when "I installed it and nothing happened".
     */
    function rowsFromPage(pkgRows) {
      return (Array.isArray(pkgRows) ? pkgRows : []).map((row) => ({
        rowId: rowIdOf(row) || null,
        moduleName: moduleNameOf(row),
        entryId: row && row.entryId !== undefined ? row.entryId : null,
        enabled: row ? row.enabled : undefined,
        phase: phaseOf(row),
        meta: row ? row.meta : undefined,
      }));
    }

    /** The diagnosis for one page subject, or undefined when it is not ours. */
    function diagnoseSubject(subject) {
      if (!subject || subject.kind !== 'bundle' || !subject.pkg) return undefined;
      const pkg = subject.pkg;
      if (pkg.name !== PACKAGE_NAME) return undefined;
      const rows = rowsFromPage(pkg.rows);
      return { mode: modeOf(rows), rows, anomalies: anomaliesOf(rows, pkg), bundle: pkg };
    }

    /** The sentence that explains one mode. */
    function modeTextOf(t, modeKind) {
      if (modeKind === 'active') return t('modeActive');
      if (modeKind === 'standalone') return t('modeStandalone');
      if (modeKind === 'not-mounted') return t('modeNotMounted');
      if (modeKind === 'failed') return t('modeFailed');
      if (modeKind === 'unknown') return t('modeUnknown');
      if (modeKind === 'no-channel') return t('noChannel');
      return t('loading');
    }

    /**
     * The shared body of the chip popover and the plugin-page section.
     *
     * One builder for both surfaces is the point: the dock chip and the
     * sidebar page can never disagree about the mode, the next step, or which
     * anomalies the host reported.
     */
    function panelFor(t, modeKind, diag) {
      const anomalies = diag ? diag.anomalies : [];
      const panel = [
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

    function createChip(load, t) {
      return function EvalControlChip() {
        const [state, setState] = React.useState({ kind: 'loading' });
        const [open, setOpen] = React.useState(false);
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

        const diag = state.diag;
        let modeKind;
        let short;
        if (state.kind === 'loading') { modeKind = 'loading'; short = t('loading'); }
        else if (state.kind === 'no-channel') { modeKind = 'no-channel'; short = t('noChannel'); }
        else if (state.kind === 'error') { modeKind = 'error'; short = `${t('error')}: ${state.detail}`; }
        else { modeKind = diag.mode; short = diag.mode; }

        const anomalies = diag ? diag.anomalies : [];
        const rows = diag ? diag.rows : [];
        const title = [
          t('title'),
          `${t('mode')}: ${modeKind}`,
          ...rows.map((row) => `${t('rows')} ${labelOf(row)} enabled=${String(row.enabled)} phase=${String(row.phase)}`),
          ...anomalies.map((line) => `! ${line}`),
        ].join('\n');

        const panel = panelFor(t, modeKind, diag);

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
     * The `plugins.detail.section` contributor.
     *
     * Corollary of the chip, not a second diagnosis: same builder, same host
     * facts. The page hands the component `{ t, subject }` and our `subject` is
     * the bundle card the user just enabled; anything that is not this bundle
     * renders nothing.
     */
    function createSection(t) {
      return function EvalControlSection(props) {
        const diagnose = diagnoseSubject(props && props.subject);
        if (diagnose === undefined) return null;
        const pageT = props && typeof props.t === 'function' ? props.t : t;
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
        }, panelFor(pageT, diagnose.mode, diagnose));
      };
    }

    function createAnalyticsView() {
      return function TrajectoryAnalyticsView(props) {
        const analytics = typeof props.useProjection === 'function'
          ? props.useProjection('trajectoryAnalytics')
          : undefined;
        const stats = typeof props.useProjection === 'function'
          ? props.useProjection('sessionStats')
          : undefined;
        const cards = analytics ? [
          ...(stats ? [
            ['已完成轮次', stats.turns],
            ['已完成步骤', stats.steps],
            ['模型耗时', `${stats.llmMs} ms`],
            ['工具耗时', `${stats.toolMs} ms`],
            ['平均首 Token 等待', stats.ttftSteps ? `${Math.round(stats.ttftMs / stats.ttftSteps)} ms` : '暂无样本'],
            ['输出 Token', stats.decodeTokens],
          ] : []),
          ['工具调用', analytics.toolCalls],
          ['显式工具错误', `${analytics.toolErrors} / ${analytics.toolResults}`],
          ['模型重试', analytics.retries],
          ['摘要压缩周期', `${analytics.metricResults?.find((item) => item.metricId === 'compaction.summary_cycles')?.value?.closedCount ?? 0} 次`],
          ['摘要覆盖历史 Token', analytics.compactionShadowedTokens],
          ['历史修剪批次', analytics.prunePasses],
          ['修剪覆盖 Token', analytics.pruneShadowedTokens],
          ['Team 消息投递', `${analytics.deliveredTeamMessages} / ${analytics.queuedTeamMessages}`],
        ] : [];
        const card = (label, value) => h('div', {
          key: label,
          style: { padding: '12px', border: '1px solid color-mix(in srgb, currentColor 18%, transparent)', borderRadius: '8px', minWidth: '130px' },
        }, [
          h('div', { key: 'label', style: { opacity: 0.7, fontSize: '12px' } }, label),
          h('strong', { key: 'value', style: { display: 'block', marginTop: '5px', fontSize: '18px' } }, String(value)),
        ]);
        return h('section', { style: { height: '100%', overflow: 'auto', padding: '20px', color: 'var(--foreground, inherit)' } }, [
          h('h2', { key: 'title', style: { marginTop: 0 } }, '轨迹分析'),
          !analytics
            ? h('p', { key: 'empty', role: 'status' }, '当前会话暂无轨迹分析投影。')
            : h(React.Fragment, { key: 'content' }, [
              h('div', { key: 'cards', style: { display: 'flex', flexWrap: 'wrap', gap: '10px' } }, cards.map(([label, value]) => card(label, value))),
              h('p', { key: 'count', style: { opacity: 0.7, fontSize: '12px' } }, `已观测 ${analytics.eventsSeen} 个事件；下方最多显示最近 ${analytics.recentEvents.length} 条安全摘要。`),
              h('h3', { key: 'events' }, '最近事件'),
              analytics.recentEvents.length === 0
                ? h('p', { key: 'no-events' }, '尚无可展示的事件。')
                : h('ol', { key: 'list', style: { paddingLeft: '1.5em' } }, analytics.recentEvents.slice().reverse().map((event) => h('li', {
                  key: `${event.seq}:${event.type}`,
                  style: { margin: '8px 0', fontFamily: 'var(--font-mono, monospace)', fontSize: '12px' },
                }, [
                  h('span', { key: 'summary' }, `#${event.seq} · ${new Date(event.time).toLocaleTimeString()} · ${event.type}${event.label ? ` · ${event.label}` : ''}`),
                  event.callId && typeof props.inspectCall === 'function'
                    ? h('button', { key: 'inspect', type: 'button', onClick: () => props.inspectCall(event.callId), style: { marginLeft: '8px' } }, '在 Trajectory 定位')
                    : h('span', { key: 'seq', style: { marginLeft: '8px', opacity: 0.65 } }, '请在 Trajectory 按 seq 查看'),
                ]))),
              h('p', { key: 'notice', style: { opacity: 0.65, fontSize: '12px' } }, '轮次、步骤、模型/工具耗时和首 Token 等待来自 DSH sessionStats 投影；本插件指标来自轨迹事件。缺少样本时显示暂无样本。工具参数、消息正文和文件路径不会在此展示。'),
            ]),
        ]);
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
          // The bundle record is optional: management is unavailable on some
          // deployments, and the inventory alone still names live rows.
          let bundle;
          const manager = ctx.remote && ctx.remote.pluginManager;
          if (manager && typeof manager.listBundles === 'function') {
            try {
              const bundles = await manager.listBundles();
              if (bundles && bundles.ok === true) {
                bundle = rowsOf(bundles.value).find((item) => item && item.name === PACKAGE_NAME) || null;
              }
            } catch { /* the chip degrades to the inventory-only view */ }
          }
          const value = result.value;
          const inventoryRows = rowsOf(value);
          const diag = diagnose({ entries: inventoryRows }, bundle);
          return {
            kind: 'ready',
            diag,
            detail: [
              ...diag.rows.map((row) => `${labelOf(row)} enabled=${String(row.enabled)} phase=${String(row.phase)}`),
              ...diag.anomalies.map((line) => `! ${line}`),
            ].join('\n'),
          };
        };

        const Chip = createChip(load, t);
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'dsh-eval-control',
          order: 5,
        }, Chip));
        // The sidebar Plugins page declares this list slot; contributing to it
        // puts the same mode and next step on this bundle's own detail page.
        const Section = createSection(t);
        ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
          name: 'plugins.detail.section',
          id: 'dsh-eval-control-status',
          locale: NS,
          order: 10,
        }, Section));
        const AnalyticsView = createAnalyticsView();
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'dsh-trajectory-analytics',
          order: 20,
          label: () => '轨迹分析',
        }, AnalyticsView));
      },
    };
  },
});
