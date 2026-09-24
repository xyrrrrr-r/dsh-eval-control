#!/usr/bin/env node
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { SessionAlreadyExistsError, SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence';
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';

export const MAX_STUB_REQUEST_BYTES = 64 * 1024;

const messages = {
  INVALID_REQUEST: 'Invalid session-stub request or arguments.',
  ROOT_DENIED: 'Session root must be an absolute, existing, link-free directory.',
  SESSION_ID_UNUSABLE: 'Session id is not a usable DSH session identity.',
  CWD_UNUSABLE: 'Recorded working directory is not usable.',
  SESSION_EXISTS: 'A durable session already carries this identity.',
  DSH_WRITE_FAILED: 'Official session persistence could not write the stub.',
  SERIALIZATION_FAILED: 'Stub response could not be serialized.',
  INTERNAL: 'Internal session stub failure.',
} as const;

export type StubErrorCode = keyof typeof messages;

export class SessionStubError extends Error {
  constructor(readonly code: StubErrorCode) {
    super(messages[code]);
    this.name = 'SessionStubError';
  }
}

export interface MintTrialSessionOptions {
  readonly root: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly compression?: 'none' | 'zstd';
}

export interface MintTrialSessionResult {
  readonly sessionId: string;
  readonly headerVersion: number;
  readonly events: number;
}

// The same rule the harness applies before it puts the id on a command line
// and before the official reader resolves it as a directory segment.
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

// The backend reports a taken identity as a typed error on one path and as a
// plain materialisation refusal on another; both mean the trial may not write
// over it, so neither is reclassified as a generic write failure.
const occupied = /already exists/iu;

function usableText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    && Buffer.byteLength(value, 'utf8') <= maxBytes;
}

export function assertUsableSessionId(value: unknown): string {
  if (!usableText(value, 256) || !SESSION_ID.test(value)) throw new SessionStubError('SESSION_ID_UNUSABLE');
  return value;
}

function assertRoot(value: unknown): string {
  if (!usableText(value, 32 * 1024) || !isAbsolute(value) || value.includes('\0')) {
    throw new SessionStubError('ROOT_DENIED');
  }
  let stat;
  try {
    stat = lstatSync(value);
  } catch {
    throw new SessionStubError('ROOT_DENIED');
  }
  if (!stat.isDirectory() || realpathSync(value) !== value) throw new SessionStubError('ROOT_DENIED');
  return value;
}

/**
 * Write one adoptable session record through the official persistence backend.
 *
 * The one-shot runner refuses a session identity it cannot find on disk, so a
 * trial that names its own identity up front has to have that identity stored
 * before the run starts. The record is written in a throwaway context against
 * the shared root: the running process then adopts it as any other stored
 * session, and no in-memory session of the same identity is left behind to
 * collide with the adoption.
 */
export async function mintTrialSession(options: MintTrialSessionOptions): Promise<MintTrialSessionResult> {
  const root = assertRoot(options.root);
  const sessionId = assertUsableSessionId(options.sessionId);
  if (!usableText(options.cwd, 32 * 1024) || !isAbsolute(options.cwd)) {
    throw new SessionStubError('CWD_UNUSABLE');
  }
  const compression = options.compression ?? 'zstd';
  if (compression !== 'none' && compression !== 'zstd') throw new SessionStubError('INVALID_REQUEST');

  const context = new Context();
  new SessionStore(context);
  let result: MintTrialSessionResult;
  try {
    const persistence = new JsonlSessionPersistence(context, { root, compression });
    if (!await identityIsFree(persistence, sessionId)) throw new SessionStubError('SESSION_EXISTS');
    const session = context.sessions.create(SessionId(sessionId), { meta: { cwd: options.cwd } });
    let handle;
    try {
      handle = await persistence.create(session.header, { inheritedEventCount: session.inheritedEventCount });
      await handle.append(session.snapshotEvents());
      await handle.flush();
    } finally {
      await handle?.close();
    }
    result = { sessionId, headerVersion: session.header.version, events: session.snapshotEvents().length };
  } catch (error) {
    if (error instanceof SessionStubError) throw error;
    if (error instanceof SessionAlreadyExistsError) throw new SessionStubError('SESSION_EXISTS');
    throw new SessionStubError('DSH_WRITE_FAILED');
  } finally {
    await context.fiber.dispose();
  }
  return result;
}

