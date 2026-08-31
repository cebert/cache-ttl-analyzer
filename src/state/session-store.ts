/**
 * The in-memory history of this browser session's analyses (decision D3:
 * nothing is persisted, and reloading the tab clears everything) plus the
 * reducer that drives it. Kept free of React and of `Worker` so the whole
 * state machine is unit-testable; `SessionsProvider` supplies both.
 *
 * One analysis runs at a time. That is the worker protocol's own rule — the
 * handler ignores a second `start` while a run is active — so the store
 * refuses to enqueue one rather than letting the UI silently drop it.
 */

import type { AnalysisResult, EngineProgress, ParseStats } from '../engine/contract'

/** Reason codes the engine returns with a `not-a-session-log` verdict. */
export type RejectionReason = 'malformed-lines-exceed-threshold' | 'no-assistant-usage-rows'

export type AnalysisStatus =
  | { phase: 'analyzing'; progress: EngineProgress | null }
  | { phase: 'complete'; result: AnalysisResult }
  | { phase: 'rejected'; stats: ParseStats; reason: string }
  | { phase: 'cancelled' }
  | { phase: 'failed'; code: 'file-too-large' | 'read-failure' | 'internal'; message: string }

export interface SessionEntry {
  /** Local id for this analysis. Not the log's `sessionId`, which only
   * exists once parsing has succeeded and is not guaranteed unique here. */
  id: string
  fileName: string
  fileSizeBytes: number
  status: AnalysisStatus
}

export interface SessionsState {
  sessions: SessionEntry[]
  /** The entry the main pane is showing, or null for the upload screen. */
  selectedId: string | null
  /** The entry currently being analyzed, if any. At most one (see above). */
  runningId: string | null
}

export const initialSessionsState: SessionsState = {
  sessions: [],
  selectedId: null,
  runningId: null,
}

export type SessionsAction =
  | { type: 'started'; id: string; fileName: string; fileSizeBytes: number }
  | { type: 'progress'; id: string; progress: EngineProgress }
  | { type: 'completed'; id: string; result: AnalysisResult }
  | { type: 'rejected'; id: string; stats: ParseStats; reason: string }
  | { type: 'cancelled'; id: string }
  | { type: 'failed'; id: string; code: AnalysisFailureCode; message: string }
  | { type: 'select'; id: string | null }
  // Not yet reachable from the UI: WP-D designed a "clear analysis history"
  // dialog that WP-08 or later will wire to it. Kept because forgetting a run
  // is the other half of remembering one, and the reducer is where that
  // belongs.
  | { type: 'remove'; id: string }

export type AnalysisFailureCode = Extract<AnalysisStatus, { phase: 'failed' }>['code']

function withStatus(
  state: SessionsState,
  id: string,
  status: AnalysisStatus,
  { clearRunning }: { clearRunning: boolean },
): SessionsState {
  // A late message from a run the user already discarded must not resurrect
  // it, so an unknown id is a no-op rather than an insert.
  if (!state.sessions.some((session) => session.id === id)) return state
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === id ? { ...session, status } : session,
    ),
    runningId: clearRunning && state.runningId === id ? null : state.runningId,
  }
}

export function sessionsReducer(state: SessionsState, action: SessionsAction): SessionsState {
  switch (action.type) {
    case 'started': {
      const entry: SessionEntry = {
        id: action.id,
        fileName: action.fileName,
        fileSizeBytes: action.fileSizeBytes,
        status: { phase: 'analyzing', progress: null },
      }
      // Newest first: the sidebar reads top-down and the run just started is
      // the one the user is watching.
      return {
        sessions: [entry, ...state.sessions],
        selectedId: entry.id,
        runningId: entry.id,
      }
    }
    case 'progress':
      // Progress after a terminal message would rewind a finished run.
      return state.runningId === action.id
        ? withStatus(
            state,
            action.id,
            { phase: 'analyzing', progress: action.progress },
            {
              clearRunning: false,
            },
          )
        : state
    case 'completed':
      return withStatus(
        state,
        action.id,
        { phase: 'complete', result: action.result },
        {
          clearRunning: true,
        },
      )
    case 'rejected':
      return withStatus(
        state,
        action.id,
        { phase: 'rejected', stats: action.stats, reason: action.reason },
        { clearRunning: true },
      )
    case 'cancelled':
      return withStatus(state, action.id, { phase: 'cancelled' }, { clearRunning: true })
    case 'failed':
      return withStatus(
        state,
        action.id,
        { phase: 'failed', code: action.code, message: action.message },
        { clearRunning: true },
      )
    case 'select':
      return action.id === null || state.sessions.some((session) => session.id === action.id)
        ? { ...state, selectedId: action.id }
        : state
    case 'remove': {
      const sessions = state.sessions.filter((session) => session.id !== action.id)
      return {
        sessions,
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        runningId: state.runningId === action.id ? null : state.runningId,
      }
    }
  }
}

export function selectSession(state: SessionsState): SessionEntry | null {
  return state.sessions.find((session) => session.id === state.selectedId) ?? null
}

/** True while an analysis holds the single worker slot. */
export function isBusy(state: SessionsState): boolean {
  return state.runningId !== null
}
