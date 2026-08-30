/**
 * Leveled logging (docs/PLAN.md §2, D13): a thin in-house wrapper.
 * Console-only, never transmitted anywhere — remote collection would
 * contradict the privacy stance and the strict CSP. Quiet in production;
 * `?debug=1` or `localStorage["cta-debug"] = "1"` elevates verbosity.
 *
 * SENSITIVE DATA RULE: never log session-log-derived strings (titles, cwd,
 * branches, prompts) or file contents — counts, enums, durations, and error
 * codes only. Anything the user must act on belongs in the UI.
 *
 * Worker-safe: environment probes are guarded, and `setLogSink` lets a
 * worker forward events to the main thread (wired in WP-07).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
}

export interface LogEvent {
  level: Exclude<LogLevel, 'silent'>
  scope: string
  args: unknown[]
}

export type LogSink = (event: LogEvent) => void

export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/** Pure level resolution, unit-testable without a browser environment. */
export function resolveInitialLevel(env: { debugFlag: boolean; isDev: boolean }): LogLevel {
  if (env.debugFlag) return 'debug'
  return env.isDev ? 'debug' : 'warn'
}

/** Probe the debug flag; every access is guarded so workers and restricted
 * contexts (no `localStorage`, no `location`) never throw. */
export function detectDebugFlag(): boolean {
  try {
    if (typeof location !== 'undefined' && typeof location.search === 'string') {
      if (new URLSearchParams(location.search).get('debug') === '1') return true
    }
  } catch {
    // ignore: no usable location in this context
  }
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('cta-debug') === '1') {
      return true
    }
  } catch {
    // ignore: storage unavailable (workers, blocked site data)
  }
  return false
}

const consoleSink: LogSink = (event) => {
  console[event.level](`[${event.scope}]`, ...event.args)
}

let currentLevel: LogLevel = resolveInitialLevel({
  debugFlag: detectDebugFlag(),
  isDev: typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV),
})
let currentSink: LogSink = consoleSink

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

/** Replace the output target (e.g. a worker forwarding events to the main
 * thread). Pass `null` to restore the console sink. */
export function setLogSink(sink: LogSink | null): void {
  currentSink = sink ?? consoleSink
}

export function createLogger(scope: string): Logger {
  const emit = (level: Exclude<LogLevel, 'silent'>, args: unknown[]) => {
    if (LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel]) {
      currentSink({ level, scope, args })
    }
  }
  return {
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
  }
}
