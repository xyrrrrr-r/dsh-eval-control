import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { ReportShare } from './report_share.js';
import { DiagnosticConfig } from './diagnostic_config.js';
import '@deepseek-ai/dsh-session-projection';
import { trajectoryAnalyticsProjection } from './analytics/projection.js';
import { contextTimelineProjection } from './analytics/contextTimeline.js';

export const name = 'dsh-trajectory-analytics';
export const inject = ['sessionProjections'];
export const usage = 'Realtime, bounded trajectory analytics from committed DSH session events.';
export const Config = z.object({});

export function apply(ctx: Context, _config: Record<string, never> = {}): void {
  ctx.plugin(DiagnosticConfig);
  ctx.plugin(ReportShare);
  ctx.sessionProjections.register(trajectoryAnalyticsProjection);
  ctx.sessionProjections.register(contextTimelineProjection);
  ctx.logger('dsh-trajectory-analytics').info('Realtime trajectory projection registered.');
  ctx.logger('dsh-trajectory-analytics').info('Context timeline projection registered.');
}

// The loader's `unwrapExports` prefers a default export when present; a bare
// `apply` default would drop the named `inject` and break the
// `sessionProjections` dependency guard, so mirror sandbox_entry's whole
// definition object instead.
export default { name, inject, usage, Config, apply };
