/**
 * The `contextTimeline` projection: PRD §3.1–§3.5's data layer.
 *
 * Everything here is a pure fold over committed session events, mirroring the
 * fixed-density heuristic estimator of the host's `dsh-token-meter`
 * (`CHARS_PER_TOKEN = 4`, `BLOCK_OVERHEAD = 4`) so our composition totals stay
 * comparable with the host's `contextBreakdown` projection. The wire view
 * carries aggregate token counts and bounded content excerpts for the local
 * detail views. Historical compaction snapshots cap nodes and preview length.
 *
 * Data sources folded:
 * - Surface composition (six PRD segments) from surface append/replace ops.
 * - Per-step usage snapshots from `assistant/message` `usage` (the anchor
 *   semantics of the token meter: a usage sample is stamped BEFORE the same
 *   event joins the surface, so it reflects the surface its request saw).
 * - Message-level token ledger (PRD §3.3): every surface append priced and
 *   bounded; the §3.5 "injection" view is the client-side filter over the
 *   same rows (non-direct origins, excluding assistant output).
 * - Compaction events: `compaction/summary`/`compaction/prune` shadow prices
 *   paired with the immediately following surface replace (before/after/
 *   reclaimed/ratio), elapsed from `compaction/start`→`compaction/end`.
 * - Tool distribution from `tool/call` names and `tool/result` errors.
 * - The context window limit from `request/context`.
 */
import { z } from 'zod';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import { isSurfaceEvent, type SessionEvent } from '@deepseek-ai/dsh-session';
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm';

export interface ContextTimelineStep {
  turn: number;
  step: number;
  seq: number;
  timeMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  /** Surface total (this projection's estimate) the request saw. */
  surfaceTokens: number;
}

export interface ContextTimelineInjection {
  seq: number;
  timeMs: number;
  kind: 'user' | 'assistant' | 'tool-result' | 'system' | 'developer';
  /** `source.kind` of the producing message; `'user'` marks a direct human prompt. */
  sourceKind: string;
  toolName: string | null;
  tokens: number;
  turn: number | null;
  /** Bounded content excerpt (1000 chars) for the §3.3 detail panel. */
  preview: string;
  /** Token split (PRD §3.3 Token 分布): plain text / tool-call blocks / file-image structure. */
  textTokens: number;
  toolCallTokens: number;
  fileTokens: number;
  /** Model-generated output tokens (assistant rows carry request usage), else null. */
  outputTokens: number | null;
  /** Estimated context total (messages only) right AFTER this message joined. */
  cumulativeTokens: number;
  /** Trajectory locator: tool results carry their own callId; assistant messages
   * carry the first tool-call block's id (§3.3 关联事件 jump). */
  callId: string | null;
  callTool: string | null;
}

export interface CompactionSnapshot {
  nodeCount: number;
  truncated: boolean;
  nodes: Array<{ seq: number; label: string; tokens: number; preview: string; changed: boolean }>;
}
export interface CompactionDetail {
  trigger: 'manual' | 'unknown';
  algorithm: string;
  summary: string;
  before: CompactionSnapshot;
  after: CompactionSnapshot | null;
}

export interface ContextTimelineCompaction {
  detail?: CompactionDetail | undefined;
  seq: number;
  timeMs: number;
  id: string;
  kind: 'summary' | 'prune';
  beforeTokens: number | null;
  afterTokens: number | null;
  reclaimedTokens: number | null;
  reclaimRatio: number | null;
  elapsedMs: number | null;
  turn: number | null;
}

export interface ContextTimelineSurface {
  totalTokens: number;
  systemPrompt: number;
  conversation: number;
  toolResults: number;
  toolDefinitions: number;
  fileContents: number;
  compactionSummary: number;
  other: number;
}

/** One surface node's bounded excerpt (PRD §3.2 详细列表「查看内容」). */
export interface ContextTimelineSegmentNode {
  seq: number;
  label: string;
  tokens: number;
  preview: string;
  /** Turn the node belongs to (matches the Trajectory view's turn grouping). */
  turn: number | null;
  /** Tool-call id when this node is locatable in the host Trajectory view
   * (tool results carry their own callId; assistant messages carry the first
   * tool-call block's id). Null when no locator exists (user/system/summary). */
  callId: string | null;
  /** The tool name the locator jumps to (assistant messages: the first
   * tool-call's name — the jump lands on that call row, not the prose row). */
  callTool: string | null;
}

/** A composition segment with its (bounded) content excerpts. */
export interface ContextTimelineSegment {
  segment: 'systemPrompt' | 'conversation' | 'toolDefinitions' | 'toolResults' | 'fileContents' | 'compactionSummary' | 'other';
  tokens: number;
  /** Total nodes feeding this segment (the excerpt list may be truncated). */
  nodeCount: number;
  nodes: ContextTimelineSegmentNode[];
}

