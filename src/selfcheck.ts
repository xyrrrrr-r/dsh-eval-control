#!/usr/bin/env node
/**
 * `aeval-dsh-control-selfcheck` — prove an installation's wiring without a
 * run.
 *
 * The command is read-only: it resolves the control configuration, validates
 * it, checks the local paths it names, and (when a broker is reachable) asks
 * the lease for `/info`. It never writes a descriptor, never sends model
 * work, and never prints the job token.
 *
 * Standalone installations (no configuration anywhere) report that mode and
 * exit 0: installing the bundle without an aeval run is a supported state,
 * not a failure.
 */

import { accessSync, constants, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveEvalControlConfig, digestEvalControlConfig, type EvalControlConfig,
} from './config.js';
import { CONTROL_CONFIG_ENV, resolveControlConfigSource } from './control_config_source.js';
import { readJobToken } from './gateway_lease.js';

type Severity = 'ok' | 'warn' | 'fail';

interface Check {
  readonly id: string;
  readonly status: Severity;
  readonly detail: string;
}

interface Report {
  readonly plugin: 'dsh-eval-control';
  readonly mode: 'active' | 'standalone';
  readonly checks: readonly Check[];
}

const USAGE = `usage: aeval-dsh-control-selfcheck [--config <path>] [--json]

Checks that the control stack is ready in this environment.
  --config <path>   control configuration JSON (default: $${CONTROL_CONFIG_ENV})
  --json            machine-readable report on stdout
  --help            this text
`;

function parseArgs(argv: readonly string[]): { configPath?: string; json: boolean } {
  let configPath: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') json = true;
    else if (arg === '--help' || arg === '-h') { process.stdout.write(USAGE); process.exit(0); }
    else if (arg === '--config') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        process.stderr.write('aeval-dsh-control-selfcheck: --config needs a path\n');
        process.exit(2);
      }
      configPath = value;
      i += 1;
    } else {
      process.stderr.write(`aeval-dsh-control-selfcheck: unknown argument ${arg}\n`);
      process.exit(2);
    }
  }
  return configPath === undefined ? { json } : { configPath, json };
}

function nodeCheck(): Check {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  const minor = Number.parseInt(process.versions.node.split('.')[1] ?? '0', 10);
  const supported = (major === 22 && minor >= 19) || major >= 24;
  return {
    id: 'node',
    status: supported ? 'ok' : 'fail',
    detail: `v${process.versions.node}${supported ? '' : ' — the plugin requires ^22.19.0 || >=24.0.0'}`,
  };
}

function fileCheck(id: string, path: string, mode?: number): Check {
  try {
    const stat = statSync(path);
    if (mode !== undefined) accessSync(path, mode);
    return { id, status: 'ok', detail: `${path}${stat.isDirectory() ? '/' : ''}` };
  } catch (error) {
    return { id, status: 'fail', detail: `${path} — ${(error as Error).message}` };
  }
}

function tokenCheck(path: string): Check {
  try {
    readJobToken(path);
    return { id: 'job-token', status: 'ok', detail: `${path} (owned 0600, 64-hex token)` };
  } catch (error) {
    return { id: 'job-token', status: 'fail', detail: `${path} — ${(error as Error).message}` };
  }
}

function sessionRootCheck(config: EvalControlConfig): Check {
  return fileCheck('session-root', join(dirname(config.bundlePath), config.sessionRoot));
}

/**
 * The descriptor directory is created by the owner during deployment, so a
 * self-check that runs first must not call its absence a failure; an
 * existing directory that is not writable is.
 */
function bundleDirCheck(config: EvalControlConfig): Check {
  const dir = dirname(config.bundlePath);
  try {
    if (!statSync(dir).isDirectory()) {
      return { id: 'bundle-dir', status: 'fail', detail: `${dir} is not a directory` };
    }
  } catch {
    return { id: 'bundle-dir', status: 'warn', detail: `${dir} does not exist yet (the owner creates it)` };
  }
  return fileCheck('bundle-dir', dir, constants.W_OK);
}

