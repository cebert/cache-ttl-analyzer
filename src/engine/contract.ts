/**
 * WP-02 — THE FROZEN ENGINE CONTRACT
 *
 * Parser (WP-03), cost engine (WP-04), simulator (WP-05), fixtures (WP-06),
 * and UI (WP-07/08) all code against this file, `pricing.ts`, and
 * `protocol.ts`. Changes after the freeze require touching docs/PLAN.md.
 * One exception: the insight-event taxonomy (marked AMENDABLE below) is
 * expected to grow.
 *
 * PRE-FREEZE LOG INSPECTION FINDINGS (2026-08-30)
 * Corpus: transcripts/004-build-plan/session.jsonl (v2.1.251; 715 rows, 201
 * assistant rows deduping to 79 requests, one message spanning 8 rows) plus
 * that session's on-disk subagent transcript (17 rows / 8 requests).
 *
 * F1. `ai-title` = `{ type, aiTitle, sessionId }`; no timestamp or uuid.
 *     Rewritten repeatedly (27 occurrences here) — take the LAST one.
 * F2. Subagent sidechains are separate files on v2.1.251, not interleaved
 *     rows: `<project>/<session-id>/subagents/agent-<agentId>.jsonl` plus
 *     `agent-<agentId>.meta.json` ({ agentType, description, toolUseId,
 *     spawnDepth }). Every row carries `isSidechain: true`, one `agentId`,
 *     and the parent `sessionId`; `parentUuid` chains never leave the file.
 *     The subagent's first request wrote ephemeral_5m while the main
 *     conversation wrote 1h — both TTL buckets observed live.
 *     Consequences: thread key = `agentId` when present; rows without one
 *     are main-thread unless `isSidechain` is true (legacy interleaved
 *     logs; threads recovered from `parentUuid` chain roots). A modern
 *     main-session upload contains no subagent traffic.
 * F3. Request start: walking `parentUuid` reaches a `user` row for 100% of
 *     requests (the immediate parent is usually an `attachment`, 77/79);
 *     that timestamp precedes the assistant row's by 1.8s min / 3.9s median
 *     / 26s p90 / 76s max, never negative. Rule: nearest `user`-row
 *     ancestor, else the assistant row's own timestamp. Requires indexing
 *     uuid/parentUuid/timestamp of `user` and `attachment` rows — metadata
 *     only, never content.
 * F4. Record types beyond the feasibility doc's list already exist
 *     (frame-link, pr-link, artifact-comment-monitor,
 *     artifact-autoreact-ledger) — skip-and-count is load-bearing today.
 * F5. Usage subfields are optional: subagent rows lacked
 *     output_tokens_details, server_tool_use, iterations, and speed.
 *     `service_tier`/`speed` default to "standard"; unknown additions
 *     (e.g. inference_geo) are ignored.
 * F6. `parentUuid` is not linear across a message's content-block rows
 *     (56/122 continuation rows chained). Dedup by `message.id` only.
 * F7. `message.id` <-> `requestId` stayed 1:1 (79:79) — dedup key holds.
 *
 * POST-FREEZE AMENDMENTS (each recorded in docs/PLAN.md, as the freeze
 * requires)
 * A1. `MAX_FILE_SIZE_BYTES` 500 MB -> 100 MB (WP-07, D19).
 * A2. `SessionShape.gapsUnder5m` / `gapsOver1h` and
 *     `BucketAnalysis.tokenTotals` added for the results view (WP-08): the
 *     screen shows a three-band gap histogram and token-share metrics, and
 *     `AnalysisResult` carries neither request records to recount from nor
 *     costs that could yield token counts.
 */

/** A cache TTL the user can configure per bucket. */
export type CacheTtl = '5m' | '1h'

export const CACHE_TTL_5M_MS = 5 * 60_000
export const CACHE_TTL_1H_MS = 60 * 60_000

/* ---------------------------------------------------------------------------
 * Named policy constants (docs/PLAN.md §2 — both metric and constant are part
 * of the frozen contract so verdicts are deterministic).
 * ------------------------------------------------------------------------- */

