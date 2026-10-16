import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import '@deepseek-ai/dsh-session-projection';
import { trajectoryAnalyticsProjection } from './analytics/projection.js';

export const name = 'dsh-trajectory-analytics';
export const inject = ['sessionProjections'];
export const usage = 'Realtime, bounded trajectory analytics from committed DSH session events.';
export const Config = z.object({});

export function apply(ctx: Context, _config: Record<string, never> = {}): void {
  ctx.sessionProjections.register(trajectoryAnalyticsProjection);
  ctx.logger('dsh-trajectory-analytics').info('Realtime trajectory projection registered.');
}

export default apply;
