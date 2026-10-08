/**
 * Sandbox-side entry point for the aeval control stack.
 *
 * Two Cordis plugins must be mounted inside the sandboxed DSH profile:
 *
 * 1. this entry — installs the broker transport, which registers the DSH
 *    LLM adapter for the experiment's provider so every model call is
 *    routed to the host broker (and refuses to install against a closed
 *    lease);
 * 2. `./index.js` — the control plugin, which binds the same configuration
 *    and writes the bundle descriptor.
 *
 * Cordis resolves the second plugin's `evalBroker` injection only after
 * the first has provided it, so the patch lists this entry first.
 *
 * The patch row names modules relative to the patch file, and node
 * resolves `@deepseek-ai/dsh-*` imports from the surrounding installation,
 * so the deployed directory lives inside the DSH install tree in the
 * sandbox. The control configuration is read from a file the owner
 * uploaded; the job token is read from the path the *config* declares
 * (`jobTokenFile`) unless this entry is given an explicit override.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
import { installBrokerTransport } from './index.js';

export const name = 'aeval-broker-transport';
export const inject = ['llm'];

export interface SandboxEntryConfig {
  /** Absolute path of the control configuration JSON in the sandbox. */
  readonly controlConfigPath: string;
  /** Overrides the config's own `jobTokenFile` when set. */
  readonly jobTokenPath?: string;
}

// schemastery marks a field optional by omitting `.required()`, matching
// the pattern used by EvalControlConfigFields.
export const Config = z.object({
  controlConfigPath: z.string().required(),
  jobTokenPath: z.string(),
});

function readConfig(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`aeval-broker-transport: cannot read control config at ${path}: ${String(error)}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`aeval-broker-transport: control config at ${path} is not valid JSON: ${String(error)}`);
  }
}

export async function apply(ctx: Context, rawConfig: unknown): Promise<void> {
  const entry = rawConfig as SandboxEntryConfig;
  if (entry === null || typeof entry !== 'object' || typeof entry.controlConfigPath !== 'string'
    || entry.controlConfigPath.length === 0) {
    throw new Error('aeval-broker-transport: controlConfigPath is required');
  }
  const config = readConfig(entry.controlConfigPath);
  const token = entry.jobTokenPath === undefined
    ? undefined
    : readFileSync(entry.jobTokenPath, 'utf8').trim();
  // Fails closed: a broker that cannot be reached (or a lease that is
  // already closed) refuses installation instead of letting the run
  // proceed with an unregistered provider route.
  //
  // Must not RETURN the transport: a Cordis plugin's return value is
  // treated as a disposable effect, and an arbitrary object is rejected
  // with "Invalid effect" (found in the real sandbox). The service is
  // published through the context instead.
  // An advisory call (a session-title request) that the lease rejects
  // before dispatch consumed zero tokens, but the session records only that
  // the request was made. Persist the authoritative rejection beside the
  // descriptor so the transcript reducer can tell "refused, provably zero"
  // from "unaccounted model work". Missing or malformed evidence keeps the
  // fail-closed verdict: this file can only ever REMOVE doubt about a
  // refusal the broker itself reported.
  const bundlePath = (config as { bundlePath?: unknown }).bundlePath;
  // Without a descriptor path there is nowhere to attest the record, so the
  // transport installs without a recorder and the reducer stays fail-closed.
  const rejectionLog = typeof bundlePath === 'string' && bundlePath !== ''
    ? join(dirname(bundlePath), 'gateway_refusals.jsonl')
    : undefined;
  // An auxiliary call the policy ALLOWED is the mirror image — real
  // metered model work the session will never settle as an assistant
  // sample. Persist the dispatched call with its broker-reported usage so
  // the reducer can merge it into the accounted totals. Same evidence
  // channel and same fail-closed rule: missing evidence means unaccounted,
  // never silently scored.
  const dispatchLog = typeof bundlePath === 'string' && bundlePath !== ''
    ? join(dirname(bundlePath), 'gateway_aux_dispatches.jsonl')
    : undefined;
  await installBrokerTransport(ctx, config, token,
    rejectionLog === undefined ? undefined : (record) => {
      appendFileSync(rejectionLog, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    },
    dispatchLog === undefined ? undefined : (record) => {
      appendFileSync(dispatchLog, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    });
}

export default { name, inject, Config, apply };