/**
 * Validation: a file is "not a session log" when malformed lines exceed this
 * share of non-empty lines (or when no assistant rows carry usage at all).
 */
export const MALFORMED_LINE_REJECT_RATIO = 0.1

/**
 * UNKNOWN-MODEL DEGRADATION POLICY (frozen): model ids missing from the
 * pricing config are never guessed — their requests are excluded from all
 * dollar figures and disclosed in `UnknownModelReport`. Share = total
 * tokens (input + cache read + cache write + output) across deduped
 * requests, per bucket; above this ratio the bucket's recommendation
 * becomes "no-verdict" while costs for the priced share still show.
 */
export const UNKNOWN_MODEL_SUPPRESSION_RATIO = 0.1

/**
 * Validated Claude Code versions (inclusive, x.y.z compare). Outside the
 * range: warn, never fail (feasibility §4). CI's format-drift canary pins
 * fixtures to this range (docs/PLAN.md §5).
 */
export const VALIDATED_VERSION_RANGE = { min: '2.1.193', max: '2.1.251' } as const

/**
 * Resource limits (docs/PLAN.md §2, "Input validation").
 *
 * AMENDED IN WP-07 (2026-08-30), 500 MB -> 100 MB, with the user's sign-off
 * and no other consumer at the time: WP-07 is the first code to enforce the
 * cap, and 500 MB was set before anyone had measured a session log. Measured:
 * 49 logs across a real ~/.claude/projects tree (the 30-day retention window)
 * ran to a 0.15 MB median, 1.8 MB p90 and a 3.36 MB maximum; this repo's own
 * committed transcripts, which are long dense engineering sessions, top out at
 * 3.25 MB. 100 MB is ~30x the largest log anyone has produced here and matches
 * the copy WP-D wrote, so it is the cap the UI states and enforces.
 */
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024
export const MAX_LINE_LENGTH_BYTES = 10 * 1024 * 1024
/** Log-derived display strings (title, cwd, gitBranch, model) are clamped. */
export const MAX_METADATA_STRING_LENGTH = 500

/* ---------------------------------------------------------------------------
 * ParsedSession — the parser's (WP-03) output.
 * ------------------------------------------------------------------------- */

/**
 * One deduped, priced-or-priceable API request. The parser copies fields out
 * of the raw JSON into this typed record and discards the parsed object —
 * raw JSON never enters app state (docs/PLAN.md §2).
 */
export interface RequestRecord {
  /** `message.id` — the dedup key (F7). */
  messageId: string
  /** Raw model id, e.g. "claude-fable-5". `<synthetic>` rows are excluded upstream. */
  model: string
  /** Assistant row's own timestamp = response completion (ISO 8601). */
  timestamp: string
  /**
   * Best-effort request START (drives TTL gap math): nearest `user`-row
   * ancestor via the `parentUuid` walk, else the assistant timestamp (F3).
   */
  requestStartTimestamp: string
  requestStartSource: 'user-ancestor' | 'assistant-row-fallback'
  /**
   * Cache-thread key (F2): "main" for the main conversation, else the
   * subagent `agentId` (modern separate-file logs) or a synthesized
   * `sidechain-<n>` id recovered from `parentUuid` chain roots (legacy
   * interleaved logs).
   */
  threadId: string
  isSidechain: boolean
  /** Row-level `effort`; absent on some rows. Changes are hard cache resets. */
  effort?: string
  /** Claude Code version from the row; changes are hard cache resets. */
  version?: string
  usage: RequestUsage
}

/**
 * Usage copied from `message.usage`. All token counts are validated finite
 * and non-negative by the parser (rows failing that are skipped + counted).
 * Optionality follows F5.
 */
