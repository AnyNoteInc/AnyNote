type Level = 'info' | 'warn' | 'error'

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  const payload = { ts: new Date().toISOString(), level, msg, ...(meta ?? {}) }
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(payload))
}

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
}
