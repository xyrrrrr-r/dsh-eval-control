import { SessionId, type Session } from '@deepseek-ai/dsh-session';
import type { EvalControlConfig } from './config.js';

export interface ForkLineage {
  readonly parent_session_id?: string;
  readonly parent_trial_id?: string;
  readonly fork_step?: number;
}

export function forkLineageOf(config: EvalControlConfig): ForkLineage | undefined {
  const lineage = config.lineage;
  if (lineage === undefined) return undefined;
  return {
    ...(lineage.parentSessionId !== undefined ? { parent_session_id: lineage.parentSessionId } : {}),
    ...(lineage.parentTrialId !== undefined ? { parent_trial_id: lineage.parentTrialId } : {}),
    ...(lineage.forkStep !== undefined ? { fork_step: lineage.forkStep } : {}),
  };
}

export function forkSessionMeta(config: EvalControlConfig): { parentSession: SessionId } | undefined {
  if (config.lineage?.parentSessionId === undefined) return undefined;
  return { parentSession: SessionId(config.lineage.parentSessionId) };
}

/** Validate the owner's selected session; never create sessions or append lineage events. */
export function validateForkLineage(session: Session, config: EvalControlConfig): void {
  if (session.id !== config.sessionId) {
    throw new Error('dsh-eval-control: session id does not match configured sessionId');
  }
  if (session.header.parentSession !== config.lineage?.parentSessionId) {
    throw new Error('dsh-eval-control: session parentSession does not match configured fork lineage');
  }
}