export interface RequestUsage {
  inputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  /** `cache_creation.ephemeral_5m_input_tokens` (0 when the split is absent). */
  cacheCreation5mTokens: number
  /** `cache_creation.ephemeral_1h_input_tokens` (0 when the split is absent). */
  cacheCreation1hTokens: number
  outputTokens: number
  /** `service_tier`, defaulted to "standard" when absent (F5). */
  serviceTier: string
  /** `speed`, defaulted to "standard" when absent (F5). */
  speed: string
}

/** Content-free metadata for the session identification card (PLAN §3). */
export interface SessionMetadata {
  sessionId?: string
  /** LAST `ai-title` record's `aiTitle` (F1); absent in many sessions. */
  title?: string
  cwd?: string
  gitBranch?: string
  /** Distinct values observed across assistant rows, in first-seen order. */
  models: string[]
  versions: string[]
  efforts: string[]
  firstTimestamp?: string
  lastTimestamp?: string
  fileName: string
  fileSizeBytes: number
}

export type ValidationVerdict = 'valid' | 'valid-with-warnings' | 'not-a-session-log'

export interface ParseStats {
  totalLines: number
  nonEmptyLines: number
  malformedLines: number
  /**
   * Skipped record `type` -> count (skip-and-count, F4). Counts every skipped
   * type, classified or not; the `skipped-record-types` warning carries only
   * the unclassified ones (see `NON_BILLING_RECORD_TYPES` in `parser.ts`).
   * Types past `MAX_DISTINCT_SKIPPED_TYPES`, and any whose spelling
   * sanitization altered, aggregate under `OTHER_SKIPPED_TYPES_KEY`, which is
   * never classified and so always warns.
   */
  skippedRecordTypes: Record<string, number>
  assistantRows: number
  dedupedRequests: number
  syntheticRowsExcluded: number
  /** Rows dropped for non-finite / negative token counts. */
  invalidUsageRowsSkipped: number
}

export type ParseWarning =
  | { kind: 'malformed-lines'; count: number }
  /**
   * Unclassified types only — a subset of `ParseStats.skippedRecordTypes`,
   * including the `OTHER_SKIPPED_TYPES_KEY` bucket when it is non-empty.
   */
  | { kind: 'skipped-record-types'; types: Record<string, number> }
  | { kind: 'version-out-of-range'; versions: string[] }
  | { kind: 'unknown-models'; models: string[] }
  | { kind: 'invalid-usage-rows'; count: number }
  | { kind: 'line-length-cap-exceeded'; count: number }

export interface ParsedSession {
  metadata: SessionMetadata
  /** Deduped on `messageId`, synthetic rows excluded, file order preserved. */
  requests: RequestRecord[]
  stats: ParseStats
  verdict: ValidationVerdict
  warnings: ParseWarning[]
}

/* ---------------------------------------------------------------------------
 * AnalysisResult — the simulator's (WP-05) output, consumed by the UI.
 * ------------------------------------------------------------------------- */

export type Recommendation = CacheTtl | 'no-verdict'

/**
 * "main" = `promptCacheTtl`, "subagent" = `subagentPromptCacheTtl`
 * (feasibility §3). The subagent bucket exists only when the file contains
 * sidechain traffic (F2); the UI must not imply it was evaluated otherwise.
 */
export type BucketId = 'main' | 'subagent'

