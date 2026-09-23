#!/usr/bin/env node
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { SessionId, type SessionHeader, type SessionLogOffset } from '@deepseek-ai/dsh-session';
import { SessionPersistenceNotFoundError, type SessionHandle, type SessionHandleReadResult } from '@deepseek-ai/dsh-session-persistence';
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';

export const MAX_REQUEST_BYTES = 64 * 1024;

const messages = {
  INVALID_REQUEST: 'Invalid reader request or arguments.',
  SOURCE_ROOT_DENIED: 'Source root must be an existing, link-free directory within the allowed base.',
  SESSION_NOT_FOUND: 'Session was not found in the source root.',
  DSH_OPEN_FAILED: 'Official session persistence could not open the session.',
  DSH_READ_FAILED: 'Official session persistence could not read or close the session.',
  SERIALIZATION_FAILED: 'Session response could not be serialized.',
  INTERNAL: 'Internal session reader failure.',
} as const;

export type ReaderErrorCode = keyof typeof messages;

export class SessionReaderError extends Error {
  constructor(readonly code: ReaderErrorCode) {
    super(messages[code]);
    this.name = 'SessionReaderError';
  }
}

export interface ReadSessionOptions {
  readonly allowedBase: string;
  readonly sourceRoot: string;
  readonly sessionId: string;
}

export interface ReadSessionResult extends SessionHandleReadResult {
  readonly header: SessionHeader;
  readonly inheritedEventCount: SessionLogOffset;
}

interface ReaderRequest {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly operation: 'read';
  readonly sessionId: string;
}

function validString(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\uD800-\uDFFF]/u.test(value)
    && Buffer.byteLength(value, 'utf8') <= maxBytes;
}

function validPath(value: unknown): value is string {
  return validString(value, 32 * 1024) && !value.includes('\0') && isAbsolute(value);
}

function isWithin(base: string, target: string): boolean {
  const path = relative(base, target);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function assertDirectoryChain(path: string): void {
  let current = parse(path).root;
  for (const part of ['', ...relative(current, path).split(sep).filter(Boolean)]) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new SessionReaderError('SOURCE_ROOT_DENIED');
  }
}

function checkedSourceRoot(options: ReadSessionOptions): string {
  try {
    const base = resolve(options.allowedBase);
    const root = resolve(options.sourceRoot);
    if (!isWithin(base, root)) throw new SessionReaderError('SOURCE_ROOT_DENIED');
    assertDirectoryChain(base);
    assertDirectoryChain(root);
    const realBase = realpathSync(base);
    const realRoot = realpathSync(root);
    if (!isWithin(realBase, realRoot)) throw new SessionReaderError('SOURCE_ROOT_DENIED');
    const pending = [realRoot];
    while (pending.length > 0) {
      const current = pending.pop()!;
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())
        || !isWithin(realRoot, realpathSync(current))) {
        throw new SessionReaderError('SOURCE_ROOT_DENIED');
      }
      if (stat.isDirectory()) {
        for (const name of readdirSync(current)) pending.push(join(current, name));
      }
    }
    return realRoot;
  } catch {
    throw new SessionReaderError('SOURCE_ROOT_DENIED');
  }
}

export async function readSession(options: ReadSessionOptions): Promise<ReadSessionResult> {
  if (options === null || typeof options !== 'object' || !validPath(options.allowedBase)
    || !validPath(options.sourceRoot) || !validString(options.sessionId, 16 * 1024)) {
    throw new SessionReaderError('INVALID_REQUEST');
  }
  // Let the official backend select the layout and validate each physical encoding.
  for (const compression of ['none', 'zstd'] as const) {
    const root = checkedSourceRoot(options);
    const ctx = new Context();
    let handle: SessionHandle | undefined;
    let failure: SessionReaderError | undefined;
    let result: ReadSessionResult | undefined;
    try {
      ctx.logger.exporter({ export: () => { process.stderr.write('DSH reader: backend diagnostic.\n'); } });
      try {
        const persistence = new JsonlSessionPersistence(ctx, { root, compression });
        handle = await persistence.open(SessionId(options.sessionId), 'read');
      } catch (error) {
        if (error instanceof SessionPersistenceNotFoundError) throw new SessionReaderError('SESSION_NOT_FOUND');
      }
      if (handle !== undefined) {
        checkedSourceRoot(options);
        try {
          const { eventState, events } = await handle.read();
          result = { header: handle.header, inheritedEventCount: handle.inheritedEventCount, eventState, events };
        } catch {
          throw new SessionReaderError('DSH_READ_FAILED');
        }
        checkedSourceRoot(options);
      }
    } catch (error) {
      failure = error instanceof SessionReaderError ? error : new SessionReaderError('INTERNAL');
    } finally {
      try {
        await handle?.close();
      } catch {
        failure ??= new SessionReaderError('DSH_READ_FAILED');
      } finally {
        try {
          await ctx.fiber.dispose();
        } catch {
          failure ??= new SessionReaderError('INTERNAL');
        }
      }
    }
    if (failure !== undefined) throw failure;
    if (result !== undefined) return result;
  }
  throw new SessionReaderError('DSH_OPEN_FAILED');
}

function requestIdOf(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const id: unknown = (value as Record<string, unknown>).requestId;
  return validString(id, 1024) ? id : null;
}

function parseRequest(value: unknown): ReaderRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SessionReaderError('INVALID_REQUEST');
  }
  const request = value as Record<string, unknown>;
  if (Object.keys(request).length !== 4 || request.protocolVersion !== 1 || request.operation !== 'read'
    || requestIdOf(request) === null || !validString(request.sessionId, 16 * 1024)) {
    throw new SessionReaderError('INVALID_REQUEST');
  }
  return request as unknown as ReaderRequest;
}

function parseArguments(argv: readonly string[]): Pick<ReadSessionOptions, 'allowedBase' | 'sourceRoot'> {
  if (argv.length !== 4) throw new SessionReaderError('INVALID_REQUEST');
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag !== '--allowed-base' && flag !== '--source-root') || flags.has(flag) || !validPath(value)) {
      throw new SessionReaderError('INVALID_REQUEST');
    }
    flags.set(flag, value);
  }
  return { allowedBase: flags.get('--allowed-base')!, sourceRoot: flags.get('--source-root')! };
}

async function readRequest(): Promise<unknown> {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      size += bytes.length;
      if (size > MAX_REQUEST_BYTES) throw new SessionReaderError('INVALID_REQUEST');
      chunks.push(bytes);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, size))) as unknown;
  } catch {
    throw new SessionReaderError('INVALID_REQUEST');
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
    const result = await readSession({ ...options, sessionId: request.sessionId });
    try {
      output = JSON.stringify({ protocolVersion: 1, requestId, ok: true, result });
    } catch {
      throw new SessionReaderError('SERIALIZATION_FAILED');
    }
  } catch (error) {
    const failure = error instanceof SessionReaderError ? error : new SessionReaderError('INTERNAL');
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