/**
 * Report whether the official backend has no durable record for this identity.
 *
 * Only a clean not-found frees the identity. Anything else resolves to an
 * existing record — whatever state it is in — and minting over it would
 * replace a real session.
 */
async function identityIsFree(persistence: JsonlSessionPersistence, sessionId: string): Promise<boolean> {
  try {
    const handle = await persistence.open(SessionId(sessionId), 'read');
    await handle.close();
    return false;
  } catch (error) {
    return error instanceof SessionPersistenceNotFoundError;
  }
}

interface StubRequest {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly operation: 'mint';
  readonly sessionId: string;
  readonly cwd: string;
}

function readRequest(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      input += chunk;
      if (Buffer.byteLength(input, 'utf8') > MAX_STUB_REQUEST_BYTES) {
        input = '';
        reject(new SessionStubError('INVALID_REQUEST'));
        process.stdin.destroy();
      }
    });
    process.stdin.once('end', () => resolve(input));
    process.stdin.once('error', () => reject(new SessionStubError('INVALID_REQUEST')));
  });
}

function parseRequest(value: unknown): { requestId: string; sessionId: string; cwd: string } {
  if (typeof value !== 'string') throw new SessionStubError('INVALID_REQUEST');
  let envelope: Partial<StubRequest> | null;
  try {
    envelope = JSON.parse(value) as Partial<StubRequest> | null;
  } catch {
    throw new SessionStubError('INVALID_REQUEST');
  }
  if (!envelope || typeof envelope !== 'object' || typeof envelope.requestId !== 'string'
    || envelope.protocolVersion !== 1 || envelope.operation !== 'mint') {
    throw new SessionStubError('INVALID_REQUEST');
  }
  const sessionId = assertUsableSessionId(envelope.sessionId);
  if (!usableText(envelope.cwd, 32 * 1024)) throw new SessionStubError('CWD_UNUSABLE');
  return { requestId: envelope.requestId, sessionId, cwd: envelope.cwd };
}

function parseArguments(argv: readonly string[]): { root: string; compression?: 'none' | 'zstd' } {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined || flags.has(flag)) {
      throw new SessionStubError('INVALID_REQUEST');
    }
    flags.set(flag, value);
  }
  const root = flags.get('--root');
  if (root === undefined) throw new SessionStubError('INVALID_REQUEST');
  const compression = flags.get('--compression');
  if (compression !== undefined && compression !== 'none' && compression !== 'zstd') {
    throw new SessionStubError('INVALID_REQUEST');
  }
  return { root, ...(compression !== undefined ? { compression } : {}) };
}

function requestIdOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const envelope = JSON.parse(value) as Partial<StubRequest> | null;
    return typeof envelope?.requestId === 'string' ? envelope.requestId : null;
  } catch {
    return null;
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let requestId: string | null = null;
  let output: string;
  let exitCode = 0;
  try {
    const value = await readRequest();
    requestId = requestIdOf(value);
    const request = parseRequest(value);
    const options = parseArguments(argv);
    const result = await mintTrialSession({ ...options, sessionId: request.sessionId, cwd: request.cwd });
    try {
      output = JSON.stringify({ protocolVersion: 1, requestId, ok: true, result });
    } catch {
      throw new SessionStubError('SERIALIZATION_FAILED');
    }
  } catch (error) {
    const failure = error instanceof SessionStubError ? error : new SessionStubError('INTERNAL');
    output = JSON.stringify({ protocolVersion: 1, requestId, ok: false, error: { code: failure.code, message: failure.message } });
    exitCode = 1;
  }
  process.stdout.write(`${output}\n`);
  return exitCode;
}

function isMain(): boolean {
  try {
    return process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = await main();