/**
 * MIXED-TTL WRITE HANDLING IN COUNTERFACTUALS (frozen; wording amended
 * 2026-08-30, WP-10 — see below): server tools insert their own 5m writes
 * regardless of the user's setting, so counterfactuals reprice only the
 * user-controllable share. User-controlled writes take the scenario TTL
 * (write price and expiry window); server-tool 5m writes stay 5m in both
 * scenarios as their own expiry class ("server-tool-5m").
 *
 * Per request, the user-controllable share is the bucket's dominant-TTL
 * write tokens. The residual split tokens are the server-tool share ONLY in
 * a 1h-dominant bucket, where server tools are the only thing that writes at
 * 5m. In a 5m-dominant bucket a 1h residual cannot be server-tool traffic —
 * server tools never write at 1h — so it is a mid-session config flip, and
 * every write in that bucket is user-controlled and repriced per scenario.
 *
 * The warm entry's observed TTL is the bucket's dominant TTL, not the
 * previous request's own split: a request whose only write was a server-tool
 * 5m write must not shorten the user's live 1h entry.
 *
 * Pinned edge cases: no writes at all (`observedTtl: null`) → nothing to
 * reprice; an exact 5m/1h tie → dominant TTL is "1h" (server tools only add
 * 5m writes, so nonzero 1h tokens are user-controlled). The reconciliation
 * check (PLAN §5) replays each request with its observed per-request split
 * and must reproduce actual cost within the stated approximation — exactly,
 * except in the 5m-dominant-with-1h-writes case above, where the "5m"
 * scenario reprices the flipped writes by design.
 *
 * AMENDMENT NOTE (WP-10): this paragraph previously called the residual the
 * server-tool share unconditionally, and two lines later said nonzero 1h
 * tokens are user-controlled. Those contradict for a 5m-dominant bucket
 * carrying a 1h residual. The simulator has always followed the rationale,
 * not the unconditional sentence; this is a wording fix with no behavior
 * change, and no golden moved.
 */
export interface TtlTokenSplit {
  fiveMinuteWriteTokens: number
  oneHourWriteTokens: number
}

export interface CostBreakdown {
  baseInputUsd: number
  cacheReadUsd: number
  cacheWrite5mUsd: number
  cacheWrite1hUsd: number
  outputUsd: number
  totalUsd: number
}

export interface ScenarioCost {
  ttl: CacheTtl
  cost: CostBreakdown
  /** Simulated cache events under this scenario (AMENDABLE taxonomy below). */
  events: InsightEvent[]
  cacheExpiries: number
  hardResets: number
  warmReadRequests: number
  wastedWriteTokens: number
}

export interface SessionShape {
  requestCount: number
  spanMs: number
  largestGapMs: number
  /** Gaps where the 5m-vs-1h choice can matter at all (feasibility §7). */
  gapsIn5mTo1hBand: number
  /**
   * The rest of the same-thread gap histogram, so the three bands the
   * results view draws sum to the gaps the session actually had.
   * (WP-08 amendment, 2026-08-30: `gapsIn5mTo1hBand` alone cannot say what
   * share of gaps it is, and `AnalysisResult` carries no request records
   * for the UI to recount from.)
   */
  gapsUnder5m: number
  gapsOver1h: number
}

/**
 * Observed token totals for a bucket, summed over its deduped requests and
 * across every model, priced or not. The headline metrics (cache hit rate,
 * reads, writes, input, output) are shares of these.
 *
 * WP-08 amendment, 2026-08-30: costs alone cannot produce them — a dollar
 * figure mixes rates across models, and unpriced requests contribute none.
 */
export interface TokenTotals {
  inputTokens: number
  cacheReadTokens: number
  /** Cache writes at either TTL; the split is `observedWriteSplit`. */
  cacheWriteTokens: number
  outputTokens: number
}

export interface BucketAnalysis {
  bucket: BucketId
  /** Distinct cache threads in the bucket (subagents each have their own). */
  threadCount: number
  requestCount: number
  /** Exact cost of what actually happened, at published API rates. */
  actualCost: CostBreakdown
  /** Observed write-TTL mix, the basis for TTL inference (feasibility §2). */
  observedWriteSplit: TtlTokenSplit
  /**
   * Token-weighted dominant observed TTL; null when no writes occurred; on
   * an exact tie, "1h" (see the mixed-TTL policy above).
   */
  observedTtl: CacheTtl | null
  /**
   * Whether the cross-bucket pattern proves explicit configuration
   * (feasibility §3); never claims "default".
   */
  configExplicitness: 'provably-explicit' | 'ambiguous' | 'unknown'
  scenarios: { fiveMinute: ScenarioCost; oneHour: ScenarioCost }
  recommendation: Recommendation
  /** Absolute savings of the recommended scenario over the other, USD. */
  savingsUsd: number
  verdictSuppressed: boolean
  suppressionReason?: 'unknown-model-share-exceeded'
  /** Unpriced share of total tokens (see UNKNOWN_MODEL_SUPPRESSION_RATIO). */
  unpricedTokenShare: number
  shape: SessionShape
  /** What the log actually recorded for this bucket (WP-08 amendment). */
  tokenTotals: TokenTotals
}

