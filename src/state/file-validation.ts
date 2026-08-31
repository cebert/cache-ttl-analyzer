/**
 * Pre-flight checks the shell runs before a file reaches the worker
 * (docs/PLAN.md §2, "Resource limits"). The parser is the authority on
 * whether a file is a session log; this only catches the two things that are
 * cheaper to answer from the file handle than from a streamed parse.
 *
 * The extension check is advisory on purpose: the cap and the empty file are
 * hard limits, but a log the user renamed is still a log, so a wrong
 * extension warns and offers to proceed rather than refusing.
 */

import { MAX_FILE_SIZE_BYTES } from '../engine/contract'

export const SESSION_LOG_EXTENSION = '.jsonl'

export type FileIssue =
  | { severity: 'blocking'; kind: 'too-large'; sizeBytes: number; limitBytes: number }
  | { severity: 'blocking'; kind: 'empty' }
  | { severity: 'advisory'; kind: 'wrong-extension'; fileName: string }

/** The subset of `File` the checks need, so they run without a DOM. */
export interface InspectableFile {
  name: string
  size: number
}

export function inspectFile(file: InspectableFile): FileIssue | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      severity: 'blocking',
      kind: 'too-large',
      sizeBytes: file.size,
      limitBytes: MAX_FILE_SIZE_BYTES,
    }
  }
  if (file.size === 0) return { severity: 'blocking', kind: 'empty' }
  if (!file.name.toLowerCase().endsWith(SESSION_LOG_EXTENSION)) {
    return { severity: 'advisory', kind: 'wrong-extension', fileName: file.name }
  }
  return null
}
