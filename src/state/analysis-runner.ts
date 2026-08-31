/**
 * Owns one analysis Web Worker's lifetime. Framework-free so the whole
 * lifecycle — including the cancel path the acceptance criteria call out —
 * is testable against a fake worker driving the real protocol handler.
 *
 * Cancellation is layered exactly as `protocol.ts` describes: the cooperative
 * `cancel` message gives the engine a chance to abort and answer `cancelled`,
 * and `terminate()` is the hard stop. Both paths terminate the worker, so a
 * cancel is never merely cosmetic: if the engine does not answer within
 * `hardStopDelayMs` — the failure mode a synchronous hot loop would produce —
 * the worker is killed anyway and the run is reported cancelled.
 *
 * A fresh worker per run keeps that guarantee simple: there is no reusable
 * worker whose state a terminate would have to be reconciled with.
 */

import type { AnalysisResult, EngineProgress, ParseStats } from '../engine/contract'
import type { AnalysisWorkerRequest, AnalysisWorkerResponse } from '../engine/protocol'
import type { PricingConfig } from '../engine/pricing'
import type { LogEvent, LogLevel } from '../lib/logger'
import type { AnalysisFailureCode } from './session-store'

/** The structural subset of `Worker` this module uses, so tests can fake it. */
export interface AnalysisWorkerPort {
  postMessage(message: AnalysisWorkerRequest): void
  terminate(): void
  onmessage: ((event: { data: AnalysisWorkerResponse }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
}

export interface RunHandlers {
  onProgress: (progress: EngineProgress) => void
  onResult: (result: AnalysisResult) => void
  onRejected: (stats: ParseStats, reason: string) => void
  onCancelled: () => void
  onError: (code: AnalysisFailureCode, message: string) => void
  onLog: (event: LogEvent) => void
}

export interface RunRequest {
  file: File
  pricing: PricingConfig
  logLevel: LogLevel
}

export interface RunnerOptions {
  createWorker: () => AnalysisWorkerPort
  /** How long a cooperative cancel gets before the worker is killed outright. */
  hardStopDelayMs?: number
}

const DEFAULT_HARD_STOP_DELAY_MS = 2000

/** The real worker, kept behind a factory so tests never spawn one. */
export function createBrowserAnalysisWorker(): AnalysisWorkerPort {
  return new Worker(new URL('../worker/analysis.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as AnalysisWorkerPort
}

export interface AnalysisRunner {
  start(request: RunRequest, handlers: RunHandlers): void
  cancel(): void
  /** Kill any in-flight run without reporting it — for unmount. */
  dispose(): void
  readonly isRunning: boolean
}

export function createAnalysisRunner(options: RunnerOptions): AnalysisRunner {
  const hardStopDelayMs = options.hardStopDelayMs ?? DEFAULT_HARD_STOP_DELAY_MS

  let worker: AnalysisWorkerPort | null = null
  let handlers: RunHandlers | null = null
  let hardStopTimer: ReturnType<typeof setTimeout> | null = null

  /** Detach and kill the worker; every terminal path goes through here so a
   * worker can never outlive the run that owns it. */
  function teardown(): RunHandlers | null {
    const finished = handlers
    if (hardStopTimer !== null) {
      clearTimeout(hardStopTimer)
      hardStopTimer = null
    }
    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      worker = null
    }
    handlers = null
    return finished
  }

  function handleMessage(message: AnalysisWorkerResponse): void {
    const active = handlers
    if (!active) return
    switch (message.type) {
      case 'progress':
        active.onProgress(message.progress)
        break
      case 'log':
        active.onLog(message.event)
        break
      case 'result':
        teardown()
        active.onResult(message.result)
        break
      case 'rejected':
        teardown()
        active.onRejected(message.stats, message.reason)
        break
      case 'cancelled':
        teardown()
        active.onCancelled()
        break
      case 'error':
        teardown()
        active.onError(message.code, message.message)
        break
    }
  }

  return {
    get isRunning() {
      return worker !== null
    },

    start(request, nextHandlers) {
      if (worker) throw new Error('an analysis is already running')
      handlers = nextHandlers
      const port = options.createWorker()
      worker = port
      port.onmessage = (event) => handleMessage(event.data)
      // A worker that dies before posting any protocol message — a script that
      // fails to load, a CSP violation — would otherwise hang the UI on
      // "analyzing" forever.
      port.onerror = (event) => {
        const active = teardown()
        active?.onError('internal', event.message ?? '')
      }
      port.postMessage({
        type: 'start',
        file: request.file,
        pricing: request.pricing,
        logLevel: request.logLevel,
      })
    },

    cancel() {
      if (!worker || hardStopTimer !== null) return
      worker.postMessage({ type: 'cancel' })
      hardStopTimer = setTimeout(() => {
        hardStopTimer = null
        const active = teardown()
        active?.onCancelled()
      }, hardStopDelayMs)
    },

    dispose() {
      teardown()
    },
  }
}