export interface UnknownModelReport {
  /** Distinct unpriced model ids observed. */
  models: string[]
  excludedRequests: number
  /** Total tokens (input + cache read + cache write + output) excluded. */
  excludedTotalTokens: number
}

export interface AnalysisResult {
  metadata: SessionMetadata
  parseStats: ParseStats
  parseWarnings: ParseWarning[]
  /** "main" always present when the analysis ran; "subagent" conditional. */
  buckets: BucketAnalysis[]
  unknownModels: UnknownModelReport
  /** Copied from the pricing config; shown beside every dollar figure. */
  pricesAsOf: string
  /**
   * All-or-nothing expiry is conservative toward 5m (feasibility §7); the
   * UI must disclose it and reads the basis from here.
   */
  approximation: { allOrNothingExpiry: true; conservativeToward: CacheTtl }
}

/* ---------------------------------------------------------------------------
 * Insight events — ⚠️ AMENDABLE SECTION ⚠️
 * The one part expected to change after the freeze (WP-05 and WP-08/WP-D
 * will discover needs). Amendments still require a docs/PLAN.md touch.
 * ------------------------------------------------------------------------- */

export type HardResetCause = 'model-change' | 'effort-change' | 'version-change'
export type ExpiryClass = 'user-controlled' | 'server-tool-5m'

export interface InsightEventBase {
  /** Request start time of the request the event is attributed to. */
  timestamp: string
  threadId: string
  messageId: string
}

export interface CacheWriteEvent extends InsightEventBase {
  kind: 'cache-write'
  ttl: CacheTtl
  tokens: number
  expiryClass: ExpiryClass
}

export interface WarmReadEvent extends InsightEventBase {
  kind: 'warm-read'
  tokens: number
}

export interface ExpiryEvent extends InsightEventBase {
  kind: 'expiry'
  /** The same-thread gap that caused the expiry. */
  gapMs: number
  expiryClass: ExpiryClass
  /** Tokens re-written because the entry lapsed. */
  rewrittenTokens: number
}

export interface HardResetEvent extends InsightEventBase {
  kind: 'hard-reset'
  cause: HardResetCause
  /** e.g. "claude-opus-5 -> claude-fable-5", "high -> medium". */
  from: string
  to: string
}

export interface SubagentThreadStartEvent extends InsightEventBase {
  kind: 'subagent-thread-start'
}

export type InsightEvent =
  CacheWriteEvent | WarmReadEvent | ExpiryEvent | HardResetEvent | SubagentThreadStartEvent

/* ---------------------------------------------------------------------------
 * Engine interface — what the worker (and tests) drive.
 * ------------------------------------------------------------------------- */

import type { PricingConfig } from './pricing'

export interface EngineInput {
  /** Streamed so large logs never become one giant string (PLAN §2). */
  stream: ReadableStream<Uint8Array>
  fileName: string
  fileSizeBytes: number
  pricing: PricingConfig
}

export interface EngineProgress {
  phase: 'parsing' | 'analyzing'
  bytesProcessed: number
  totalBytes: number
  requestsSeen: number
}

/** Terminal outcome: a rejection is a first-class result, not an exception. */
export type EngineOutcome =
  | { kind: 'analysis'; result: AnalysisResult }
  | { kind: 'rejected'; verdict: 'not-a-session-log'; stats: ParseStats; reason: string }

export interface AnalysisEngine {
  analyze(
    input: EngineInput,
    hooks: { onProgress: (p: EngineProgress) => void; signal: AbortSignal },
  ): Promise<EngineOutcome>
}