export interface ContextTimelineView {
  contextWindow: number | null;
  provider: string | null;
  model: string | null;
  surface: ContextTimelineSurface;
  steps: ContextTimelineStep[];
  injections: ContextTimelineInjection[];
  injectionTotals: { count: number; tokens: number };
  compactions: ContextTimelineCompaction[];
  compactionTotals: { count: number; reclaimedTokens: number; elapsedMs: number };
  tools: Array<{ name: string; calls: number; errors: number }>;
  segments: ContextTimelineSegment[];
}

export interface ContextTimelineState {
  nodes: Array<{
    seq: number;
    kind: 'system' | 'conversation' | 'tool-result' | 'compaction-summary' | 'other';
    textTokens: number;
    fileTokens: number;
    label: string;
    preview: string;
    turn: number | null;
    callId: string | null;
    callTool: string | null;
  }>;
  toolsTokens: number;
  contextWindow: number | null;
  provider: string | null;
  model: string | null;
  steps: ContextTimelineStep[];
  injections: ContextTimelineInjection[];
  injectionCount: number;
  injectionTokens: number;
  compactions: ContextTimelineCompaction[];
  compactionCount: number;
  reclaimedTokens: number;
  compactionElapsedMs: number;
  tools: Array<{ name: string; calls: number; errors: number }>;
  toolNameByCallId: Array<[string, string]>;
  compactionStarts: Array<[string, number, number | null]>;
  pendingClaim: { id: string; index: number; start: number; end: number } | null;
  /** Bounded excerpt of the latest request/header tool schemas. */
  toolsPreview: string;
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    contextTimeline: ContextTimelineView;
  }
  interface SessionProjectionStateMap {
    contextTimeline: ContextTimelineState;
  }
}

/* ------------------------------------------------------------------ */
/* Heuristic estimator — mirrors dsh-token-meter's fixed pricing.      */
/* ------------------------------------------------------------------ */

const CHARS_PER_TOKEN = 4;
const BLOCK_OVERHEAD = 4;

function priceText(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
}

function priceJson(json: string): number {
  return BLOCK_OVERHEAD + Math.ceil(json.length / CHARS_PER_TOKEN);
}

/** Price content blocks, splitting file/image structural tokens and tool-call
 * block tokens from plain text (PRD §3.3 Token 分布). */
function estimateContent(blocks: readonly ContentBlock[]): { textTokens: number; toolCallTokens: number; fileTokens: number } {
  let textTokens = 0;
  let toolCallTokens = 0;
  let fileTokens = 0;
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        textTokens += priceText(block.text);
        break;
      case 'tool-call':
        toolCallTokens += Math.ceil(block.name.length / CHARS_PER_TOKEN)
          + Math.ceil(block.arguments.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
        break;
      case 'image': {
        const { offloaded: _offloaded, ...reference } = block;
        fileTokens += priceJson(JSON.stringify(reference));
        break;
      }
      default:
        textTokens += priceJson(JSON.stringify(block));
        break;
    }
  }
  return { textTokens, toolCallTokens, fileTokens };
}

/** Price one model-visible message (any role) under the fixed heuristic. */
function estimateMessage(message: Message): { textTokens: number; toolCallTokens: number; fileTokens: number } {
  if (message.role === 'system') {
    if (message.content.length === 0) return { textTokens: 0, toolCallTokens: 0, fileTokens: 0 };
    let characters = 0;
    for (const block of message.content) {
      characters += block.type === 'text' ? block.text.length : JSON.stringify(block).length;
    }
    return { textTokens: Math.ceil(characters / CHARS_PER_TOKEN) + 4, toolCallTokens: 0, fileTokens: 0 };
  }
  const { textTokens, toolCallTokens, fileTokens } = estimateContent(message.content);
  return { textTokens: textTokens + 4, toolCallTokens, fileTokens };
}

/** Price the tool-schema part of a request header. */
function estimateToolsTokens(event: SessionEvent): number | null {
  if (event.type !== 'request/header') return null;
  const tools = event.data.header.tools;
  if (tools === undefined || tools.length === 0) return 0;
  return Math.ceil(JSON.stringify(tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
}

/* ------------------------------------------------------------------ */
/* Bounded content excerpts (PRD §3.2 详细列表 / 查看内容).             */
/* ------------------------------------------------------------------ */

const PREVIEW_CHARS = 200;
const MAX_SEGMENT_NODES = 24;

/** One-line bounded excerpt of a model-visible message's content. Tool calls
 * that fall out of the window still get a trailing marker so the excerpt never
 * hides that the message issued calls. */
function previewOf(message: Message, cap = PREVIEW_CHARS): string {
  const parts: string[] = [];
  const toolNames: string[] = [];
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        parts.push(block.text);
        break;
      case 'tool-call':
        toolNames.push(block.name);
        parts.push(`${block.name}(${block.arguments})`);
        break;
      case 'image': {
        const { offloaded: _offloaded, ...reference } = block;
        parts.push(JSON.stringify(reference));
        break;
      }
      default:
        parts.push(JSON.stringify(block));
        break;
    }
  }
  const collapsed = parts.join(' ⏐ ').replace(/\s+/g, ' ').trim();
  if (collapsed.length > cap) {
    const suffix = toolNames.length > 0 ? `…［含工具调用：${toolNames.join('、')}］` : '…';
    return `${collapsed.slice(0, Math.max(0, cap - suffix.length))}${suffix}`;
  }
  return collapsed;
}

