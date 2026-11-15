import { redact } from '@givance/core';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

export interface Logger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

/** Logs em JSON, uma linha por evento, com dados pessoais mascarados. */
export function createLogger(level: LogLevel = 'info', base: Record<string, unknown> = {}): Logger {
  const min = LEVELS[level];
  const write = (lvl: LogLevel, msg: string, context?: Record<string, unknown>) => {
    if (LEVELS[lvl] < min) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level: lvl,
      msg,
      ...(redact({ ...base, ...context }) as Record<string, unknown>),
    });
    if (lvl === 'error' || lvl === 'warn') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  };
  return {
    debug: (msg, ctx) => write('debug', msg, ctx),
    info: (msg, ctx) => write('info', msg, ctx),
    warn: (msg, ctx) => write('warn', msg, ctx),
    error: (msg, ctx) => write('error', msg, ctx),
    child: (ctx) => createLogger(level, { ...base, ...ctx }),
  };
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLogger;
  },
};
