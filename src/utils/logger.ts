export interface ILogger {
  debug(msg: string, meta?: Record<string, unknown>): void
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
}

export const nullLogger: ILogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}

const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 } as const
type LogLevel = keyof typeof LEVEL_RANK

export interface CreateLoggerOptions {
  level?: LogLevel
  json?: boolean
  destination?: { write(s: string): void }
}

export function createLogger(opts: CreateLoggerOptions = {}): ILogger {
  const minRank = LEVEL_RANK[opts.level ?? 'info']
  const json = opts.json ?? false
  const dest = opts.destination ?? { write: (s: string) => process.stderr.write(s) }

  function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
    if (LEVEL_RANK[level] < minRank) return
    if (json) {
      const entry: Record<string, unknown> = { level, timestamp: new Date().toISOString(), msg, ...meta }
      dest.write(JSON.stringify(entry) + '\n')
    } else {
      const metaStr = meta && Object.keys(meta).length > 0
        ? ' ' + Object.entries(meta).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
        : ''
      dest.write(`[${level.toUpperCase()}] ${msg}${metaStr}\n`)
    }
  }

  return {
    debug: (msg, meta) => emit('debug', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
  }
}