/** Human label for one surface node: the tool name, else the source kind. */
function labelOf(event: SessionEvent, message: Message, state: ContextTimelineState): string {
  if (event.type === 'tool/result') {
    const callId = String((message as { toolCallId?: unknown }).toolCallId ?? '');
    return state.toolNameByCallId.find(([id]) => id === callId)?.[1] ?? 'tool';
  }
  return message.source.kind;
}

/** The Trajectory locator for a node: its own toolCallId (tool results) or the
 * first tool-call block's id (assistant messages that issued calls). The host
 * Trajectory view matches BOTH shapes, so either lands on the exact node. */
function callIdOf(event: SessionEvent, message: Message): { callId: string | null; callTool: string | null } {
  if (event.type === 'tool/result') {
    const callId = (message as { toolCallId?: unknown }).toolCallId;
    return callId === undefined || callId === null
      ? { callId: null, callTool: null }
      : { callId: String(callId), callTool: null };
  }
  if (event.type === 'assistant/message') {
    for (const block of message.content) {
      if (block.type === 'tool-call') return { callId: String(block.id), callTool: block.name };
    }
  }
  return { callId: null, callTool: null };
}

/** The turn a surface event belongs to (assistant/tool results carry one). */
function turnOf(event: SessionEvent): number | null {
  const data = event.data as { turn?: unknown };
  return typeof data.turn === 'number' ? data.turn : null;
}

/** Bounded excerpt of the request-header tool schemas. */
function toolsPreviewOf(event: SessionEvent): string | null {
  if (event.type !== 'request/header') return null;
  const tools = event.data.header.tools;
  if (tools === undefined || tools.length === 0) return '';
  const collapsed = JSON.stringify(tools).replace(/\s+/g, ' ');
  return collapsed.length > PREVIEW_CHARS * 2 ? `${collapsed.slice(0, PREVIEW_CHARS * 2)}…` : collapsed;
}

/** The per-segment node excerpts for the wire view (PRD §3.2 详细列表). */
function segmentsOf(state: ContextTimelineState): ContextTimelineSegment[] {
  const total = (nodes: ContextTimelineState['nodes'], tokensOf: (node: ContextTimelineState['nodes'][number]) => number): number => nodes.reduce((sum, node) => sum + tokensOf(node), 0);
  const excerpt = (nodes: ContextTimelineState['nodes'], tokensOf: (node: ContextTimelineState['nodes'][number]) => number): { tokens: number; nodeCount: number; nodes: ContextTimelineSegmentNode[] } => {
    const priced = nodes.filter((node) => tokensOf(node) > 0)
      .map((node) => ({ seq: node.seq, label: node.label, tokens: tokensOf(node), preview: node.preview, turn: node.turn, callId: node.callId, callTool: node.callTool }));
    return {
      tokens: total(nodes, tokensOf),
      nodeCount: priced.length,
      nodes: priced.length > MAX_SEGMENT_NODES ? priced.slice(priced.length - MAX_SEGMENT_NODES) : priced,
    };
  };
  const all = (node: ContextTimelineState['nodes'][number]): number => node.textTokens + node.fileTokens;
  const text = (node: ContextTimelineState['nodes'][number]): number => node.textTokens;
  const files = (node: ContextTimelineState['nodes'][number]): number => node.fileTokens;
  const kind = (k: ContextTimelineState['nodes'][number]['kind']) => state.nodes.filter((node) => node.kind === k);

  const definitions: ContextTimelineSegmentNode[] = state.toolsTokens > 0
    ? [{ seq: 0, label: 'request/header.tools', tokens: state.toolsTokens, preview: state.toolsPreview, turn: null, callId: null, callTool: null }]
    : [];

  return [
    { segment: 'systemPrompt', ...excerpt(kind('system'), all) },
    { segment: 'conversation', ...excerpt(kind('conversation'), text) },
    { segment: 'toolDefinitions', tokens: state.toolsTokens, nodeCount: definitions.length, nodes: definitions },
    { segment: 'toolResults', ...excerpt(kind('tool-result'), text) },
    { segment: 'fileContents', ...excerpt(state.nodes, files) },
    { segment: 'compactionSummary', ...excerpt(kind('compaction-summary'), all) },
    { segment: 'other', ...excerpt(kind('other'), all) },
  ];
}

/* ------------------------------------------------------------------ */
/* Bounded-collection helpers.                                         */
/* ------------------------------------------------------------------ */

