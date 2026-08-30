import { afterEach, describe, expect, it } from 'vitest'
import { createLogger, resolveInitialLevel, setLogLevel, setLogSink, type LogEvent } from './logger'

afterEach(() => {
  setLogSink(null)
  setLogLevel('warn')
})

describe('resolveInitialLevel', () => {
  it('is quiet by default in production', () => {
    expect(resolveInitialLevel({ debugFlag: false, isDev: false })).toBe('warn')
  })

  it('is verbose in dev', () => {
    expect(resolveInitialLevel({ debugFlag: false, isDev: true })).toBe('debug')
  })

  it('debug flag wins over production default', () => {
    expect(resolveInitialLevel({ debugFlag: true, isDev: false })).toBe('debug')
  })
})

describe('createLogger', () => {
  function capture(): { events: LogEvent[] } {
    const events: LogEvent[] = []
    setLogSink((e) => events.push(e))
    return { events }
  }

  it('filters events below the current level', () => {
    const { events } = capture()
    setLogLevel('warn')
    const log = createLogger('test')
    log.debug('hidden')
    log.info('hidden')
    log.warn('shown')
    log.error('shown')
    expect(events.map((e) => e.level)).toEqual(['warn', 'error'])
  })

  it('emits everything at debug level with scope and args intact', () => {
    const { events } = capture()
    setLogLevel('debug')
    const log = createLogger('engine')
    log.debug('parsed', 42)
    expect(events).toEqual([{ level: 'debug', scope: 'engine', args: ['parsed', 42] }])
  })

  it('emits nothing when silent', () => {
    const { events } = capture()
    setLogLevel('silent')
    const log = createLogger('test')
    log.error('dropped')
    expect(events).toEqual([])
  })
})
