/**
 * Everything the results view needs to work out from an `AnalysisResult`.
 *
 * It lives apart from the components for the same reason the engine does:
 * these are the claims on screen — the hit rate, the band that decides the
 * verdict, where the cache lapsed — and they are worth asserting directly
 * rather than through rendered markup.
 *
 * Nothing here formats. Numbers come out as numbers and go through
 * `useFormatters` at the edge, so one `Intl` configuration serves the app
 * (docs/PLAN.md, D10). Log-derived strings (model ids, cwd, branch) pass
 * through as plain strings for React to render as text, never as markup.
 */

import {
  CACHE_TTL_1H_MS,
  CACHE_TTL_5M_MS,
  type AnalysisResult,
  type BucketAnalysis,
  type CacheTtl,
  type HardResetCause,
  type InsightEvent,
  type ParseStats,
  type SessionMetadata,
  type TokenTotals,
} from '../../engine/contract'

/**
 * Share of input tokens served from cache. Denominator is every input token
 * the session paid for in some form — read, written, or sent uncached —
 * which is the same definition the sample cards use.
 */
export function cacheHitRate(usage: TokenTotals): number {
  const denominator = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  return denominator === 0 ? 0 : usage.cacheReadTokens / denominator
}

/**
 * Failed requests, from the `<synthetic>` rows the parser excluded
 * (feasibility §6.2). Null when the log recorded none, so the metric row can
 * drop a column that would only ever read "0%".
 */
export function errorRate(stats: ParseStats): { rate: number; failed: number } | null {
  const failed = stats.syntheticRowsExcluded
  if (failed === 0) return null
  const total = stats.dedupedRequests + failed
  return { rate: total === 0 ? 0 : failed / total, failed }
}

/** Which TTLs the session's own cache writes actually used. */
export type WriteMix = 'all-5m' | 'all-1h' | 'mixed' | 'none'

export function writeMix(bucket: BucketAnalysis): WriteMix {
  const { fiveMinuteWriteTokens, oneHourWriteTokens } = bucket.observedWriteSplit
  if (fiveMinuteWriteTokens === 0 && oneHourWriteTokens === 0) return 'none'
  if (oneHourWriteTokens === 0) return 'all-5m'
  if (fiveMinuteWriteTokens === 0) return 'all-1h'
  return 'mixed'
}

export interface CostComparison {
  fiveMinuteUsd: number
  oneHourUsd: number
  /** The larger of the two, so both bars can be drawn against one scale. */
  maxUsd: number
  cheaper: CacheTtl | null
  /**
   * How much cheaper, as a share of the dearer option. Null when there is
   * nothing to compare against — a zero-cost session, or an exact tie.
   */
  savingsRatio: number | null
}

export function costComparison(bucket: BucketAnalysis): CostComparison {
  const fiveMinuteUsd = bucket.scenarios.fiveMinute.cost.totalUsd
  const oneHourUsd = bucket.scenarios.oneHour.cost.totalUsd
  const maxUsd = Math.max(fiveMinuteUsd, oneHourUsd)
  const minUsd = Math.min(fiveMinuteUsd, oneHourUsd)
  const cheaper = fiveMinuteUsd === oneHourUsd ? null : fiveMinuteUsd < oneHourUsd ? '5m' : '1h'
  return {
    fiveMinuteUsd,
    oneHourUsd,
    maxUsd,
    cheaper,
    savingsRatio: cheaper === null || maxUsd === 0 ? null : (maxUsd - minUsd) / maxUsd,
  }
}

/** A bar's width as a share of the widest, guarded against a zero scale. */
export function barShare(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0
  return Math.min(1, Math.max(0, value / max))
}

/* ---------------------------------------------------------------------------
 * The session's span, which every position on the timeline is relative to.
 * ------------------------------------------------------------------------- */

export interface Span {
  startMs: number
  endMs: number
  durationMs: number
}

/**
 * Null when the log carried no usable timestamps, or when every request
 * landed on the same instant — there is no timeline to draw either way, and
 * a zero-width span would divide by zero.
 */
export function sessionSpan(metadata: SessionMetadata): Span | null {
  const startMs = Date.parse(metadata.firstTimestamp ?? '')
  const endMs = Date.parse(metadata.lastTimestamp ?? '')
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null
  return { startMs, endMs, durationMs: endMs - startMs }
}

/** Where an instant falls in the span, 0–1. Out-of-range instants clamp. */
export function positionInSpan(span: Span, iso: string): number | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return Math.min(1, Math.max(0, (ms - span.startMs) / span.durationMs))
}

/* ---------------------------------------------------------------------------
 * Cache timeline.
 * ------------------------------------------------------------------------- */

/**
 * The timeline is bucketed into a fixed number of columns rather than drawn
 * one mark per request. A captured session runs to a few hundred requests and
 * a long one to thousands; a fixed column count keeps the DOM bounded and the
 * bar widths readable whatever the session's size.
 */
export const TIMELINE_COLUMNS = 96

export interface TimelineColumn {
  warmReads: number
  expiries: number
}

