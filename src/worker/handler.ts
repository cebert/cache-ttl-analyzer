/**
 * Protocol state machine for the analysis worker, factored out of the worker
 * entry so it is unit-testable in Node (no `self`/`postMessage` globals).
 */

import type { AnalysisEngine } from '../engine/contract'
import type { AnalysisWorkerRequest, AnalysisWorkerResponse } from '../engine/protocol'
import { createLogger, setLogLevel, setLogSink } from '../lib/logger'

const log = createLogger('worker')

export interface WorkerFileInput {
  /** Structural subset of `File` so tests can pass a plain object. */
  name: string
  size: number
  stream: () => ReadableStream<Uint8Array>
}

export function createAnalysisWorkerHandler(
  engine: AnalysisEngine,
  post: (message: AnalysisWorkerResponse) => void,
) {
  let controller: AbortController | null = null

  // Route worker-side log events over the protocol (decision D13).
  setLogSink((event) => post({ type: 'log', event }))

  async function start(
    file: WorkerFileInput,
    request: Extract<AnalysisWorkerRequest, { type: 'start' }>,
  ) {
    controller = new AbortController()
    const { signal } = controller
    try {
      const outcome = await engine.analyze(
        {
          stream: file.stream(),
          fileName: file.name,
          fileSizeBytes: file.size,
          pricing: request.pricing,
        },
        { onProgress: (progress) => post({ type: 'progress', progress }), signal },
      )
      if (signal.aborted) {
        post({ type: 'cancelled' })
      } else if (outcome.kind === 'analysis') {
        post({ type: 'result', result: outcome.result })
      } else {
        post({
          type: 'rejected',
          verdict: outcome.verdict,
          stats: outcome.stats,
          reason: outcome.reason,
        })
      }
    } catch (err) {
      if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        post({ type: 'cancelled' })
      } else {
        log.error('analysis failed', err instanceof Error ? err.name : typeof err)
        post({
          type: 'error',
          code: 'internal',
          message: err instanceof Error ? err.message : 'unknown error',
        })
      }
    } finally {
      controller = null
    }
  }

  return {
    onMessage(message: AnalysisWorkerRequest): void {
      switch (message.type) {
        case 'start': {
          if (controller) {
            log.warn('start received while a run is active; ignoring')
            return
          }
          setLogLevel(message.logLevel)
          void start(message.file, message)
          break
        }
        case 'cancel': {
          controller?.abort()
          break
        }
      }
    },
  }
}
