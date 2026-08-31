/**
 * The sessions context and its hook, split from the provider component so the
 * provider module exports only a component (which is what keeps React Fast
 * Refresh working across edits to it).
 */

import { createContext, useContext } from 'react'

import type { FileIssue } from './file-validation'
import type { SessionEntry, SessionsState } from './session-store'

/** A file a pre-flight check stopped, kept so an advisory can be overridden. */
export interface PendingFileIssue {
  issue: FileIssue
  file: File
}

export interface SessionsContextValue {
  state: SessionsState
  selected: SessionEntry | null
  busy: boolean
  /** The blocking or advisory issue with the file the user just offered. */
  fileIssue: PendingFileIssue | null
  /** Start an analysis. Returns false when a pre-flight check blocked it. */
  analyze: (file: File, options?: { ignoreAdvisory?: boolean }) => boolean
  /** Proceed with the file an advisory check stopped. */
  acceptFileIssue: () => void
  cancel: () => void
  select: (id: string | null) => void
  dismissFileIssue: () => void
}

export const SessionsContext = createContext<SessionsContextValue | null>(null)

export function useSessions(): SessionsContextValue {
  const value = useContext(SessionsContext)
  if (!value) throw new Error('useSessions must be used inside a SessionsProvider')
  return value
}