export function timelineColumns(
  events: readonly InsightEvent[],
  span: Span,
  columnCount: number = TIMELINE_COLUMNS,
): TimelineColumn[] {
  const columns: TimelineColumn[] = Array.from({ length: columnCount }, () => ({
    warmReads: 0,
    expiries: 0,
  }))
  for (const event of events) {
    if (event.kind !== 'warm-read' && event.kind !== 'expiry') continue
    const position = positionInSpan(span, event.timestamp)
    if (position === null) continue
    // The final instant belongs to the last column, not to one past the end.
    const index = Math.min(columnCount - 1, Math.floor(position * columnCount))
    if (event.kind === 'warm-read') columns[index].warmReads++
    else columns[index].expiries++
  }
  return columns
}

/* ---------------------------------------------------------------------------
 * Hard resets, and the model/effort runs they divide the session into.
 * ------------------------------------------------------------------------- */

export interface ResetPoint {
  timestamp: string
  cause: HardResetCause
  from: string
  to: string
  /** 0–1 along the span, for the marker on the timeline. */
  position: number
}

export function resetPoints(events: readonly InsightEvent[], span: Span): ResetPoint[] {
  const points: ResetPoint[] = []
  for (const event of events) {
    if (event.kind !== 'hard-reset') continue
    const position = positionInSpan(span, event.timestamp)
    if (position === null) continue
    points.push({
      timestamp: event.timestamp,
      cause: event.cause,
      from: event.from,
      to: event.to,
      position,
    })
  }
  return points
}

export interface ConfigSegment {
  model: string
  effort?: string
  /** Share of the span this run occupied, 0–1. */
  width: number
}

/**
 * The session split into runs of one model-and-effort setting, from the
 * resets that ended each run. A version change is a real hard reset but does
 * not change either label, so it is not a segment boundary here — the reset
 * list below still names it.
 *
 * Returns a single segment when nothing changed, and nothing at all when the
 * log named no model, so the strip is never drawn empty.
 */
export function configSegments(
  metadata: SessionMetadata,
  resets: readonly ResetPoint[],
): ConfigSegment[] {
  const firstModel = metadata.models[0]
  if (!firstModel) return []

  let model = firstModel
  let effort = metadata.efforts[0]
  let cursor = 0
  const segments: ConfigSegment[] = []

  for (const reset of resets) {
    if (reset.cause === 'version-change') continue
    if (reset.position > cursor) {
      segments.push(segment(model, effort, reset.position - cursor))
      cursor = reset.position
    }
    if (reset.cause === 'model-change') model = reset.to
    else effort = reset.to
  }
  if (cursor < 1) segments.push(segment(model, effort, 1 - cursor))
  return segments
}

function segment(model: string, effort: string | undefined, width: number): ConfigSegment {
  const result: ConfigSegment = { model, width }
  if (effort !== undefined) result.effort = effort
  return result
}

/* ---------------------------------------------------------------------------
 * Small shared helpers.
 * ------------------------------------------------------------------------- */

/**
 * Whether two instants fall on the same day in the reader's own time zone.
 *
 * A session almost always starts and ends on one day, and repeating the date
 * on both ends of its span is what pushed that field past the width it has
 * (it truncated to "Aug 30, 2026, 6:20 PM - Aug 30, 2..."). Same day, and the
 * date is said once.
 */
export function isSameCalendarDay(a: string, b: string): boolean {
  const first = new Date(a)
  const second = new Date(b)
  if (Number.isNaN(first.getTime()) || Number.isNaN(second.getTime())) return false
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  )
}

/**
 * A model id trimmed for display: "claude-opus-5" reads as "opus-5" in a
 * column that also has to fit "claude-3-5-haiku-20241022". The id is
 * log-derived, so this only ever removes a known prefix — it never rewrites
 * or prettifies what the log said.
 */
export function shortModelName(modelId: string): string {
  return modelId.startsWith('claude-') ? modelId.slice('claude-'.length) : modelId
}

/** The gap histogram, in the order the bands are explained on screen. */
export interface GapBand {
  id: 'under5m' | 'band' | 'over1h'
  count: number
  /** The band the 5m-vs-1h choice actually turns on. */
  decisive: boolean
}

export function gapBands(bucket: BucketAnalysis): GapBand[] {
  const { shape } = bucket
  return [
    { id: 'under5m', count: shape.gapsUnder5m, decisive: false },
    { id: 'band', count: shape.gapsIn5mTo1hBand, decisive: true },
    { id: 'over1h', count: shape.gapsOver1h, decisive: false },
  ]
}

export function totalGaps(bucket: BucketAnalysis): number {
  const { shape } = bucket
  return shape.gapsUnder5m + shape.gapsIn5mTo1hBand + shape.gapsOver1h
}

export const GAP_BAND_BOUNDS = { lowerMs: CACHE_TTL_5M_MS, upperMs: CACHE_TTL_1H_MS } as const

/** The `settings.json` key a bucket's recommendation applies to. */
export function settingKey(bucket: BucketAnalysis): string {
  return bucket.bucket === 'subagent' ? 'subagentPromptCacheTtl' : 'promptCacheTtl'
}

export function bucketFor(result: AnalysisResult, id: BucketAnalysis['bucket']) {
  return result.buckets.find((bucket) => bucket.bucket === id) ?? null
}
