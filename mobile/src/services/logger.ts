/**
 * logger.ts
 * Structured app logger. Every entry goes to:
 *   1. console  -> visible in the Metro terminal (dev client) and `adb logcat` (read_phone_logs.ps1)
 *   2. SQLite `app_logs` ring buffer -> survives restarts, uploaded to the backend by uploadPendingLogs()
 *
 * Scans are recorded as one ScanTrace (per-stage timings + scores) so a failure can be diagnosed
 * from the exact numbers instead of what the screen showed.
 */
import Constants from 'expo-constants';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogTag =
  | 'APP'
  | 'SCAN'
  | 'CAPTURE'
  | 'DET'
  | 'LIVE'
  | 'REC'
  | 'MATCH'
  | 'SYNC'
  | 'API'
  | 'DB'
  | 'CRASH'
  | 'DEBUG_DUMP';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  tag: LogTag;
  message: string;
  trace_id?: string | null;
  data?: Record<string, any> | null;
}

export const APP_VERSION: string = String(Constants.expoConfig?.version || '0.0.0');

const MAX_CONSOLE_DATA_CHARS = 1500;
const PERSIST_INTERVAL_MS = 2000;
const MAX_MEMORY_BUFFER = 2000;

let pending: LogEntry[] = [];
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistenceEnabled = true;

function safeStringify(value: any, maxChars?: number): string {
  try {
    const s = JSON.stringify(value, (_k, v) => {
      if (v instanceof Float32Array || v instanceof Uint8Array) return `[${v.constructor.name} len=${v.length}]`;
      if (Array.isArray(v) && v.length > 64) return `[Array len=${v.length}]`;
      if (typeof v === 'number' && !Number.isInteger(v)) return Math.round(v * 10000) / 10000;
      return v;
    });
    if (maxChars && s && s.length > maxChars) return s.substring(0, maxChars) + '…';
    return s ?? '';
  } catch {
    return '[unserializable]';
  }
}

function toConsole(entry: LogEntry): void {
  const trace = entry.trace_id ? ` (${entry.trace_id})` : '';
  const data = entry.data ? ' ' + safeStringify(entry.data, MAX_CONSOLE_DATA_CHARS) : '';
  const line = `[${entry.tag}]${trace} ${entry.message}${data}`;
  if (entry.level === 'error') console.error(line);
  else if (entry.level === 'warn') console.warn(line);
  else console.log(line);
}

function schedulePersist(): void {
  if (!persistenceEnabled || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushLogsToDb().catch(() => {});
  }, PERSIST_INTERVAL_MS);
}

/** Write buffered entries to SQLite. Lazy-required to avoid an import cycle with offlineDb. */
export async function flushLogsToDb(): Promise<void> {
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  try {
    const { insertAppLogs } = require('../database/offlineDb');
    await insertAppLogs(
      batch.map((e) => ({ ...e, data_json: e.data ? safeStringify(e.data) : null }))
    );
  } catch (err: any) {
    // Never log through the logger here (would recurse). Keep the newest entries for the next attempt.
    console.warn('[logger] persist failed:', err?.message || err);
    pending = batch.concat(pending).slice(-MAX_MEMORY_BUFFER);
  }
}

function write(level: LogLevel, tag: LogTag, message: string, data?: Record<string, any> | null, traceId?: string | null) {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    tag,
    message,
    trace_id: traceId ?? null,
    data: data ?? null,
  };
  toConsole(entry);
  if (level === 'debug') return; // debug is console-only
  pending.push(entry);
  if (pending.length > MAX_MEMORY_BUFFER) pending = pending.slice(-MAX_MEMORY_BUFFER);
  schedulePersist();
}

export const log = {
  debug: (tag: LogTag, message: string, data?: Record<string, any> | null, traceId?: string | null) =>
    write('debug', tag, message, data, traceId),
  info: (tag: LogTag, message: string, data?: Record<string, any> | null, traceId?: string | null) =>
    write('info', tag, message, data, traceId),
  warn: (tag: LogTag, message: string, data?: Record<string, any> | null, traceId?: string | null) =>
    write('warn', tag, message, data, traceId),
  error: (tag: LogTag, message: string, data?: Record<string, any> | null, traceId?: string | null) =>
    write('error', tag, message, data, traceId),
};

/** Used by jest tests so the logger doesn't touch expo-sqlite. */
export function setLogPersistenceEnabled(enabled: boolean): void {
  persistenceEnabled = enabled;
  if (!enabled) pending = [];
}

export function errorToData(err: any): Record<string, any> {
  return {
    name: err?.name,
    message: err?.message || String(err),
    code: err?.code,
    status: err?.response?.status,
    detail: err?.response?.data?.detail,
    stack: typeof err?.stack === 'string' ? err.stack.substring(0, 800) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Scan trace: one record per scan with per-stage timings and scores
// ---------------------------------------------------------------------------
const now = (): number =>
  (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();

export class ScanTrace {
  public readonly id: string;
  private readonly t0: number;
  private last: number;
  public readonly timings: Record<string, number> = {};
  public readonly data: Record<string, any> = {};

  constructor() {
    this.id = `scan_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    this.t0 = now();
    this.last = this.t0;
  }

  /** Records the elapsed ms since the previous mark under `stage`. */
  mark(stage: string): void {
    const t = now();
    this.timings[stage] = Math.round((t - this.last) * 10) / 10;
    this.last = t;
  }

  set(key: string, value: any): void {
    this.data[key] = value;
  }

  totalMs(): number {
    return Math.round(now() - this.t0);
  }

  /** Emits the single SCAN summary entry. */
  end(outcome: string, level: LogLevel = 'info'): void {
    write(level, 'SCAN', `outcome=${outcome} total=${this.totalMs()}ms`, {
      outcome,
      total_ms: this.totalMs(),
      timings_ms: this.timings,
      ...this.data,
    }, this.id);
  }
}
