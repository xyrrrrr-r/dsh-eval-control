import { randomUUID } from 'node:crypto';
import {
  closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { EvalControlConfig, RunBinding } from './config.js';
import { validateIdentifier, validateRunBinding, validateSessionRoot, validateSha256Digest } from './config.js';
import { forkLineageOf, type ForkLineage } from './fork.js';
import { deriveStopReason, isStopReason, type RefusalKind, type StopReason } from './stop_reason.js';

export const BUNDLE_DESCRIPTOR_SCHEMA_VERSION = 2 as const;
export const BUNDLE_DESCRIPTOR_FILENAME = 'bundle_descriptor.json';

export interface BundleDescriptor {
  readonly schema_version: typeof BUNDLE_DESCRIPTOR_SCHEMA_VERSION;
  readonly run: RunBinding;
  readonly trial_id: string;
  readonly session_id: string;
  readonly session_root: string;
  readonly stop_reason: StopReason;
  readonly config_digest: string;
  readonly lineage?: ForkLineage;
}

export function buildBundleDescriptor(config: EvalControlConfig, stopReason: StopReason): BundleDescriptor {
  if (!isStopReason(stopReason)) throw new TypeError('Invalid bundle stop reason');
  const sessionRoot = validateSessionRoot(config.sessionRoot);
  const lineage = forkLineageOf(config);
  return Object.freeze({
    schema_version: BUNDLE_DESCRIPTOR_SCHEMA_VERSION,
    run: validateRunBinding(config.run),
    trial_id: validateIdentifier(config.trialId, 'trialId'),
    session_id: validateIdentifier(config.sessionId, 'sessionId'),
    session_root: sessionRoot,
    stop_reason: stopReason,
    config_digest: validateSha256Digest(config.configDigest, 'configDigest'),
    ...(lineage !== undefined ? { lineage: Object.freeze(lineage) } : {}),
  });
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

function statIfPresent(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (!missing(error)) throw error;
    return undefined;
  }
}

function rejectSymlinkAncestors(path: string): void {
  let current = path;
  while (true) {
    if (statIfPresent(current)?.isSymbolicLink()) throw new Error('Descriptor path must not traverse a symlink');
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function checkTarget(target: string): void {
  const stat = statIfPresent(target);
  if (stat !== undefined && (stat.isSymbolicLink() || !stat.isFile())) {
    throw new Error('Descriptor target must be a regular file, not a symlink or directory');
  }
}

function checkSessionRoot(root: string, sessionRoot: string, requireExisting: boolean): void {
  let current = root;
  for (const part of sessionRoot.split('/')) {
    current = join(current, part);
    const stat = statIfPresent(current);
    if (stat === undefined) {
      if (requireExisting) throw new Error('Completion requires an existing sessionRoot directory');
      return;
    }
    const actual = realpathSync(current);
    const subpath = relative(root, actual);
    if (isAbsolute(subpath) || subpath === '..' || subpath.startsWith(`..${sep}`)) {
      throw new Error('sessionRoot symlink escapes the descriptor directory');
    }
    if (!stat.isDirectory() && !(stat.isSymbolicLink() && lstatSync(actual).isDirectory())) {
      throw new Error('sessionRoot must refer to a directory');
    }
  }
}

export function writeBundleDescriptor(path: string, descriptor: BundleDescriptor): string {
  const sessionRoot = validateSessionRoot(descriptor.session_root);
  if (descriptor.schema_version !== BUNDLE_DESCRIPTOR_SCHEMA_VERSION || !isStopReason(descriptor.stop_reason)) {
    throw new TypeError('Invalid bundle descriptor schema or stop reason');
  }
  const run = validateRunBinding(descriptor.run);
  const trialId = validateIdentifier(descriptor.trial_id, 'trial_id');
  const sessionId = validateIdentifier(descriptor.session_id, 'session_id');
  const configDigest = validateSha256Digest(descriptor.config_digest, 'config_digest');
  const target = resolve(path);
  const parent = dirname(target);
  rejectSymlinkAncestors(parent);
  checkTarget(target);
  mkdirSync(parent, { recursive: true });
  rejectSymlinkAncestors(parent);
  const root = realpathSync(parent);
  const requireExisting = descriptor.stop_reason === 'agent_exit_0' || descriptor.stop_reason === 'agent_claimed_done';
  checkSessionRoot(root, sessionRoot, requireExisting);
  const payload = `${JSON.stringify({
    schema_version: descriptor.schema_version,
    run,
    trial_id: trialId,
    session_id: sessionId,
    session_root: sessionRoot,
    stop_reason: descriptor.stop_reason,
    config_digest: configDigest,
    ...(descriptor.lineage !== undefined ? { lineage: {
      ...(descriptor.lineage.parent_session_id !== undefined ? { parent_session_id: descriptor.lineage.parent_session_id } : {}),
      ...(descriptor.lineage.parent_trial_id !== undefined ? { parent_trial_id: descriptor.lineage.parent_trial_id } : {}),
      ...(descriptor.lineage.fork_step !== undefined ? { fork_step: descriptor.lineage.fork_step } : {}),
    } } : {}),
  }, null, 2)}\n`;
  const temp = `${target}.tmp-${randomUUID()}`;
  let fd: number | undefined;
  let ownedTemp = false;
  try {
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    ownedTemp = true;
    writeFileSync(fd, payload, { encoding: 'utf-8' });
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    rejectSymlinkAncestors(parent);
    if (realpathSync(parent) !== root) throw new Error('Descriptor directory changed during write');
    checkSessionRoot(root, sessionRoot, requireExisting);
    checkTarget(target);
    renameSync(temp, target);
    ownedTemp = false;
    return target;
  } finally {
    try {
      if (fd !== undefined) closeSync(fd);
    } finally {
      if (ownedTemp) rmSync(temp, { force: true });
    }
  }
}

export class RunObservationState {
  private readonly trialSessionId: string;
  private refusal: { readonly kind: RefusalKind } | undefined;
  private currentTurn: number | undefined;
  private lastTurnEndTurn: number | undefined;
  private lastTurnEndKind: string | undefined;
  private turnInProgress = false;
  private sessionDisposed = false;
  private controlLost = false;
  private terminalReason: StopReason | undefined;
  private controlOwner: symbol | undefined;
  private finalizationFailed = false;

  constructor(trialSessionId: string) {
    this.trialSessionId = trialSessionId;
  }

  claimControl(): symbol {
    if (this.controlOwner !== undefined) throw new Error('The transport already has an active control owner');
    const owner = Symbol('control owner');
    this.controlOwner = owner;
    return owner;
  }

  ownsControl(owner: symbol): boolean {
    return this.controlOwner === owner;
  }

  releaseControl(owner: symbol): void {
    if (this.ownsControl(owner)) this.controlOwner = undefined;
  }

  recordFinalizationFailure(): void {
    this.finalizationFailed = true;
    this.recordTerminal('infra_error');
  }

  hasFailedFinalization(): boolean {
    return this.finalizationFailed;
  }

  hasTerminalObservation(): boolean {
    return this.terminalReason !== undefined || this.controlLost || this.refusal !== undefined;
  }

  matchesSession(sessionId: unknown): boolean {
    return sessionId === this.trialSessionId;
  }

  recordRefusal(kind: RefusalKind): void {
    if (!['budget_exhausted', 'identity_mismatch', 'auxiliary_call'].includes(kind)) {
      throw new TypeError('Invalid refusal kind');
    }
    // An identity/control refusal is stronger than budget exhaustion, even after completion.
    if (this.refusal === undefined || this.refusal.kind === 'budget_exhausted') {
      this.refusal = Object.freeze({ kind });
    }
  }

  recordTurnStart(turn: number): void {
    this.validateTurn(turn);
    if (this.terminalReason !== undefined || this.controlLost) return;
    if (this.currentTurn !== undefined && turn <= this.currentTurn) return;
    this.currentTurn = turn;
    this.turnInProgress = true;
    this.lastTurnEndKind = undefined;
    this.lastTurnEndTurn = undefined;
  }

  recordTurnEnd(reasonKind: string, turn?: number): void {
    if (turn !== undefined) this.validateTurn(turn);
    if (this.terminalReason !== undefined || this.controlLost) return;
    // Missing, stale, duplicate, or unpaired ends are not proof of completion.
    if (turn === undefined || this.currentTurn === undefined
      || turn !== this.currentTurn || !this.turnInProgress) return;
    this.lastTurnEndKind = reasonKind;
    this.lastTurnEndTurn = turn;
    this.turnInProgress = false;
  }

  /** Turn completion is only an observation, not a persistence or terminal guarantee. */
  hasCompletedTurn(): boolean {
    return this.currentTurn !== undefined && this.lastTurnEndTurn === this.currentTurn
      && !this.turnInProgress && this.lastTurnEndKind === 'completed';
  }

  /** Structured snapshot for diagnostics (never used for decisions). */
  describe(): Record<string, unknown> {
    return {
      currentTurn: this.currentTurn ?? null,
      lastTurnEndTurn: this.lastTurnEndTurn ?? null,
      lastTurnEndKind: this.lastTurnEndKind ?? null,
      turnInProgress: this.turnInProgress,
      sessionDisposed: this.sessionDisposed,
      controlLost: this.controlLost,
      terminalReason: this.terminalReason ?? null,
      hasRefusal: this.refusal !== undefined,
      finalizationFailed: this.finalizationFailed,
      hasCompletedTurn: this.hasCompletedTurn(),
    };
  }

  recordSessionDisposed(): void {
    this.sessionDisposed = true;
  }

  recordControlLost(): void {
    this.controlLost = true;
  }

  /** Trusted host only: record success after awaited persistence, never from agent content or disposal. */
  recordTerminal(reason: StopReason): void {
    if (!isStopReason(reason)) throw new TypeError('Invalid terminal stop reason');
    // First explicit failure sticks; a later persistence/write failure can always downgrade to infra_error.
    if (reason === 'infra_error' || this.terminalReason === undefined
      || ((this.terminalReason === 'agent_exit_0' || this.terminalReason === 'agent_claimed_done')
        && reason !== 'agent_exit_0' && reason !== 'agent_claimed_done')) {
      this.terminalReason = reason;
    }
  }

  private validateTurn(turn: number): void {
    if (!Number.isSafeInteger(turn) || turn < 0) throw new RangeError('Turn must be a non-negative safe integer');
  }

  stopReason(): StopReason {
    return deriveStopReason({
      ...(this.refusal !== undefined ? { refusal: this.refusal } : {}),
      ...(this.currentTurn !== undefined ? { currentTurn: this.currentTurn } : {}),
      ...(this.lastTurnEndTurn !== undefined ? { lastTurnEndTurn: this.lastTurnEndTurn } : {}),
      ...(this.lastTurnEndKind !== undefined ? { lastTurnEndKind: this.lastTurnEndKind } : {}),
      ...(this.terminalReason !== undefined ? { terminalReason: this.terminalReason } : {}),
      turnInProgress: this.turnInProgress,
      sessionDisposed: this.sessionDisposed,
      controlLost: this.controlLost,
    });
  }
}

export class BundleWriter {
  // Process-local ownership only; callers must release writers when their control is disposed.
  private static readonly owners = new Map<string, symbol>();
  private readonly path: string;
  private readonly pathKey: string;
  private readonly owner = Symbol('descriptor writer');
  private readonly config: EvalControlConfig;
  private written: StopReason | undefined;
  private released = false;
  private observation: RunObservationState | undefined;
  private ownsPlaceholder = false;

  constructor(path: string, config: EvalControlConfig) {
    this.path = resolve(path);
    this.pathKey = process.platform === 'win32' ? this.path.toLowerCase() : this.path;
    this.config = structuredClone(config);
    if (BundleWriter.owners.has(this.pathKey)) throw new Error('Descriptor path already has an active writer owner');
    BundleWriter.owners.set(this.pathKey, this.owner);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    if (BundleWriter.owners.get(this.pathKey) === this.owner) BundleWriter.owners.delete(this.pathKey);
  }

  flush(state: RunObservationState): string {
    if (this.released || BundleWriter.owners.get(this.pathKey) !== this.owner) {
      throw new Error('Descriptor writer is released or no longer owns its path');
    }
    if (!state.matchesSession(this.config.sessionId)) throw new Error('Observation session does not match writer configuration');
    if (this.observation !== undefined && this.observation !== state) throw new Error('Writer observation cannot be replaced');
    const stopReason = state.stopReason();
    const descriptor = buildBundleDescriptor(this.config, stopReason);
    rejectSymlinkAncestors(dirname(this.path));
    checkTarget(this.path);
    let previous: BundleDescriptor | undefined;
    try {
      previous = JSON.parse(readFileSync(this.path, 'utf8')) as BundleDescriptor;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    if (previous !== undefined) {
      const { stop_reason: previousReason, ...previousBinding } = previous;
      const { stop_reason: _reason, ...binding } = descriptor;
      if (!isDeepStrictEqual(previousBinding, binding)) {
        throw new Error('Descriptor path is bound to a different trial, session, run, or configuration');
      }
      const previousSuccess = previousReason === 'agent_exit_0' || previousReason === 'agent_claimed_done';
      const nextSuccess = stopReason === 'agent_exit_0' || stopReason === 'agent_claimed_done';
      const ownsPlaceholder = this.ownsPlaceholder && previousReason === this.written;
      if (!isStopReason(previousReason) || (previousReason !== stopReason && !ownsPlaceholder
        && stopReason !== 'infra_error' && !(previousSuccess && !nextSuccess))) {
        throw new Error('A prior terminal descriptor cannot be overwritten by a new owner');
      }
    }
    const target = writeBundleDescriptor(this.path, descriptor);
    if (previous === undefined && !state.hasTerminalObservation()) this.ownsPlaceholder = true;
    if (state.hasTerminalObservation()) this.ownsPlaceholder = false;
    this.observation = state;
    this.written = stopReason;
    return target;
  }

  get lastWrittenStopReason(): StopReason | undefined {
    return this.written;
  }
}
