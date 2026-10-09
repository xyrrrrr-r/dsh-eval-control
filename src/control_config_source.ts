/**
 * Resolve the control configuration from every shape a Cordis row may carry.
 *
 * The aeval runner always writes the complete configuration INLINE into its
 * own patch, so that shape must stay bit-for-bit identical to what
 * ``resolveEvalControlConfig`` receives today: ``kind: 'inline'`` returns the
 * caller's value untouched and the configuration digest is unaffected.
 *
 * A published bundle cannot inline a per-trial configuration, so the same
 * rows also accept a ``controlConfigPath`` reference (a JSON file written by
 * the owner) and fall back to ``AEVAL_CONTROL_CONFIG`` when a row carries no
 * configuration at all. A row that resolves to nothing is STANDALONE: the
 * transport reports its status and mounts nothing, instead of failing
 * activation for every user who installs the plugin without an aeval run.
 */

import { readFileSync } from 'node:fs';

/** Environment variable naming a control-configuration JSON file. */
export const CONTROL_CONFIG_ENV = 'AEVAL_CONTROL_CONFIG';

/** A row that points at an owner-written configuration file. */
export interface ControlConfigReference {
  readonly controlConfigPath: string;
}

/** What a row's configuration resolved to. */
export interface ResolvedControlConfigSource {
  readonly kind: 'inline' | 'file' | 'standalone';
  /** Absolute path of the resolved file, for `kind: 'file'`. */
  readonly configPath?: string;
  /** The configuration document for `inline` / `file`. */
  readonly config?: unknown;
  /** Why the row is standalone, for `kind: 'standalone'`. */
  readonly reason?: string;
}

/**
 * True for a row that names a configuration file.
 *
 * The accepted shape is `{ controlConfigPath, jobTokenPath? }`: `jobTokenPath`
 * is the transport row's token override, and the aeval runner generates its
 * transport row with BOTH keys. The shape is still unambiguous — a full
 * inline configuration can never carry `controlConfigPath`, because
 * ``resolveEvalControlConfig`` rejects unknown keys — so any of these keys
 * outside this set means the row is not a reference.
 */
const REFERENCE_KEYS = new Set(['controlConfigPath', 'jobTokenPath']);

export function isControlConfigReference(value: unknown): value is ControlConfigReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !REFERENCE_KEYS.has(key)) return false;
  }
  const path = (value as { controlConfigPath?: unknown }).controlConfigPath;
  return typeof path === 'string' && path.length > 0;
}

function isEmptyShape(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  return Reflect.ownKeys(value).length === 0;
}

/** Read and parse a control-configuration file, failing loudly on either step. */
export function readControlConfigFile(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`dsh-eval-control: cannot read control config at ${path}: ${String(error)}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`dsh-eval-control: control config at ${path} is not valid JSON: ${String(error)}`);
  }
}

/**
 * Resolve a row's configuration.
 *
 * @param raw - the row's `config` value as the Loader passed it.
 * @param env - environment to consult for {@link CONTROL_CONFIG_ENV}.
 * @throws when a referenced file is missing, unreadable, or not JSON.
 */
export function resolveControlConfigSource(
  raw: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedControlConfigSource {
  if (isControlConfigReference(raw)) {
    return { kind: 'file', configPath: raw.controlConfigPath, config: readControlConfigFile(raw.controlConfigPath) };
  }
  if (isEmptyShape(raw)) {
    const configured = env[CONTROL_CONFIG_ENV];
    if (typeof configured === 'string' && configured.trim() !== '') {
      const configPath = configured.trim();
      return { kind: 'file', configPath, config: readControlConfigFile(configPath) };
    }
    return {
      kind: 'standalone',
      reason: `no control configuration was given and ${CONTROL_CONFIG_ENV} is unset`,
    };
  }
  return { kind: 'inline', config: raw };
}