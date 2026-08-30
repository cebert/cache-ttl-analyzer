/**
 * WP-01/WP-02 placeholder: exercises the frozen contract end-to-end through
 * a real Web Worker. The real UI (and the i18n catalog this throwaway
 * screen skips) lands in WP-07/08 against WP-D's designs.
 */

import { useEffect, useRef, useState } from 'react'
import type { AnalysisResult, EngineProgress } from './engine/contract'
import type { AnalysisWorkerRequest, AnalysisWorkerResponse } from './engine/protocol'
import type { PricingConfig } from './engine/pricing'
import { createLogger, getLogLevel } from './lib/logger'

const log = createLogger('app')

// Placeholder pricing for the stub run. src/config/pricing.json does not
// exist yet — WP-04 creates it from Anthropic's published pricing pages
// (URLs in src/engine/pricing.ts) and this inline object goes away.
const stubPricing: PricingConfig = {
  pricesAsOf: '2026-08-30',
  source: 'https://platform.claude.com/docs/en/about-claude/pricing',
  cacheMultipliers: { read: 0.1, write5m: 1.25, write1h: 2.0 },
  models: {},
}

type DemoState =
  | { phase: 'idle' }
  | { phase: 'running'; progress: EngineProgress | null }
  | { phase: 'done'; result: AnalysisResult }
  | { phase: 'cancelled' }
  | { phase: 'error'; message: string }

export default function App() {
  const workerRef = useRef<Worker | null>(null)
  const [state, setState] = useState<DemoState>({ phase: 'idle' })

  useEffect(() => () => workerRef.current?.terminate(), [])

  function runStubAnalysis() {
    workerRef.current?.terminate()
    const worker = new Worker(new URL('./worker/analysis.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    setState({ phase: 'running', progress: null })

    worker.onmessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
      const message = event.data
      switch (message.type) {
        case 'progress':
          setState({ phase: 'running', progress: message.progress })
          break
        case 'result':
          setState({ phase: 'done', result: message.result })
          break
        case 'rejected':
          setState({ phase: 'error', message: message.reason })
          break
        case 'cancelled':
          setState({ phase: 'cancelled' })
          break
        case 'error':
          setState({ phase: 'error', message: `${message.code}: ${message.message}` })
          break
        case 'log':
          log[message.event.level]('(worker)', ...message.event.args)
          break
      }
    }

    // A worker that fails before posting any protocol message (e.g. script
    // load failure) would otherwise leave the UI stuck in "running".
    worker.onerror = (event) => {
      log.error('worker failed', event.message)
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
      setState({ phase: 'error', message: event.message || 'worker failed to start' })
    }

    const file = new File(['{"type":"assistant"}\n'], 'stub-session.jsonl', {
      type: 'application/jsonl',
    })
    const start: AnalysisWorkerRequest = {
      type: 'start',
      file,
      pricing: stubPricing,
      logLevel: getLogLevel(),
    }
    worker.postMessage(start)
  }

  function cancel() {
    const cancelMessage: AnalysisWorkerRequest = { type: 'cancel' }
    workerRef.current?.postMessage(cancelMessage)
  }

  return (
    <main>
      <h1>Cache TTL Analyzer</h1>
      <p>
        Analyze a Claude Code session log to see whether a 5-minute or 1-hour prompt-cache TTL would
        have cost less — entirely in your browser. Under construction; this placeholder exercises
        the frozen engine contract through a stub Web Worker.
      </p>
      <p>
        <button onClick={runStubAnalysis} disabled={state.phase === 'running'}>
          Run stub analysis
        </button>{' '}
        <button onClick={cancel} disabled={state.phase !== 'running'}>
          Cancel
        </button>
      </p>
      {state.phase === 'running' && (
        <p>
          Analyzing…{' '}
          {state.progress
            ? `${state.progress.phase} — ${state.progress.bytesProcessed}/${state.progress.totalBytes} bytes`
            : 'starting worker'}
        </p>
      )}
      {state.phase === 'cancelled' && <p>Analysis cancelled.</p>}
      {state.phase === 'error' && <p>Analysis failed: {state.message}</p>}
      {state.phase === 'done' && (
        <>
          <p>
            Stub verdict: <strong>{state.result.buckets[0]?.recommendation}</strong> (canned data,
            prices as of {state.result.pricesAsOf})
          </p>
          <pre>{JSON.stringify(state.result, null, 2)}</pre>
        </>
      )}
    </main>
  )
}
