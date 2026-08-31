/**
 * Binds the session store and the analysis runner to React, and is the only
 * place the two meet. Everything below it reads state and calls actions.
 *
 * `createWorker` is injectable so tests drive the full flow — start, progress,
 * result, rejection, cancel — against the real protocol handler and the WP-02
 * stub engine without spawning a thread.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { PRICING } from '../config/pricing'
import { createLogger, getLogLevel } from '../lib/logger'
import {
  createAnalysisRunner,
  createBrowserAnalysisWorker,
  type AnalysisWorkerPort,
} from './analysis-runner'
import { inspectFile } from './file-validation'
import {
  SessionsContext,
  type PendingFileIssue,
  type SessionsContextValue,
} from './sessions-context'
import { initialSessionsState, isBusy, selectSession, sessionsReducer } from './session-store'

const log = createLogger('sessions')

export interface SessionsProviderProps {
  children: ReactNode
  /** Overridden in tests; defaults to the real module worker. */
  createWorker?: () => AnalysisWorkerPort
  hardStopDelayMs?: number
}

export function SessionsProvider({
  children,
  createWorker = createBrowserAnalysisWorker,
  hardStopDelayMs,
}: SessionsProviderProps) {
  const [state, dispatch] = useReducer(sessionsReducer, initialSessionsState)
  const [fileIssue, setFileIssue] = useState<PendingFileIssue | null>(null)

  // Built once, from the first render's props: a runner swapped mid-flight
  // would orphan a running worker. Both props are wiring, fixed for the life
  // of the provider.
  const runnerRef = useRef<ReturnType<typeof createAnalysisRunner> | null>(null)
  if (runnerRef.current === null) {
    runnerRef.current = createAnalysisRunner({ createWorker, hardStopDelayMs })
  }

  // A worker outliving the page that started it would keep a file handle and
  // a thread alive for nothing.
  useEffect(() => {
    const runner = runnerRef.current
    return () => runner?.dispose()
  }, [])

  const analyze = useCallback(
    (file: File, { ignoreAdvisory = false }: { ignoreAdvisory?: boolean } = {}) => {
      const runner = runnerRef.current
      if (!runner || runner.isRunning) {
        log.warn('analyze ignored: a run is already active')
        return false
      }
      const issue = inspectFile(file)
      // An advisory issue is a prompt, not a refusal: the UI surfaces it and
      // the user's "analyze it anyway" calls back with `ignoreAdvisory`.
      if (issue && (issue.severity === 'blocking' || !ignoreAdvisory)) {
        setFileIssue({ issue, file })
        return false
      }
      setFileIssue(null)

      const id = newAnalysisId()
      // Never log the file name — it is user data (see the logger's
      // sensitive-data rule); the size is a count and is safe.
      log.info('analysis started', { sizeBytes: file.size })
      dispatch({ type: 'started', id, fileName: file.name, fileSizeBytes: file.size })

      runner.start(
        { file, pricing: PRICING, logLevel: getLogLevel() },
        {
          onProgress: (progress) => dispatch({ type: 'progress', id, progress }),
          onResult: (result) => dispatch({ type: 'completed', id, result }),
          onRejected: (stats, reason) => dispatch({ type: 'rejected', id, stats, reason }),
          onCancelled: () => dispatch({ type: 'cancelled', id }),
          onError: (code, message) => dispatch({ type: 'failed', id, code, message }),
          onLog: (event) => log[event.level](`(worker/${event.scope})`, ...event.args),
        },
      )
      return true
    },
    [],
  )

  // Deliberately not a `setFileIssue` updater: starting an analysis is a side
  // effect, and StrictMode runs updaters twice.
  const acceptFileIssue = useCallback(() => {
    if (fileIssue?.issue.severity !== 'advisory') return
    setFileIssue(null)
    analyze(fileIssue.file, { ignoreAdvisory: true })
  }, [fileIssue, analyze])

  const cancel = useCallback(() => runnerRef.current?.cancel(), [])
  const select = useCallback((id: string | null) => dispatch({ type: 'select', id }), [])
  const dismissFileIssue = useCallback(() => setFileIssue(null), [])

  const value = useMemo<SessionsContextValue>(
    () => ({
      state,
      selected: selectSession(state),
      busy: isBusy(state),
      fileIssue,
      analyze,
      acceptFileIssue,
      cancel,
      select,
      dismissFileIssue,
    }),
    [state, fileIssue, analyze, acceptFileIssue, cancel, select, dismissFileIssue],
  )

  return <SessionsContext value={value}>{children}</SessionsContext>
}

/** `crypto.randomUUID` needs a secure context; the fallback keeps local HTTP
 * development and older embedded browsers working. Ids are local React keys
 * only — nothing depends on them being unguessable. */
function newAnalysisId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `analysis-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
