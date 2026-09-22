import type { Context } from '@deepseek-ai/cordis';
import { SessionId, type Session } from '@deepseek-ai/dsh-session';
import { scopeOf } from '@deepseek-ai/dsh-scope';
import { isDeepStrictEqual } from 'node:util';
import { EvalControlConfigSchema, resolveEvalControlConfig, type EvalControlConfig } from './config.js';
import { BrokerAdapter, readJobToken } from './gateway_lease.js';
import { BundleWriter, RunObservationState } from './bundle_writer.js';
import { validateForkLineage } from './fork.js';
import { installExperimentVariables } from './variable_inject.js';
import { isStopReason, type StopReason } from './stop_reason.js';

export { EvalControlConfigSchema, resolveEvalControlConfig } from './config.js';
export type { EvalControlConfig } from './config.js';
export { BrokerAdapter, GatewayError, readJobToken } from './gateway_lease.js';
export type { LeaseIdentity, LeaseLimits, BrokerInfo } from './gateway_lease.js';
export { GatewayLease, startHostBroker, writeJobToken } from './host_broker.js';
export type { HostBroker, HostBrokerOptions } from './host_broker.js';
export { agentOptionsOf, installExperimentVariables } from './variable_inject.js';
export { forkLineageOf, forkSessionMeta, validateForkLineage } from './fork.js';
export {
  BundleWriter, RunObservationState, buildBundleDescriptor, writeBundleDescriptor,
  BUNDLE_DESCRIPTOR_SCHEMA_VERSION, BUNDLE_DESCRIPTOR_FILENAME,
} from './bundle_writer.js';
export { STOP_REASONS, deriveStopReason, isStopReason } from './stop_reason.js';
export type { StopReason } from './stop_reason.js';

export interface EvalBrokerTransport {
  readonly config: EvalControlConfig;
  readonly adapter: BrokerAdapter;
  readonly owner: Context;
  readonly observation: RunObservationState;
}

export interface EvalControl {
  // The owner must quiesce the run and finish persistence; disposal notifications are not durability barriers.
  finalize(reason: StopReason, persist: () => Promise<void>): Promise<string>;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    evalBroker: EvalBrokerTransport;
    evalControl: EvalControl;
  }
}

export async function installBrokerTransport(
  owner: Context, rawConfig: unknown, jobToken?: string,
): Promise<EvalBrokerTransport> {
  if (scopeOf(owner) !== undefined) throw new Error('Broker transport requires a global host context');
  const config = resolveEvalControlConfig(rawConfig);
  const adapter = new BrokerAdapter(config, jobToken ?? readJobToken(config.jobTokenFile));
  const info = await adapter.info();
  if (info.stopReason !== undefined) throw new Error('Cannot install a closed broker lease');
  const registration = owner.llm.registerAdapter([config.provider], adapter);
  const transport = Object.freeze({ config, adapter, owner, observation: new RunObservationState(config.sessionId) });
  try {
    owner.provide('evalBroker', transport);
  } catch (error) {
    registration();
    throw error;
  }
  return transport;
}

export const name = 'dsh-eval-control';
export const inject = ['llm', 'tools', 'sessions', 'evalBroker'];
export const Config = EvalControlConfigSchema;

export function apply(ctx: Context, rawConfig: unknown): void {
  const config = resolveEvalControlConfig(rawConfig);
  const transport = ctx.evalBroker;
  if (!isDeepStrictEqual(transport.config, config)) throw new Error('Control and broker configurations differ');
  if (transport.owner.fiber === ctx.fiber) throw new Error('Broker transport must be owned independently of control');
  const observation = transport.observation;
  const writer = new BundleWriter(config.bundlePath, config);
  let session: Session | undefined = ctx.sessions.get(SessionId(config.sessionId));
  let active = true;
  let finalized = false;
  let finalizing = false;
  if (session !== undefined) validateForkLineage(session, config);
  writer.flush(observation);
  installExperimentVariables(ctx, config);

  ctx.on('session/created', (created) => {
    if (!observation.matchesSession(created.id)) return;
    if (session !== undefined && session !== created) {
      observation.recordControlLost();
      writer.flush(observation);
      throw new Error('The trial session instance cannot be replaced');
    }
    validateForkLineage(created, config);
    session = created;
  }, { global: true });
  ctx.on('session/event', (changed, event) => {
    if (changed !== session || finalized) return;
    if (event.type === 'turn/start') observation.recordTurnStart(event.data.turn);
    if (event.type === 'turn/end') observation.recordTurnEnd(event.data.reason.kind, event.data.turn);
  }, { global: true });
  ctx.on('session/disposed', (disposed) => {
    if (disposed !== session || finalized) return;
    observation.recordSessionDisposed();
    writer.flush(observation);
  }, { global: true });
  ctx.effect(() => transport.adapter.observeTerminal((reason) => {
    if (finalized) return;
    observation.recordTerminal(reason);
    writer.flush(observation);
  }));

  ctx.provide('evalControl', {
    async finalize(reason: StopReason, persist: () => Promise<void>): Promise<string> {
      if (!active || finalized || finalizing) throw new Error('Control is inactive or already finalizing');
      if (!isStopReason(reason)) throw new TypeError('Invalid terminal stop reason');
      finalizing = true;
      try {
        if (session === undefined) throw new Error('The trial session was never observed');
        const selectedSession = session;
        validateForkLineage(selectedSession, config);
        const seq = selectedSession.seq;
        if (reason === 'agent_claimed_done' && !observation.hasCompletedTurn()) {
          throw new Error('The current turn has not completed');
        }
        await persist();
        const info = await transport.adapter.info();
        if (!active || session !== selectedSession || selectedSession.seq !== seq) {
          throw new Error('Control or session changed during finalization');
        }
        if (info.stopReason !== undefined) observation.recordTerminal(info.stopReason);
        observation.recordTerminal(reason);
        const path = writer.flush(observation);
        finalized = true;
        return path;
      } catch (error) {
        if (active) {
          observation.recordTerminal('infra_error');
          try {
            writer.flush(observation);
          } catch (writeError) {
            throw new AggregateError([error, writeError], 'Finalization and descriptor write failed');
          }
        }
        throw error;
      } finally {
        finalizing = false;
      }
    },
  });
  ctx.effect(() => () => {
    active = false;
    if (!finalized) {
      observation.recordControlLost();
      writer.flush(observation);
    }
  });
}

const plugin = { name, inject, Config, apply };
export default plugin;
