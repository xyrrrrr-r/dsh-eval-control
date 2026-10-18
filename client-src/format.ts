/** Shared display formatting for the dashboard. */

/** Compact token counts: 1.2K / 3.4M style, with full digits in titles. */
export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${trim(value / 1000)}K`;
  return `${trim(value / 1_000_000)}M`;
}

function trim(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return String(rounded);
}

export function formatFull(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US');
}

export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${trim(value / 1000)} s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatTime(timeMs: number | null | undefined): string {
  if (timeMs === null || timeMs === undefined || !Number.isFinite(timeMs)) return '—';
  return new Date(timeMs).toLocaleTimeString();
}

export function formatDateTime(timeMs: number | null | undefined): string {
  if (timeMs === null || timeMs === undefined || !Number.isFinite(timeMs)) return '—';
  return new Date(timeMs).toLocaleString();
}

/** Trend direction for a metric card comparing recent history to earlier history. */
export function trendOf(history: number[]): 'up' | 'down' | 'stable' | null {
  if (history.length < 4) return null;
  const recent = history.slice(-2);
  const earlier = history.slice(0, -2);
  const recentAvg = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const earlierAvg = earlier.reduce((sum, value) => sum + value, 0) / earlier.length;
  if (earlierAvg === 0) return recentAvg > 0 ? 'up' : null;
  const change = (recentAvg - earlierAvg) / earlierAvg;
  if (change > 0.15) return 'up';
  if (change < -0.15) return 'down';
  return 'stable';
}

/** Occupancy color coding per PRD §3.1: green < 60%, yellow 60–80%, red > 80%. */
export function utilizationColor(ratio: number): string {
  if (ratio > 0.8) return 'var(--dsh-eval-red, #e5484d)';
  if (ratio >= 0.6) return 'var(--dsh-eval-yellow, #e6a700)';
  return 'var(--dsh-eval-green, #30a46c)';
}

/** The shared palette for context composition segments (PRD §3.1 colors). */
export const COMPOSITION_COLORS = {
  systemPrompt: '#4285f4',
  conversation: '#9aa0a6',
  toolDefinitions: '#f29900',
  fileContents: '#9b59b6',
  compactionSummary: '#00bcd4',
  toolResults: '#e67e22',
  other: '#95a5a6',
} as const;
