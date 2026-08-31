import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AnalysisEngine } from '../engine/contract'
import { createStubEngine } from '../engine/stub'
import { PRICING } from '../config/pricing'
import { setLogSink } from '../lib/logger'
import { createAnalysisWorkerHandler } from '../worker/handler'
import { createAnalysisRunner, type AnalysisWorkerPort, type RunHandlers } from './analysis-runner'

/**
 * A worker that is not a thread: the real protocol handler, driven in-process,
 * behind the same port shape the browser `Worker` presents. That makes the
 * whole lifecycle testable — including the acceptance criterion that a cancel
 * really stops the worker — without spawning one.
 *
 * `terminate()` drops every later message on the floor, exactly as killing a
 * thread would, so a test can prove a terminated worker cannot talk back.
 */
function createFakeWorker(engine: AnalysisEngine) {
  let terminated = false
  const port: AnalysisWorkerPort = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      if (!terminated) handler.onMessage(message)
    },
    terminate() {
      terminated = true
    },
  }
  const handler = createAnalysisWorkerHandler(engine, (response) => {
    if (!terminated) port.onmessage?.({ data: response })
  })
  // `createAnalysisWorkerHandler` redirects the logger's global sink so worker
  // logs travel over the protocol. In the browser that is harmless — the worker
  // has its own module instance — but here the handler shares this process's
  // logger with the main thread, so the sink is restored immediately: without
  // it, a main-thread log would post itself back as a worker log, forever.
  setLogSink(null)
  return {
    port,
    get terminated() {
      return terminated
    },
  }
}

function spyHandlers(): RunHandlers & { [K in keyof RunHandlers]: ReturnType<typeof vi.fn> } {
  return {
    onProgress: vi.fn(),
    onResult: vi.fn(),
    onRejected: vi.fn(),
    onCancelled: vi.fn(),
    onError: vi.fn(),
    onLog: vi.fn(),
  } as never
}

const FILE = new File(['{}\n'], 'session.jsonl', { type: 'application/jsonl' })

function request() {
  return { file: FILE, pricing: PRICING, logLevel: 'silent' as const }
}

/** Let queued microtasks and zero-delay timers run, as the stub engine uses. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => vi.useRealTimers())

describe('createAnalysisRunner', () => {
  it('runs a session through to a result and reports progress on the way', async () => {
    const fake = createFakeWorker(createStubEngine())
    const runner = createAnalysisRunner({ createWorker: () => fake.port })
    const handlers = spyHandlers()

    runner.start(request(), handlers)
    expect(runner.isRunning).toBe(true)
    await settle()

    expect(handlers.onProgress.mock.calls.length).toBeGreaterThan(0)
    expect(handlers.onResult).toHaveBeenCalledTimes(1)
    expect(handlers.onError).not.toHaveBeenCalled()
  })

  it('terminates the worker once a run reaches a terminal state', async () => {
    const fake = createFakeWorker(createStubEngine())
    const runner = createAnalysisRunner({ createWorker: () => fake.port })

    runner.start(request(), spyHandlers())
    await settle()

    expect(fake.terminated).toBe(true)
    expect(runner.isRunning).toBe(false)
  })

  it('reports a rejection as a result, not as an error', async () => {
    const rejecting: AnalysisEngine = {
      async analyze() {
        return {
          kind: 'rejected',
          verdict: 'not-a-session-log',
          stats: {
            totalLines: 3,
            nonEmptyLines: 3,
            malformedLines: 0,
            skippedRecordTypes: {},
            assistantRows: 0,
            dedupedRequests: 0,
            syntheticRowsExcluded: 0,
            invalidUsageRowsSkipped: 0,
          },
          reason: 'no-assistant-usage-rows',
        }
      },
    }
    const fake = createFakeWorker(rejecting)
    const runner = createAnalysisRunner({ createWorker: () => fake.port })
    const handlers = spyHandlers()

    runner.start(request(), handlers)
    await settle()

    expect(handlers.onRejected).toHaveBeenCalledWith(expect.anything(), 'no-assistant-usage-rows')
    expect(handlers.onError).not.toHaveBeenCalled()
  })

  it('cancels cooperatively and kills the worker', async () => {
    const fake = createFakeWorker(createStubEngine())
    const runner = createAnalysisRunner({ createWorker: () => fake.port })
    const handlers = spyHandlers()

    runner.start(request(), handlers)
    runner.cancel()
    await settle()

    expect(handlers.onCancelled).toHaveBeenCalledTimes(1)
    expect(handlers.onResult).not.toHaveBeenCalled()
    expect(fake.terminated).toBe(true)
  })

  it('kills a worker that ignores the cancel message, and still reports cancelled', async () => {
    vi.useFakeTimers()
    // A worker whose engine never checks the abort signal — the failure mode a
    // synchronous hot loop produces, where only terminate() can stop it.
    const deaf: AnalysisWorkerPort = {
      onmessage: null,
      onerror: null,
      postMessage() {},
      terminate() {
        deafTerminated = true
      },
    }
    let deafTerminated = false

    const runner = createAnalysisRunner({ createWorker: () => deaf, hardStopDelayMs: 2000 })
    const handlers = spyHandlers()

    runner.start(request(), handlers)
    runner.cancel()
    expect(deafTerminated).toBe(false)

    vi.advanceTimersByTime(2000)

    expect(deafTerminated).toBe(true)
    expect(handlers.onCancelled).toHaveBeenCalledTimes(1)
    expect(runner.isRunning).toBe(false)
  })

  it('reports cancelled exactly once when the worker answers before the hard stop', async () => {
    vi.useFakeTimers()
    const fake = createFakeWorker(createStubEngine())
    const runner = createAnalysisRunner({ createWorker: () => fake.port, hardStopDelayMs: 2000 })
    const handlers = spyHandlers()

    runner.start(request(), handlers)
    runner.cancel()
    await vi.advanceTimersByTimeAsync(2000)

    expect(handlers.onCancelled).toHaveBeenCalledTimes(1)
  })

  it('surfaces a worker that dies before saying anything, instead of hanging', () => {
    const dying: AnalysisWorkerPort = {
      onmessage: null,
      onerror: null,
      postMessage() {},
      terminate() {},
    }
    const runner = createAnalysisRunner({ createWorker: () => dying })
    const handlers = spyHandlers()

    runner.start(request(), handlers)
    dying.onerror?.({ message: 'failed to load worker script' })

    expect(handlers.onError).toHaveBeenCalledWith('internal', 'failed to load worker script')
    expect(runner.isRunning).toBe(false)
  })

  it('refuses a second concurrent run, matching the worker protocol', () => {
    const fake = createFakeWorker(createStubEngine())
    const runner = createAnalysisRunner({ createWorker: () => fake.port })
    runner.start(request(), spyHandlers())
    expect(() => runner.start(request(), spyHandlers())).toThrow(/already running/)
  })

  it('disposes silently, so an unmount does not report a phantom outcome', async () => {
    const fake = createFakeWorker(createStubEngine())
    const runner = createAnalysisRunner({ createWorker: () => fake.port })
    const handlers = spyHandlers()

    runner.start(request(), handlers)
    runner.dispose()
    await settle()

    expect(fake.terminated).toBe(true)
    expect(handlers.onResult).not.toHaveBeenCalled()
    expect(handlers.onCancelled).not.toHaveBeenCalled()
  })
})