const MAX_STEPS = 256;
const MAX_INJECTIONS = 64;
const MAX_COMPACTIONS = 32;
const MAX_TOOLS = 128;
const MAX_CALL_IDS = 512;
const MAX_COMPACTION_STARTS = 16;

function pushBounded<T>(list: T[], item: T, cap: number): T[] {
  const next = [...list, item];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

function setMapEntry(entries: Array<[string, string]>, key: string, value: string, cap: number): Array<[string, string]> {
  const next = entries.filter(([k]) => k !== key);
  next.push([key, value]);
  return next.length > cap ? next.slice(next.length - cap) : next;
}

function startTimeEntries(entries: Array<[string, number, number | null]>, key: string, value: number, turn: number | null): Array<[string, number, number | null]> {
  const next = entries.filter(([k]) => k !== key);
  next.push([key, value, turn]);
  return next.length > MAX_COMPACTION_STARTS ? next.slice(next.length - MAX_COMPACTION_STARTS) : next;
}

/* ------------------------------------------------------------------ */
/* Surface fold.                                                       */
/* ------------------------------------------------------------------ */

interface NodeKind { kind: ContextTimelineState['nodes'][number]['kind'] }

function kindOfEvent(event: SessionEvent & { type: string }): NodeKind['kind'] {
  switch (event.type) {
    case 'system/message': return 'system';
    case 'developer/message': return 'other';
    case 'user/message': return 'conversation';
    case 'assistant/message': return 'conversation';
    case 'tool/result': return 'tool-result';
    default: return 'other';
  }
}

function surfaceTotalsOf(state: ContextTimelineState): ContextTimelineSurface {
  let systemPrompt = 0;
  let conversation = 0;
  let toolResults = 0;
  let fileContents = 0;
  let compactionSummary = 0;
  let other = 0;
  for (const node of state.nodes) {
    const total = node.textTokens + node.fileTokens;
    switch (node.kind) {
      case 'system': systemPrompt += total; break;
      case 'conversation': conversation += node.textTokens; fileContents += node.fileTokens; break;
      case 'tool-result': toolResults += node.textTokens; fileContents += node.fileTokens; break;
      case 'compaction-summary': compactionSummary += total; break;
      default: other += total; break;
    }
  }
  return {
    totalTokens: systemPrompt + conversation + toolResults + fileContents + compactionSummary + other + state.toolsTokens,
    systemPrompt,
    conversation,
    toolResults,
    toolDefinitions: state.toolsTokens,
    fileContents,
    compactionSummary,
    other,
  };
}

function withToolRow(
  tools: ContextTimelineState['tools'],
  name: string,
  apply: (row: { calls: number; errors: number }) => { calls: number; errors: number },
): ContextTimelineState['tools'] {
  const index = tools.findIndex((row) => row.name === name);
  if (index < 0) {
    const row = apply({ calls: 0, errors: 0 });
    const next = [...tools, { name, calls: Math.max(0, row.calls), errors: Math.max(0, row.errors) }];
    return next.length > MAX_TOOLS ? next.slice(next.length - MAX_TOOLS) : next;
  }
  const next = [...tools];
  const current = next[index]!;
  next[index] = { name, ...apply({ calls: current.calls, errors: current.errors }) };
  return next;
}

/* ------------------------------------------------------------------ */
/* State schema (persisted projection cache contract).                 */
/* ------------------------------------------------------------------ */

const stepSchema = z.object({
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  timeMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().nullable(),
  cacheWriteTokens: z.number().int().nonnegative().nullable(),
  surfaceTokens: z.number().int().nonnegative(),
}).strict();

const injectionSchema = z.object({
  seq: z.number().int().nonnegative(),
  timeMs: z.number().nonnegative(),
  kind: z.enum(['user', 'assistant', 'tool-result', 'system', 'developer']),
  sourceKind: z.string(),
  toolName: z.string().nullable(),
  tokens: z.number().int().nonnegative(),
  turn: z.number().int().nonnegative().nullable(),
  preview: z.string(),
  textTokens: z.number().int().nonnegative(),
  toolCallTokens: z.number().int().nonnegative(),
  fileTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cumulativeTokens: z.number().int().nonnegative(),
  callId: z.string().nullable(),
  callTool: z.string().nullable(),
}).strict();

const snapshotSchema = z.object({
  nodeCount: z.number().int().nonnegative(), truncated: z.boolean(),
  nodes: z.array(z.object({ seq: z.number().int().nonnegative(), label: z.string(), tokens: z.number().int().nonnegative(), preview: z.string(), changed: z.boolean() }).strict()).max(32),
}).strict();
const compactionDetailSchema = z.object({
  trigger: z.enum(['manual', 'unknown']), algorithm: z.string(), summary: z.string(),
  before: snapshotSchema, after: snapshotSchema.nullable(),
}).strict();

const compactionSchema = z.object({
  detail: compactionDetailSchema.optional(),
  seq: z.number().int().nonnegative(),
  timeMs: z.number().nonnegative(),
  id: z.string().min(1),
  kind: z.enum(['summary', 'prune']),
  beforeTokens: z.number().int().nonnegative().nullable(),
  afterTokens: z.number().int().nonnegative().nullable(),
  reclaimedTokens: z.number().int().nonnegative().nullable(),
  reclaimRatio: z.number().min(0).max(1).nullable(),
  elapsedMs: z.number().nonnegative().nullable(),
  turn: z.number().int().nonnegative().nullable(),
}).strict();

const stateSchema = z.object({
  nodes: z.array(z.object({
    seq: z.number().int().nonnegative(),
    kind: z.enum(['system', 'conversation', 'tool-result', 'compaction-summary', 'other']),
    textTokens: z.number().int().nonnegative(),
    fileTokens: z.number().int().nonnegative(),
    label: z.string(),
    preview: z.string(),
    turn: z.number().int().nonnegative().nullable(),
    callId: z.string().nullable(),
    callTool: z.string().nullable(),
  }).strict()),
  toolsTokens: z.number().int().nonnegative(),
  contextWindow: z.number().int().positive().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  steps: z.array(stepSchema).max(MAX_STEPS),
  injections: z.array(injectionSchema).max(MAX_INJECTIONS),
  injectionCount: z.number().int().nonnegative(),
  injectionTokens: z.number().int().nonnegative(),
  compactions: z.array(compactionSchema).max(MAX_COMPACTIONS),
  compactionCount: z.number().int().nonnegative(),
  reclaimedTokens: z.number().int().nonnegative(),
  compactionElapsedMs: z.number().nonnegative(),
  tools: z.array(z.object({
    name: z.string(),
    calls: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  }).strict()).max(MAX_TOOLS),
  toolNameByCallId: z.array(z.tuple([z.string(), z.string()])),
  compactionStarts: z.array(z.tuple([z.string(), z.number().nonnegative(), z.number().int().nonnegative().nullable()])),
  toolsPreview: z.string(),
  pendingClaim: z.object({
    id: z.string().min(1),
    index: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }).strict().nullable(),
}).strict();

const segmentNodeSchema = z.object({
  seq: z.number().int().nonnegative(),
  label: z.string(),
  tokens: z.number().int().nonnegative(),
  preview: z.string(),
  turn: z.number().int().nonnegative().nullable(),
  callId: z.string().nullable(),
  callTool: z.string().nullable(),
}).strict();

const segmentSchema = z.object({
  segment: z.enum(['systemPrompt', 'conversation', 'toolDefinitions', 'toolResults', 'fileContents', 'compactionSummary', 'other']),
  tokens: z.number().int().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
  nodes: z.array(segmentNodeSchema).max(24),
}).strict();

const viewSchema = z.object({
  contextWindow: z.number().int().positive().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  surface: z.object({
    totalTokens: z.number().int().nonnegative(),
    systemPrompt: z.number().int().nonnegative(),
    conversation: z.number().int().nonnegative(),
    toolResults: z.number().int().nonnegative(),
    toolDefinitions: z.number().int().nonnegative(),
    fileContents: z.number().int().nonnegative(),
    compactionSummary: z.number().int().nonnegative(),
    other: z.number().int().nonnegative(),
  }).strict(),
  steps: z.array(stepSchema).max(MAX_STEPS),
  injections: z.array(injectionSchema).max(MAX_INJECTIONS),
  injectionTotals: z.object({ count: z.number().int().nonnegative(), tokens: z.number().int().nonnegative() }).strict(),
  compactions: z.array(compactionSchema).max(MAX_COMPACTIONS),
  compactionTotals: z.object({
    count: z.number().int().nonnegative(),
    reclaimedTokens: z.number().int().nonnegative(),
    elapsedMs: z.number().nonnegative(),
  }).strict(),
  tools: z.array(z.object({
    name: z.string(),
    calls: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  }).strict()).max(MAX_TOOLS),
  segments: z.array(segmentSchema).max(7),
}).strict();

/* ------------------------------------------------------------------ */
/* The projection definition.                                          */
/* ------------------------------------------------------------------ */

function toolResultIsSurfaceReplacement(event: SessionEvent): boolean {
  if (event.type !== 'tool/result') return false;
  return typeof event.surfaceOp === 'object' && event.surfaceOp !== null && event.surfaceOp.op === 'replace';
}

function surfaceTotal(state: ContextTimelineState): number {
  return nodesTotal(state.nodes);
}

function nodesTotal(nodes: ContextTimelineState['nodes']): number {
  let total = 0;
  for (const node of nodes) total += node.textTokens + node.fileTokens;
  return total;
}

function armCompactionRow(
  state: ContextTimelineState,
  event: SessionEvent,
  id: string,
  kind: 'summary' | 'prune',
  shadowedRange: { start: number; end: number },
): ContextTimelineState {
  const start = state.compactionStarts.find(([startId]) => startId === id);
  const row: ContextTimelineCompaction = {
    detail: {
      trigger: kind === 'summary' && (start?.[2] === null || (event.type === 'compaction/summary' && event.data.sourceCommandId !== undefined)) ? 'manual' : 'unknown',
      algorithm: event.type === 'compaction/summary' ? `摘要生成 · ${event.data.provider} / ${event.data.model}${event.data.llmStreamCall === true ? ' · LLM 调用' : ''}` : '历史修剪 · 无模型调用',
      summary: event.type === 'compaction/summary' ? event.data.summary.map((block) => 'text' in block ? block.text : `[${block.type}]`).join('\n').slice(0, 4000) : '将命中的历史范围替换为修剪结果，具体内容见前后对比。',
      before: snapshotOf(state.nodes, shadowedRange), after: null,
    },
    seq: event.seq,
    timeMs: event.time,
    id,
    kind,
    beforeTokens: surfaceTotal(state),
    afterTokens: null,
    reclaimedTokens: null,
    reclaimRatio: null,
    elapsedMs: null,
    turn: kind === 'summary' && start !== undefined ? start[2] : null,
  };
  const compactions = pushBounded(state.compactions, row, MAX_COMPACTIONS);
  return {
    ...state,
    compactions,
    compactionCount: state.compactionCount + 1,
    pendingClaim: { id, index: compactions.length - 1, start: shadowedRange.start, end: shadowedRange.end },
  };
}

function backfillCompaction(state: ContextTimelineState, afterTokens: number, afterNodes: ContextTimelineState['nodes'], replacementPreview: string, replacementSeq?: number): ContextTimelineState {
  const claim = state.pendingClaim;
  if (claim === null) return state;
  const row = state.compactions[claim.index];
  if (row === undefined) return { ...state, pendingClaim: null };
  const reclaimed = row.beforeTokens === null ? null : Math.max(0, row.beforeTokens - afterTokens);
  const next: ContextTimelineCompaction = {
    ...row,
    ...(row.detail ? { detail: { ...row.detail, after: snapshotOf(afterNodes.map((node) => node.seq === replacementSeq ? { ...node, preview: replacementPreview } : node), null, replacementSeq) } } : {}),
    afterTokens,
    reclaimedTokens: reclaimed,
    reclaimRatio: reclaimed !== null && row.beforeTokens !== null && row.beforeTokens > 0
      ? reclaimed / row.beforeTokens
      : null,
  };
  const compactions = [...state.compactions];
  compactions[claim.index] = next;
  return {
    ...state,
    compactions,
    reclaimedTokens: state.reclaimedTokens + (reclaimed ?? 0),
    pendingClaim: null,
  };
}

export const contextTimelineProjection = {
  key: 'contextTimeline',
  /* v5: preserve up to 4000 chars of the actual replacement message. */
  stateVersion: 5,
  stateSchema,
  init: () => ({
    nodes: [],
    toolsTokens: 0,
    contextWindow: null,
    provider: null,
    model: null,
    steps: [],
    injections: [],
    injectionCount: 0,
    injectionTokens: 0,
    compactions: [],
    compactionCount: 0,
    reclaimedTokens: 0,
    compactionElapsedMs: 0,
    tools: [],
    toolNameByCallId: [],
    compactionStarts: [],
    toolsPreview: '',
    pendingClaim: null,
  }),
  apply: (state, event) => {
    let next: ContextTimelineState = state;

    /* Route metadata: the context window limit (PRD §3.1). */
    if (event.type === 'request/context') {
      const window = typeof event.data.contextWindow === 'number' ? event.data.contextWindow : null;
      if (window !== state.contextWindow
        || event.data.provider !== state.provider
        || event.data.model !== state.model) {
        next = {
          ...next,
          contextWindow: window,
          provider: event.data.provider,
          model: event.data.model,
        };
      }
    }

    /* Tool schemas: the tool-definition segment (PRD §3.2). */
    const toolsTokens = estimateToolsTokens(event);
    if (toolsTokens !== null && toolsTokens !== next.toolsTokens) {
      next = { ...next, toolsTokens };
    }
    const toolsPreview = toolsPreviewOf(event);
    if (toolsPreview !== null && toolsPreview !== next.toolsPreview) {
      next = { ...next, toolsPreview };
    }

    /* Step usage samples — stamped before the same event joins the surface. */
    if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      const usage = event.data.usage;
      next = {
        ...next,
        steps: pushBounded(next.steps, {
          turn: event.data.turn,
          step: event.data.step,
          seq: event.seq,
          timeMs: event.time,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: typeof usage.cacheReadTokens === 'number' ? usage.cacheReadTokens : null,
          cacheWriteTokens: typeof usage.cacheWriteTokens === 'number' ? usage.cacheWriteTokens : null,
          surfaceTokens: surfaceTotal(next),
        }, MAX_STEPS),
      };
    }

    /* Compaction lifecycle: start/end bookkeeping for elapsed times. */
    if (event.type === 'compaction/start') {
      next = {
        ...next,
        compactionStarts: startTimeEntries(next.compactionStarts, event.data.compactionId, event.time, event.data.turn),
      };
    }
    if (event.type === 'compaction/end') {
      const start = next.compactionStarts.find(([id]) => id === event.data.compactionId);
      if (start !== undefined) {
        const elapsed = Math.max(0, event.time - start[1]);
        let updated = false;
        const compactions = next.compactions.map((row) => {
          if (row.id !== event.data.compactionId || row.elapsedMs !== null) return row;
          updated = true;
          return { ...row, elapsedMs: elapsed };
        });
        if (updated) {
          next = {
            ...next,
            compactions,
            compactionElapsedMs: next.compactionElapsedMs + elapsed,
          };
        }
      }
    }

    /* Shadow-price metering events arm a compaction row (PRD §3.5). */
    if (event.type === 'compaction/summary') {
      next = armCompactionRow(
        next, event, event.data.compactionId, 'summary',
        { start: event.data.shadowedRange.start, end: event.data.shadowedRange.end },
      );
    } else if (event.type === 'compaction/prune') {
      next = armCompactionRow(
        next, event, `prune-${String(event.seq)}`, 'prune',
        { start: event.data.shadowedRange.start, end: event.data.shadowedRange.end },
      );
    }

    /* Tool call distribution (PRD §3.6 tool tab). */
    if (event.type === 'tool/call') {
      next = {
        ...next,
        tools: withToolRow(next.tools, event.data.name, (row) => ({ ...row, calls: row.calls + 1 })),
        toolNameByCallId: setMapEntry(next.toolNameByCallId, String(event.data.callId), event.data.name, MAX_CALL_IDS),
      };
    }

    /* The surface fold — composition, injections, replacements. */
    if (isSurfaceEvent(event)) {
      const op = event.surfaceOp;
      const message = deriveMessage(event);
      const kind = op === 'append' ? kindOfEvent(event) : 'compaction-summary';
      const estimate = message === null
        ? { textTokens: 0, toolCallTokens: 0, fileTokens: 0 }
        : estimateMessage(message);
      /* Node/composition semantics stay: tool-call pricing folds into the
       * node's text bucket (unchanged since v1 of this projection). */
      const nodeTextTokens = estimate.textTokens + estimate.toolCallTokens;
      let nodes = next.nodes;
      let injected: ContextTimelineState = next;

      if (op === 'append') {
        /* Injection events (PRD §3.5): appends only, never replacements. */
        if (message !== null) {
          const locator = callIdOf(event, message);
          const toolName = event.type === 'tool/result'
            ? next.toolNameByCallId.find(([id]) => id === locator.callId)?.[1] ?? null
            : null;
          const injection = injectionOf(event, message, estimate, {
            cumulativeTokens: surfaceTotal(next) + nodeTextTokens + estimate.fileTokens,
            outputTokens: event.type === 'assistant/message' && event.data.usage !== undefined
              ? event.data.usage.outputTokens
              : null,
            callId: locator.callId,
            callTool: event.type === 'assistant/message' ? locator.callTool : toolName,
            toolName,
          });
          if (injection !== null) {
            injected = {
              ...injected,
              injections: pushBounded(injected.injections, injection, MAX_INJECTIONS),
              injectionCount: injected.injectionCount + 1,
              injectionTokens: injected.injectionTokens + injection.tokens,
            };
          }
        }
        /* Tool-result errors merge into the tool distribution. */
        if (event.type === 'tool/result' && !toolResultIsSurfaceReplacement(event) && event.data.message.isError === true) {
          const name = next.toolNameByCallId.find(([id]) => id === String(event.data.message.toolCallId))?.[1] ?? '(unknown)';
          injected = {
            ...injected,
            tools: withToolRow(injected.tools, name, (row) => ({ ...row, errors: row.errors + 1 })),
          };
        }
      } else {
        /* A replace shadows [startSeq, endSeq] then lands as one node. */
        nodes = nodes.filter((node) => node.seq < op.startSeq || node.seq > op.endSeq);
        if (next.pendingClaim !== null && next.pendingClaim.start === op.startSeq && next.pendingClaim.end === op.endSeq) {
          /* Post-replace surface: the shadowed range is gone, the replacing
           * node (summary / prune output) stays — so the compaction's
           * afterTokens = filtered total + the landing node itself. */
          // Filled after the replacement node has joined the surface below.
        } else if (next.pendingClaim !== null) {
          injected = { ...injected, pendingClaim: null };
        }
      }

      if (message !== null) {
        const locator = callIdOf(event, message);
        nodes = [...nodes, {
          seq: event.seq,
          kind,
          textTokens: nodeTextTokens,
          fileTokens: estimate.fileTokens,
          label: labelOf(event, message, next),
          preview: previewOf(message),
          turn: turnOf(event),
          callId: locator.callId,
          callTool: locator.callTool,
        }];
      }
      if (op !== 'append' && injected.pendingClaim !== null && injected.pendingClaim.start === op.startSeq && injected.pendingClaim.end === op.endSeq) {
        injected = backfillCompaction(injected, nodesTotal(nodes), nodes, message ? previewOf(message, 4000) : '', message ? event.seq : undefined);
      }
      next = { ...injected, nodes };
    } else if (next.pendingClaim !== null
      && event.type !== 'compaction/summary' && event.type !== 'compaction/prune') {
      /* The metering adjacency contract: a surviving claim expires on any
       * non-matching event (mirrors dsh-token-meter's claim expiry). */
      next = { ...next, pendingClaim: null };
    }

    return next;
  },
  wire: {
    viewSchema,
    view: (state): ContextTimelineView => ({
      contextWindow: state.contextWindow,
      provider: state.provider,
      model: state.model,
      surface: surfaceTotalsOf(state),
      steps: state.steps,
      injections: state.injections,
      injectionTotals: { count: state.injectionCount, tokens: state.injectionTokens },
      compactions: state.compactions,
      compactionTotals: {
        count: state.compactionCount,
        reclaimedTokens: state.reclaimedTokens,
        elapsedMs: state.compactionElapsedMs,
      },
      tools: [...state.tools].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)).slice(0, 20),
      segments: segmentsOf(state),
    }),
  },
} satisfies ProjectionDefinition<'contextTimeline'> & { wire: NonNullable<ProjectionDefinition<'contextTimeline'>['wire']> };

