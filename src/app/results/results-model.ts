/**
 * WP-08 — the derivations behind the results view.
 *
 * The results screen shows a handful of things `AnalysisResult` does not
 * carry as fields: a cache hit rate, the model/effort segments a session ran
 * in, timeline marker positions, and the ordered list of resets. All of them
 * follow from the contract, so they are computed here — pure functions over
 * the result, unit-tested — and the components stay presentational.
 *
 * Nothing here reads message content, and every log-derived string it
 * returns (model ids, efforts) is returned as a plain string for React to
 * render as a text node (docs/PLAN.md §2). The parser has already stripped
 * control characters and clamped their length.
 */

import {
  type AnalysisResult,
  type BucketAnalysis,
  type CacheTtl,
  type HardResetCause,
  type InsightEvent,
  type ParseStats,
} from '../../engine/contract'

/* ---------------------------------------------------------------------------
 * Headline metrics.
 * ------------------------------------------------------------------------- */

/**
 * Cache hit rate: the read share of every input-side token the bucket used.
 * Output tokens are excluded — they are never cacheable, so including them
 * would make a session look worse the more it wrote.
 */
export function cacheHitRate(bucket: BucketAnalysis): number | null {
  const { inputTokens, cacheReadTokens, cacheWriteTokens } = bucket.tokenTotals
  const denominator = inputTokens + cacheReadTokens + cacheWriteTokens
  return denominator === 0 ? null : cacheReadTokens / denominator
}

/**
 * The share of assistant rows the API returned as `<synthetic>` — Claude
 * Code's placeholder for a failed request (feasibility §6.2). Session-wide:
 * the parser excludes those rows before bucketing, so they have no bucket.
 *
 * Counted in rows rather than requests, because a `<synthetic>` row carries
 * no usage to dedup on; a failure spanning content blocks would count twice.
 */
export function errorRate(stats: ParseStats): number | null {
  const total = stats.dedupedRequests + stats.syntheticRowsExcluded
  return total === 0 ? null : stats.syntheticRowsExcluded / total
}

/** Whether every cache write in the bucket used the observed TTL. */
export function writesAreUniform(bucket: BucketAnalysis): boolean {
  const { fiveMinuteWriteTokens, oneHourWriteTokens } = bucket.observedWriteSplit
  return fiveMinuteWriteTokens === 0 || oneHourWriteTokens === 0
}

/* ---------------------------------------------------------------------------
 * Configuration segments (the model/effort strip).
 * ------------------------------------------------------------------------- */

export interface ConfigSegment {
  /** Fraction of the session span where the segment starts and ends, 0–1. */
  start: number
  end: number
  model: string
  effort?: string
}

/**
 * The stretches of the session that ran under one model and effort.
 *
 * Derived from the hard-reset events rather than from a new contract field:
 * a reset carries the value it changed `from` and `to`, so the first
 * segment's model is the first model-change's `from` (and `metadata.models`
 * when nothing ever changed). Version changes reset the cache too, but they
 * are not part of a segment's identity — the strip labels what the user
 * chose, and two segments either side of an upgrade would read as noise.
 */
export function configSegments(result: AnalysisResult, bucket: BucketAnalysis): ConfigSegment[] {
  const window = timelineWindow(bucket)
  if (!window) return []
  const resets = orderedResets(bucket).filter(
    (reset) => reset.cause === 'model-change' || reset.cause === 'effort-change',
  )

  // Walk backwards from the first change of each kind to find what the
  // session started with; fall back to the metadata when it never changed.
  let model =
    resets.find((r) => r.cause === 'model-change')?.from ?? result.metadata.models[0] ?? ''
  let effort = resets.find((r) => r.cause === 'effort-change')?.from ?? result.metadata.efforts[0]

  const segments: ConfigSegment[] = []
  let start = 0
  for (const reset of resets) {
    const at = positionInWindow(reset.timestamp, window)
    // Two causes on one request (a `/model` switch that also changes effort)
    // are one boundary, not two empty segments.
    if (at > start) {
      segments.push({ start, end: at, model, ...(effort ? { effort } : {}) })
      start = at
    }
    if (reset.cause === 'model-change') model = reset.to
    else effort = reset.to
  }
  segments.push({ start, end: 1, model, ...(effort ? { effort } : {}) })
  return segments
}

export interface ResetRow {
  timestamp: string
  cause: HardResetCause
  from: string
  to: string
  /** 1-based position of the request in the bucket, as the designs label it. */
  requestNumber: number
}

/** Hard resets in time order, each numbered by the request it happened on. */
export function orderedResets(bucket: BucketAnalysis): ResetRow[] {
  const order = requestOrder(bucket)
  const rows: ResetRow[] = []
  for (const event of bucket.scenarios.oneHour.events) {
    if (event.kind !== 'hard-reset') continue
    rows.push({
      timestamp: event.timestamp,
      cause: event.cause,
      from: event.from,
      to: event.to,
      requestNumber: (order.get(event.messageId) ?? 0) + 1,
    })
  }
  return rows
}

