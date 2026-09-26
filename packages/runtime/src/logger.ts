/**
 * Structured, content-free process log (Rule A: operational telemetry is ALWAYS content-free).
 *
 * A log record is an event name plus short scalar fields — IDs, states, counts, codes, durations.
 * Strings are capped, nested values are refused, and no API accepts free-form payloads such as
 * Work Item objectives, checkpoint state, processor input or environment variables.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, string | number | boolean | null | undefined>>;

export interface LogRecord {
  readonly ts: string;
  readonly level: LogLevel;
  readonly event: string;
  readonly [field: string]: string | number | boolean | null;
}

export type LogSink = (record: LogRecord) => void;

const EVENT = /^[a-z][a-z0-9_.-]{0,63}$/;
const MAX_STRING = 128;

export class Logger {
  readonly #sink: LogSink;
  readonly #now: () => string;

  constructor(sink: LogSink, now: () => string = () => new Date().toISOString()) {
    this.#sink = sink;
    this.#now = now;
  }

  log(level: LogLevel, event: string, fields: LogFields = {}): void {
    const record: Record<string, string | number | boolean | null> = { ts: this.#now(), level, event: EVENT.test(event) ? event : 'invalid.event' };
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || key === 'ts' || key === 'level' || key === 'event' || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(key)) continue;
      if (typeof value === 'string') record[key] = value.slice(0, MAX_STRING);
      else if (typeof value === 'number') record[key] = Number.isFinite(value) ? value : null;
      else if (typeof value === 'boolean' || value === null) record[key] = value;
      // Anything else (objects, arrays, functions) is dropped: no structured payload is ever logged.
    }
    try {
      this.#sink(record as LogRecord);
    } catch {
      // Logging never breaks the runtime.
    }
  }

  info(event: string, fields?: LogFields): void {
    this.log('info', event, fields);
  }

  warn(event: string, fields?: LogFields): void {
    this.log('warn', event, fields);
  }

  error(event: string, fields?: LogFields): void {
    this.log('error', event, fields);
  }

  debug(event: string, fields?: LogFields): void {
    this.log('debug', event, fields);
  }
}

export const silentLogger = new Logger(() => undefined);

/** JSON-lines sink for the CLI. */
export function jsonLinesSink(write: (line: string) => void): LogSink {
  return (record) => write(`${JSON.stringify(record)}\n`);
}

/** Maps any thrown value to a stable code for logging — never its message or stack. */
export function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'UNCLASSIFIED_ERROR';
}
