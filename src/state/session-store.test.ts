import { describe, expect, it } from 'vitest'

import type { AnalysisResult, EngineProgress, ParseStats } from '../engine/contract'
import { makeStubResult } from '../engine/stub'
import {
  initialSessionsState,
  isBusy,
  selectSession,
  sessionsReducer,
  type SessionsState,
} from './session-store'

const RESULT: AnalysisResult = makeStubResult('session.jsonl', 4200, '2026-08-30')

const STATS: ParseStats = {
  totalLines: 10,
  nonEmptyLines: 10,
  malformedLines: 10,
  skippedRecordTypes: {},
  assistantRows: 0,
  dedupedRequests: 0,
  syntheticRowsExcluded: 0,
  invalidUsageRowsSkipped: 0,
}

function started(state: SessionsState = initialSessionsState, id = 'a'): SessionsState {
  return sessionsReducer(state, {
    type: 'started',
    id,
    fileName: `${id}.jsonl`,
    fileSizeBytes: 4200,
  })
}

const PROGRESS: EngineProgress = {
  phase: 'parsing',
  bytesProcessed: 2100,
  totalBytes: 4200,
  requestsSeen: 12,
}

describe('sessionsReducer', () => {
  it('puts a new run at the top of the list, selected and running', () => {
    const state = started()
    expect(state.sessions).toHaveLength(1)
    expect(state.selectedId).toBe('a')
    expect(state.runningId).toBe('a')
    expect(isBusy(state)).toBe(true)
  })

  it('orders newest first, because the newest run is the one being watched', () => {
    const state = started(started(), 'b')
    expect(state.sessions.map((session) => session.id)).toEqual(['b', 'a'])
  })

  it('records progress for the running analysis', () => {
    const state = sessionsReducer(started(), { type: 'progress', id: 'a', progress: PROGRESS })
    expect(state.sessions[0].status).toEqual({ phase: 'analyzing', progress: PROGRESS })
  })

  it('ignores progress arriving after the run finished, which would rewind it', () => {
    const done = sessionsReducer(started(), { type: 'completed', id: 'a', result: RESULT })
    const after = sessionsReducer(done, { type: 'progress', id: 'a', progress: PROGRESS })
    expect(after).toBe(done)
    expect(after.sessions[0].status.phase).toBe('complete')
  })

  it('frees the single worker slot on every terminal outcome', () => {
    const cases = [
      { type: 'completed', id: 'a', result: RESULT },
      { type: 'rejected', id: 'a', stats: STATS, reason: 'no-assistant-usage-rows' },
      { type: 'cancelled', id: 'a' },
      { type: 'failed', id: 'a', code: 'internal', message: 'boom' },
    ] as const
    for (const action of cases) {
      const state = sessionsReducer(started(), action)
      expect(isBusy(state), action.type).toBe(false)
      expect(state.sessions[0].status.phase).not.toBe('analyzing')
    }
  })

  it('ignores a message for a run the user already removed', () => {
    const removed = sessionsReducer(started(), { type: 'remove', id: 'a' })
    const late = sessionsReducer(removed, { type: 'completed', id: 'a', result: RESULT })
    expect(late.sessions).toHaveLength(0)
  })

  it('clears the worker slot when the running analysis is removed', () => {
    const state = sessionsReducer(started(), { type: 'remove', id: 'a' })
    expect(isBusy(state)).toBe(false)
    expect(state.selectedId).toBeNull()
  })

  it('deselects to the upload screen, and refuses to select an unknown id', () => {
    const state = started()
    expect(sessionsReducer(state, { type: 'select', id: null }).selectedId).toBeNull()
    expect(sessionsReducer(state, { type: 'select', id: 'ghost' }).selectedId).toBe('a')
  })

  it('resolves the selected entry', () => {
    const state = started(started(), 'b')
    expect(selectSession(state)?.id).toBe('b')
    expect(selectSession(sessionsReducer(state, { type: 'select', id: null }))).toBeNull()
  })
})
