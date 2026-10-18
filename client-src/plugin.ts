/**
 * The client half's plugin object: locale dictionaries, the composer-dock
 * chip, the plugin-page section, and the conversation.view dashboard. Slot
 * ids/orders and the inject list are pinned by test/client_chip.test.ts.
 */
import { DICTIONARIES, NS } from './i18n.js';
import { createChip, createSection, createLoader } from './chip.js';
import { createDashboardView } from './dashboard.js';
import { injectStyles } from './styles.js';
import type { ClientContext } from './types.js';

export function createPlugin(): {
  inject: string[];
  apply: (ctx: ClientContext) => void;
} {
  return {
    inject: ['slots', 'locale', 'remote', 'remote.pluginInventory', 'remote.pluginManager', 'connection', 'sessions'],
    apply(ctx: ClientContext): void {
      ctx.effect?.(() => {
        ctx.locale.register(NS, DICTIONARIES);
      });
      injectStyles();

      const t = ctx.locale.bind(NS);
      const Chip = createChip(createLoader(ctx), t);
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

      const AnalyticsView = createDashboardView(ctx);
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'dsh-trajectory-analytics',
        order: 20,
        label: () => '轨迹分析',
      }, AnalyticsView));
    },
  };
}