/**
 * Tokens rewritten because of a hard reset — the same under either TTL,
 * which is the point the designs make next to the reset list.
 */
export function resetWastedTokens(bucket: BucketAnalysis): number {
  // Resets waste identically in both scenarios; expiries do not. Taking the
  // difference against a scenario with no expiries would be wrong when both
  // have some, so read it from the scenario at the observed TTL, where every
  // expiry is one the log itself shows.
  const observed = observedScenario(bucket)
  return observed.hardResets === 0 ? 0 : observed.wastedWriteTokens
}

/* ---------------------------------------------------------------------------
 * Timeline.
 * ------------------------------------------------------------------------- */

export type MarkerKind = 'warm-read' | 'expiry' | 'write-only'

export interface TimelineMarker {
  /** Fraction of the session span, 0–1. */
  position: number
  kind: MarkerKind
  timestamp: string
  messageId: string
}

export interface TimelineWindow {
  startMs: number
  endMs: number
}

/** The span the timeline draws across, or null when it would be degenerate. */
export function timelineWindow(bucket: BucketAnalysis): TimelineWindow | null {
  const events = bucket.scenarios.oneHour.events
  if (events.length === 0) return null
  const startMs = Date.parse(events[0].timestamp)
  const endMs = Date.parse(events[events.length - 1].timestamp)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  return { startMs, endMs }
}

function positionInWindow(timestamp: string, window: TimelineWindow): number {
  const span = window.endMs - window.startMs
  if (span <= 0) return 0
  const at = (Date.parse(timestamp) - window.startMs) / span
  return Math.min(1, Math.max(0, at))
}

/**
 * One marker per request, positioned in time and coloured by what the
 * request did at the *observed* TTL — what the log shows, not a
 * counterfactual. A request that both read and expired reads as an expiry,
 * since that is the event worth seeing.
 */
export function timelineMarkers(bucket: BucketAnalysis): TimelineMarker[] {
  const window = timelineWindow(bucket)
  if (!window) return []
  const byRequest = new Map<string, TimelineMarker>()
  for (const event of observedScenario(bucket).events) {
    const kind = markerKind(event)
    if (!kind) continue
    const existing = byRequest.get(event.messageId)
    if (existing && !(kind === 'expiry' && existing.kind !== 'expiry')) continue
    byRequest.set(event.messageId, {
      position: positionInWindow(event.timestamp, window),
      kind,
      timestamp: event.timestamp,
      messageId: event.messageId,
    })
  }
  return [...byRequest.values()].sort((a, b) => a.position - b.position)
}

function markerKind(event: InsightEvent): MarkerKind | null {
  if (event.kind === 'expiry') return 'expiry'
  if (event.kind === 'warm-read') return 'warm-read'
  if (event.kind === 'cache-write') return 'write-only'
  return null
}

/** Reset boundaries as fractions of the span, for the rules on the rail. */
export function resetPositions(bucket: BucketAnalysis): number[] {
  const window = timelineWindow(bucket)
  if (!window) return []
  const positions = new Set<number>()
  for (const reset of orderedResets(bucket)) {
    positions.add(positionInWindow(reset.timestamp, window))
  }
  return [...positions]
}

/* ---------------------------------------------------------------------------
 * Shared helpers.
 * ------------------------------------------------------------------------- */

/**
 * The scenario that reproduces the log. With no observed TTL (a bucket that
 * wrote nothing) either scenario shows the same events, so the choice is
 * arbitrary and 5m is as good as 1h.
 */
export function observedScenario(bucket: BucketAnalysis) {
  return bucket.observedTtl === '1h' ? bucket.scenarios.oneHour : bucket.scenarios.fiveMinute
}

export function scenarioFor(bucket: BucketAnalysis, ttl: CacheTtl) {
  return ttl === '1h' ? bucket.scenarios.oneHour : bucket.scenarios.fiveMinute
}

/** Request index by message id, in the order the events first mention them. */
function requestOrder(bucket: BucketAnalysis): Map<string, number> {
  const order = new Map<string, number>()
  for (const event of bucket.scenarios.oneHour.events) {
    if (!order.has(event.messageId)) order.set(event.messageId, order.size)
  }
  return order
}

/** The bucket the headline speaks for, and its counterpart. */
export function mainBucket(result: AnalysisResult): BucketAnalysis | null {
  return result.buckets.find((bucket) => bucket.bucket === 'main') ?? null
}

export function subagentBucket(result: AnalysisResult): BucketAnalysis | null {
  const bucket = result.buckets.find((candidate) => candidate.bucket === 'subagent')
  // An empty bucket is the engine saying "no sidechain traffic here", which
  // the view states in words rather than rendering as a section (F2).
  return bucket && bucket.requestCount > 0 ? bucket : null
}
