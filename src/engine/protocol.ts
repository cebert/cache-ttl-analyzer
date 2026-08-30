/**
 * WP-02 — the Web Worker message protocol (frozen with the contract).
 *
 * The main thread owns the Worker lifecycle. Cancellation has two layers:
 * a cooperative `cancel` message (the engine aborts via `AbortSignal` and
 * replies `cancelled`), and the host's `Worker.terminate()` as the hard
 * stop (always available; the UI's cancel button may use both).
 *
 * Worker log events are forwarded to the main thread as `log` messages so
 * the D13 logging abstraction covers worker code; the host replays them
 * into its own logger sink. Log args must obey the sensitive-data rule in
 * `src/lib/logger.ts`.
 */

import type { AnalysisResult, EngineProgress, ParseStats } from './contract'
import type { LogEvent, LogLevel } from '../lib/logger'
import type { PricingConfig } from './pricing'

/** Main thread -> worker. */
export type AnalysisWorkerRequest =
  | {
      type: 'start'
      /** `File` is structured-cloneable; the worker streams it (PLAN §2). */
      file: File
      pricing: PricingConfig
      /** Propagates the host's resolved log level into the worker. */
      logLevel: LogLevel
    }
  | { type: 'cancel' }

/** Worker -> main thread. */
export type AnalysisWorkerResponse =
  | { type: 'progress'; progress: EngineProgress }
  | { type: 'result'; result: AnalysisResult }
  | {
      type: 'rejected'
      verdict: 'not-a-session-log'
      stats: ParseStats
      /** Plain-language, translatable-key-friendly reason code. */
      reason: string
    }
  | { type: 'cancelled' }
  | {
      type: 'error'
      code: 'file-too-large' | 'read-failure' | 'internal'
      message: string
    }
  | { type: 'log'; event: LogEvent }
