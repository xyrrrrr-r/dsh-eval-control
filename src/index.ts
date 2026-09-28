import type { Context } from '@deepseek-ai/cordis';
import { SessionId, type Session } from '@deepseek-ai/dsh-session';
import { scopeOf } from '@deepseek-ai/dsh-scope';
import { writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { EvalControlConfigSchema, resolveEvalControlConfig, type EvalControlConfig } from './config.js';
import {
  abortable, BrokerAdapter, readJobToken, type GatewayRejectionRecord,
} from './gateway_lease.js';
import { BundleWriter, RunObservationState } from './bundle_writer.js';
import { validateForkLineage } from './fork.js';
import { installExperimentVariables } from './variable_inject.js';
import { isStopReason, type StopReason } from './stop_reason.js';

export { EvalControlConfigSchema, resolveEvalControlConfig, validateRunBinding, digestEvalControlConfig } from './config.js';
export type { EvalControlConfig, RunBinding } from './config.js';
export { BrokerAdapter, GatewayError, readJobToken } from './gateway_lease.js';
export type { LeaseIdentity, LeaseLimits, BrokerInfo } from './gateway_lease.js';
export { GatewayLease, startHostBroker, writeJobToken, cleanupJobToken, isLoopbackHost } from './host_broker.js';
export type { HostBroker, HostBrokerOptions } from './host_broker.js';
export { createUpstreamAdapter, buildChatCompletionsBody, readUpstreamKey } from './upstream.js';
export type { UpstreamAdapterOptions, ChatCompletionsBody, WireMessage, WireToolCall } from './upstream.js';
export { createProviderCountBound } from './token_bound.js';
export type { ProviderCountBoundOptions, ProviderInputTokenBound } from './token_bound.js';
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
  // The owner must quiesce the run; cancellation stops waiting, not uncooperative persistence.
  finalize(reason: StopReason, persist: (signal: AbortSignal) => Promise<void>, signal?: AbortSignal): Promise<string>;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    evalBroker: EvalBrokerTransport;
    evalControl: EvalControl;
  }
}