async function brokerCheck(config: EvalControlConfig): Promise<Check> {
  let token: string;
  try {
    token = readJobToken(config.jobTokenFile);
  } catch (error) {
    return { id: 'broker', status: 'warn', detail: `not probed — job token unreadable (${(error as Error).message})` };
  }
  try {
    const response = await fetch(new URL('/info', config.gatewayUrl), {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return {
        id: 'broker',
        status: 'fail',
        detail: `${config.gatewayUrl}/info -> HTTP ${response.status}`
          + `${response.headers.get('aeval-error-code') === null ? '' : ` (${response.headers.get('aeval-error-code')})`}`,
      };
    }
    const info = await response.json() as { protocol?: unknown; stopReason?: unknown; usedTokens?: unknown };
    return {
      id: 'broker',
      status: 'ok',
      detail: `${config.gatewayUrl}/info -> protocol=${String(info.protocol)}`
        + ` usedTokens=${String(info.usedTokens)}`
        + `${info.stopReason === undefined ? '' : ` stopReason=${String(info.stopReason)} (lease closed)`}`,
    };
  } catch (error) {
    return { id: 'broker', status: 'fail', detail: `${config.gatewayUrl}/info unreachable — ${(error as Error).message}` };
  }
}

function readerCheck(): Check {
  const reader = fileURLToPath(new URL('./session_reader.js', import.meta.url));
  return fileCheck('session-reader', reader);
}

function print(report: Report, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(`dsh-eval-control self-check — mode: ${report.mode}\n`);
  for (const check of report.checks) {
    process.stdout.write(`  [${check.status}] ${check.id.padEnd(15)} ${check.detail}\n`);
  }
  if (report.mode === 'standalone') {
    process.stdout.write(
      `  hint: set --config <path> or ${CONTROL_CONFIG_ENV} to check a configured deployment\n`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const explicit = args.configPath ?? process.env[CONTROL_CONFIG_ENV];
  const checks: Check[] = [nodeCheck(), readerCheck()];

  if (explicit === undefined || explicit.trim() === '') {
    checks.push({ id: 'config', status: 'ok', detail: 'none — standalone (nothing is mounted, no model call is redirected)' });
    print({ plugin: 'dsh-eval-control', mode: 'standalone', checks }, args.json);
    return;
  }
  const configPath = explicit.trim();
  if (!isAbsolute(configPath)) {
    checks.push({ id: 'config', status: 'fail', detail: `${configPath} — must be an absolute path` });
    print({ plugin: 'dsh-eval-control', mode: 'active', checks }, args.json);
    process.exitCode = 1;
    return;
  }

  let config: EvalControlConfig;
  try {
    const source = resolveControlConfigSource({ controlConfigPath: configPath });
    config = resolveEvalControlConfig(source.config);
  } catch (error) {
    checks.push({ id: 'config', status: 'fail', detail: (error as Error).message });
    print({ plugin: 'dsh-eval-control', mode: 'active', checks }, args.json);
    process.exitCode = 1;
    return;
  }

  checks.push({ id: 'config', status: 'ok', detail: `${configPath} (digest ${digestEvalControlConfig(config).slice(0, 12)}…)` });
  checks.push({ id: 'run-binding', status: 'ok', detail: `${config.run.run_id} · trial ${config.trialId} · ${config.provider}/${config.model}` });
  checks.push(tokenCheck(config.jobTokenFile));
  checks.push(sessionRootCheck(config));
  checks.push(bundleDirCheck(config));
  checks.push(await brokerCheck(config));

  const report: Report = { plugin: 'dsh-eval-control', mode: 'active', checks };
  print(report, args.json);
  if (checks.some((check) => check.status === 'fail')) process.exitCode = 1;
}

await main();