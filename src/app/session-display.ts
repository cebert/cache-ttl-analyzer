/**
 * Derivations the sidebar and headers need from a session entry.
 *
 * Everything here reads log-derived strings — session id, cwd, file name —
 * which are untrusted input (docs/PLAN.md §2). They are only ever returned as
 * plain strings for React to render as text nodes, never as markup, and the
 * parser has already stripped control characters and clamped their length.
 */

import type { AnalysisResult, BucketId, CacheTtl } from '../engine/contract'
import type { SessionEntry } from '../state/session-store'

/** Enough of a UUID to tell two sessions apart in a 236px column. */
const SHORT_ID_LENGTH = 8

export function shortSessionId(entry: SessionEntry): string {
  const sessionId = completedResult(entry)?.metadata.sessionId
  if (sessionId) return sessionId.slice(0, SHORT_ID_LENGTH)
  return stripExtension(entry.fileName)
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

/**
 * The project a session ran in — the last segment of `cwd`, shown with a `~/`
 * prefix as the designs do. Absent when the log carried no `cwd`.
 */
export function projectLabel(entry: SessionEntry): string | null {
  const cwd = completedResult(entry)?.metadata.cwd
  if (!cwd) return null
  const segments = cwd.split(/[\\/]/).filter(Boolean)
  const last = segments.at(-1)
  return last ? `~/${last}` : null
}

export function completedResult(entry: SessionEntry): AnalysisResult | null {
  return entry.status.phase === 'complete' ? entry.status.result : null
}

export function bucketOf(result: AnalysisResult, bucket: BucketId) {
  return result.buckets.find((candidate) => candidate.bucket === bucket) ?? null
}

/**
 * The headline verdict for the sidebar: the main bucket's recommendation and
 * what it saves. Suppressed verdicts return no TTL, because the sidebar must
 * not show a recommendation the results page refuses to make.
 */
export function headlineVerdict(entry: SessionEntry): { ttl: CacheTtl; savingsUsd: number } | null {
  const result = completedResult(entry)
  const main = result ? bucketOf(result, 'main') : null
  if (!main || main.verdictSuppressed || main.recommendation === 'no-verdict') return null
  return { ttl: main.recommendation, savingsUsd: main.savingsUsd }
}

/** Fraction complete, 0–1, or null before the first progress message. */
export function progressRatio(entry: SessionEntry): number | null {
  if (entry.status.phase !== 'analyzing') return null
  const progress = entry.status.progress
  if (!progress || progress.totalBytes <= 0) return null
  return Math.min(1, Math.max(0, progress.bytesProcessed / progress.totalBytes))
}

/** The title shown in the top bar for a finished session. */
export function sessionTitle(entry: SessionEntry): string | null {
  return completedResult(entry)?.metadata.title ?? null
}