export async function installBrokerTransport(
  owner: Context, rawConfig: unknown, jobToken?: string,
  onRejection?: (record: GatewayRejectionRecord) => void,
): Promise<EvalBrokerTransport> {
  if (scopeOf(owner) !== undefined) throw new Error('Broker transport requires a global host context');
  const config = resolveEvalControlConfig(rawConfig);
  const adapter = new BrokerAdapter(config, jobToken ?? readJobToken(config.jobTokenFile), onRejection);
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
  let session: Session | undefined = ctx.sessions.get(SessionId(config.sessionId));
  if (session !== undefined) validateForkLineage(session, config);
  const owner = observation.claimControl();
  let writer: BundleWriter;
  try {
    writer = new BundleWriter(config.bundlePath, config);
  } catch (error) {
    observation.releaseControl(owner);
    throw error;
  }
  const controller = new AbortController();
  let active = true;
  let finalized = false;
  let finalizing = false;
  // In-flight owner finalization, so plugin teardown can wait for it instead
  // of aborting it (see the shutdown barrier in ``dispose``), plus the bound
  // on that wait so a wedged finalization cannot hold shutdown open.
  let pendingFinalization: Promise<void> | undefined;
  const graceEnv = process.env['AEVAL_FINALIZE_GRACE_MS'];
  const configuredGrace = graceEnv === undefined || graceEnv.trim() === '' ? Number.NaN : Number(graceEnv);
  const shutdownGraceMs = Number.isFinite(configuredGrace) && configuredGrace >= 0 ? configuredGrace : 5000;
  const ownsControl = () => active && observation.ownsControl(owner);
  const dispose = async (): Promise<void> => {
    if (!active) return;
    // Shutdown barrier (real-chain D41): a single-turn headless run tears
    // this plugin down the moment its turn ends, while the finalization it
    // started at ``turn/end`` is still awaiting the official session flush
    // and the broker /info round-trip. Aborting there discarded a completed
    // turn's terminal reason and left the descriptor on the fail-closed
    // ``infra_error``. A persistence operation already in flight is allowed
    // to finish, bounded by the grace above; the identity guards inside
    // ``finalize`` still fail closed when the control or session really
    // changed.
    const pending = pendingFinalization;
    if (pending !== undefined) {
      await Promise.race([
        pending.then(() => undefined, () => undefined),
        new Promise<void>((resolve) => { setTimeout(resolve, shutdownGraceMs); }),
      ]);
    }
    if (!active) return;
    active = false;
    controller.abort(new Error('Control or session changed during finalization'));
    try {
      if (observation.ownsControl(owner) && !finalized) {
        if (finalizing) observation.recordFinalizationFailure();
        observation.recordControlLost();
        writer.flush(observation);
      }
    } finally {
      observation.releaseControl(owner);
      writer.release();
    }
  };

  try {
    ctx.effect(() => dispose);
    writer.flush(observation);
    installExperimentVariables(ctx, config);

    ctx.on('session/created', (created) => {
      if (!ownsControl() || finalized || !observation.matchesSession(created.id)) return;
      if (session !== undefined && session !== created) {
        observation.recordControlLost();
        writer.flush(observation);
        throw new Error('The trial session instance cannot be replaced');
      }
      validateForkLineage(created, config);
      session = created;
    }, { global: true });
    // The owner-side finalize: when a turn completes the run has quiesced,
    // so prove durability through the OFFICIAL barrier (the same
    // ``sessions.flush`` entry point dsh-headless uses for its shutdown
    // flush) and record the real terminal reason. Without this the
    // descriptor can only ever report ``infra_error``, because completion
    // alone never proves persistence (P0-5; observed on the real chain: a
    // completed turn still produced stop_reason=infra_error).
    let ownerFinalizeStarted = false;
    const trace: string[] = [];
    const finalizeCompletedTurn = (target: Session): void => {
      // Opt-in deployment mode (``ownerFinalize: true`` in the control
      // config): inside a sandboxed one-shot run the harness process IS
      // the owner — no external caller can reach ``evalControl`` — so it
      // must perform the owner's durable-then-finalize sequence itself.
      // Left OFF by default: the designed contract is that an external
      // owner calls ``finalize`` after quiescing, and a long-running or
      // multi-turn deployment must not have a completed turn seal the
      // descriptor early.
      if (!config.ownerFinalize) return;
      if (ownerFinalizeStarted || finalized || finalizing || !ownsControl()) return;
      ownerFinalizeStarted = true;
      const pending = (async () => {
      try {
        await ctx.evalControl.finalize('agent_claimed_done', async () => {
          await ctx.sessions.flush(target);
        });
      } catch (error) {
        // finalize records the failure on the observation and flushes the
        // descriptor itself; the descriptor must never be silently absent.
        // The reason is written next to the descriptor so it travels back
        // with the agent logs — a swallowed failure left the real chain
        // reporting infra_error with nothing explaining why.
        try {
          // Include the observation's own state: "the current turn has not
          // completed" has several causes (no turn/start seen, an earlier
          // terminal reason suppressing turn recording, control lost), and
          // the real chain could not distinguish them.
          writeFileSync(`${config.bundlePath}.finalize-error.txt`,
            `${error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)}\n`
            + `observation=${JSON.stringify(observation.describe())}\n`
            + `trace=${JSON.stringify(trace)}\n`);
        } catch { /* the descriptor write below is what must not fail */ }
        if (ownsControl() && !finalized) writer.flush(observation);
      }
      })();
      pendingFinalization = pending;
      void pending.then(
        () => { if (pendingFinalization === pending) pendingFinalization = undefined; },
        () => { if (pendingFinalization === pending) pendingFinalization = undefined; },
      );
    };
    ctx.on('session/event', (changed, event) => {
      if (!ownsControl() || changed !== session || finalized) return;
      // Trace the events that decide completion. "The current turn has not
      // completed" has several causes and the live event shape is not the
      // persisted one; without this the failure is unattributable.
      if (event.type === 'turn/start' || event.type === 'turn/end') {
        trace.push(`${new Date().toISOString()} ${event.type} keys=${Object.keys(event.data ?? {}).join(',')} data=${JSON.stringify(event.data)}`);
      }
      if (event.type === 'turn/start') observation.recordTurnStart(event.data.turn);
      if (event.type === 'turn/end') {
        observation.recordTurnEnd(event.data.reason.kind, event.data.turn);
        if (event.data.reason.kind === 'completed') void finalizeCompletedTurn(changed);
      }
    }, { global: true });
    ctx.on('session/disposed', (disposed) => {
      if (!ownsControl() || disposed !== session || finalized) return;
      observation.recordSessionDisposed();
      writer.flush(observation);
    }, { global: true });
    ctx.effect(() => transport.adapter.observeTerminal((reason) => {
      if (!ownsControl()) return;
      // Adapter failures remain authoritative after successful finalization.
      if (finalized && (reason === 'agent_exit_0' || reason === 'agent_claimed_done')) return;
      trace.push(`${new Date().toISOString()} adapter_terminal reason=${reason}`);
      observation.recordTerminal(reason);
      writer.flush(observation);
    }));

    ctx.provide('evalControl', {
      async finalize(reason: StopReason, persist: (signal: AbortSignal) => Promise<void>, cancel?: AbortSignal): Promise<string> {
        if (!ownsControl() || finalized || finalizing) throw new Error('Control is inactive or already finalizing/finalized');
        if (observation.hasFailedFinalization()) throw new Error('Control finalization previously failed; retry is forbidden');
        finalizing = true;
        try {
          const signal = cancel ? AbortSignal.any([controller.signal, cancel]) : controller.signal;
          signal.throwIfAborted();
          if (!isStopReason(reason)) throw new TypeError('Invalid terminal stop reason');
          if (session === undefined) throw new Error('The trial session was never observed');
          const selectedSession = session;
          validateForkLineage(selectedSession, config);
          const seq = selectedSession.seq;
          const assertCurrent = () => {
            signal.throwIfAborted();
            if (!ownsControl() || session !== selectedSession || selectedSession.seq !== seq) {
              throw new Error('Control or session changed during finalization');
            }
          };
          if (reason === 'agent_claimed_done' && !observation.hasCompletedTurn()) {
            throw new Error('The current turn has not completed');
          }
          assertCurrent();
          await abortable(() => persist(signal), signal);
          assertCurrent();
          // Passing a lifecycle signal must not remove the adapter's existing 30-second request bound.
          const infoSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
          const info = await abortable(() => transport.adapter.info(infoSignal), infoSignal);
          assertCurrent();
          if (info.stopReason !== undefined) observation.recordTerminal(info.stopReason);
          observation.recordTerminal(reason);
          const path = writer.flush(observation);
          finalized = true;
          return path;
        } catch (error) {
          if (ownsControl()) {
            observation.recordFinalizationFailure();
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
  } catch (error) {
    try {
      dispose();
    } catch (disposeError) {
      throw new AggregateError([error, disposeError], 'Control installation and cleanup failed');
    }
    throw error;
  }
}

const plugin = { name, inject, Config, apply };
export default plugin;
