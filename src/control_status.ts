/**
 * The status surface a standalone installation can report.
 *
 * A profile may mount the transport with no control configuration at all
 * (see ``control_config_source.ts``): nothing is injected and no model call
 * is redirected, but the plugin still says what it is doing instead of
 * failing activation. The service is published by the transport row, which
 * is the only row that always applies.
 */

import type { Context } from '@deepseek-ai/cordis';

/** Service key carrying the current control status. */
export const CONTROL_STATUS_SERVICE = 'evalControlStatus';

/** What the control stack is currently doing in this process. */
export interface EvalControlStatus {
  readonly plugin: 'dsh-eval-control';
  /** `active` mounts the full control stack; `standalone` mounts nothing. */
  readonly mode: 'active' | 'standalone';
  /** Why the row is standalone, when it is. */
  readonly reason?: string;
  /** The configuration file this process resolved, when it did. */
  readonly configPath?: string;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    evalControlStatus: EvalControlStatus;
  }
}

/** Publish the status through the context (never as a plugin return value). */
export function publishControlStatus(ctx: Context, status: EvalControlStatus): void {
  ctx.provide(CONTROL_STATUS_SERVICE, status);
}

/**
 * Read the status without requiring the service to exist: the control row
 * may be inspected in a context where the transport never ran.
 */
export function readControlStatus(ctx: Context): EvalControlStatus | undefined {
  return (ctx as unknown as { evalControlStatus?: EvalControlStatus }).evalControlStatus;
}