/** The model-visible message an event derives, without projected history. */
function deriveMessage(event: SessionEvent): Message | null {
  switch (event.type) {
    case 'user/message': return event.data;
    case 'system/message':
    case 'developer/message':
    case 'assistant/message':
      return event.data.message.content.length === 0 ? null : event.data.message;
    case 'tool/result': return event.data.message;
    default: return null;
  }
}

/** The message-level ledger row for one append-origin surface event, or null when muted. */
function injectionOf(
  event: SessionEvent,
  message: Message,
  estimate: { textTokens: number; toolCallTokens: number; fileTokens: number },
  extra: {
    cumulativeTokens: number;
    outputTokens: number | null;
    callId: string | null;
    callTool: string | null;
    toolName: string | null;
  },
): ContextTimelineInjection | null {
  const tokens = estimate.textTokens + estimate.toolCallTokens + estimate.fileTokens;
  const base = {
    seq: event.seq,
    timeMs: event.time,
    sourceKind: message.source.kind,
    toolName: extra.toolName,
    tokens,
    preview: previewOf(message, 1000),
    textTokens: estimate.textTokens,
    toolCallTokens: estimate.toolCallTokens,
    fileTokens: estimate.fileTokens,
    cumulativeTokens: extra.cumulativeTokens,
    callId: extra.callId,
    callTool: extra.callTool,
  };
  switch (event.type) {
    case 'user/message':
      return { ...base, kind: 'user', turn: null, outputTokens: null };
    case 'assistant/message':
      /* Assistant output joins the surface too — the ledger keeps it so the
       * message tab can price every model-visible message. */
      return { ...base, kind: 'assistant', turn: event.data.turn, outputTokens: extra.outputTokens };
    case 'tool/result':
      if (toolResultIsSurfaceReplacement(event)) return null;
      return { ...base, kind: 'tool-result', turn: event.data.turn, outputTokens: null };
    case 'system/message':
      if (event.data.message.content.length === 0) return null;
      return { ...base, kind: 'system', sourceKind: 'system-prompt', turn: event.data.turn, outputTokens: null };
    case 'developer/message':
      if (event.data.message.content.length === 0) return null;
      return { ...base, kind: 'developer', sourceKind: 'developer', turn: event.data.turn, outputTokens: null };
    default:
      return null;
  }
}

/** Bounded historical surface, prioritizing affected nodes over retained context. */
function snapshotOf(nodes: ContextTimelineState['nodes'], range: { start: number; end: number } | null, replacementSeq?: number): CompactionSnapshot {
  const changed = (seq: number) => range !== null ? seq >= range.start && seq <= range.end : seq === replacementSeq;
  const affected = nodes.filter((node) => changed(node.seq));
  const retained = nodes.filter((node) => !changed(node.seq));
  const selected = [...affected.slice(-24), ...retained.slice(-Math.max(0, 32 - Math.min(24, affected.length)))].sort((a, b) => a.seq - b.seq);
  return { nodeCount: nodes.length, truncated: selected.length < nodes.length || selected.some((node) => node.preview.includes('…')), nodes: selected.map((node) => ({ seq: node.seq, label: node.label, tokens: node.textTokens + node.fileTokens, preview: node.preview, changed: changed(node.seq) })) };
}
