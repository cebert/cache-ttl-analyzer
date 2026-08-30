/**
 * WP-02 — THE FROZEN ENGINE CONTRACT
 * ==================================
 *
 * Everything else in this codebase (parser WP-03, cost engine WP-04,
 * simulator WP-05, fixtures WP-06, UI WP-07/08) codes against the types in
 * this file, `pricing.ts`, and `protocol.ts`. Changes after the freeze
 * require touching docs/PLAN.md (WP-02). The ONE section expected to be
 * amended is the insight-event taxonomy (marked AMENDABLE below) — WP-05 and
 * WP-08 consume it and will discover needs.
 *
 * ---------------------------------------------------------------------------
 * PRE-FREEZE LOG INSPECTION FINDINGS (required by WP-02; recorded 2026-08-30)
 * ---------------------------------------------------------------------------
 * Corpus inspected: transcripts/004-build-plan/session.jsonl (Claude Code
 * v2.1.251; 715 rows; 201 assistant rows deduping to 79 requests, one message
 * appearing as up to 8 rows) plus that session's real subagent transcript
 * (17 rows / 8 requests) found on disk next to it — see F2.
 *
 * F1. `ai-title` payload shape: `{ type: "ai-title", aiTitle: string,
 *     sessionId: string }`. No timestamp, uuid, or other fields. The record
 *     is REWRITTEN repeatedly (27 occurrences in one session, all
 *     identical here, but titles can be regenerated) — the parser must take
 *     the LAST occurrence.
 *
 * F2. Subagent sidechains are SEPARATE FILES on v2.1.251, not interleaved
 *     rows. The main session file contained zero `isSidechain: true` rows
 *     (across all 9 session files on the machine); the session's subagent
 *     conversation lives at
 *     `<project>/<session-id>/subagents/agent-<agentId>.jsonl`, with a
 *     sibling `agent-<agentId>.meta.json`
 *     (`{ agentType, description, toolUseId, spawnDepth }`). Every row in
 *     the subagent file has `isSidechain: true`, a constant `agentId`, and
 *     `sessionId` equal to the parent session; its `parentUuid` chains are
 *     fully self-contained (no references into the parent file). The
 *     subagent's first request wrote `ephemeral_5m_input_tokens` while the
 *     main conversation wrote 1h — live confirmation that the two TTL
 *     buckets are real and independently configured.
 *     CONSEQUENCES (also recorded in docs/PLAN.md):
 *       - Cache-thread key = `agentId` when present; rows without one belong
 *         to the main thread unless `isSidechain` is true (legacy interleaved
 *         logs from older versions), in which case threads are recovered from
 *         `parentUuid` chain roots.
 *       - A modern main-session upload contains NO subagent traffic; the
 *         subagent bucket appears when the uploaded file is itself a subagent
 *         transcript, or a legacy log with interleaved sidechain rows.
 *
 * F3. Request-start pairing: the immediate `parentUuid` parent of a
 *     request's first assistant row is usually an `attachment` row (77 of 79
 *     requests), not the user row. Walking the `parentUuid` chain reaches a
 *     `user` row for 100% of requests; its timestamp precedes the assistant
 *     row's by 1.8s min / 3.9s median / 26s p90 / 76s max (never negative).
 *     Rule: request start = timestamp of the nearest `user`-row ancestor via
 *     the `parentUuid` walk; fall back to the assistant row's own timestamp
 *     when no ancestor resolves. The parser therefore indexes
 *     `uuid`/`parentUuid`/`timestamp` for `user` AND `attachment` rows
 *     (metadata only — never content).
 *
 * F4. Record types not in the feasibility doc's list exist already
 *     (`frame-link`, `pr-link`, `artifact-comment-monitor`,
 *     `artifact-autoreact-ledger`) — the skip-and-count rule is load-bearing
 *     on day one, not just future-proofing.
 *
 * F5. Usage subfields are OPTIONAL: the subagent transcript's usage lacked
 *     `output_tokens_details`, `server_tool_use`, `iterations`, and `speed`.
 *     `service_tier`/`speed` default to "standard" when absent. Unknown
 *     additions (e.g. `inference_geo`) are ignored.
 *
 * F6. `parentUuid` is NOT a strict linear chain: only 56 of 122
 *     continuation rows (same `message.id` as the previous row) pointed at
 *     the preceding block's uuid. Dedup by `message.id` only; never assume
 *     row-to-row linearity.
 *
 * F7. `message.id` <-> `requestId` remained 1:1 (79:79), re-confirming
 *     feasibility §6.1's dedup key.
 * ---------------------------------------------------------------------------
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
 * UNKNOWN-MODEL DEGRADATION POLICY (frozen):
 * Requests whose `model` has no entry in the pricing config are never
 * guessed. They are excluded from all dollar figures and disclosed in
 * `UnknownModelReport`. Their share is measured in TOTAL TOKENS
 * (input + cache read + cache write + output) across DEDUPED requests,
 * per bucket. When the share in a bucket exceeds this ratio, that bucket's
 * recommendation is suppressed (`recommendation: "no-verdict"`,
 * `verdictSuppressed: true`) — costs are still shown for the priced share.
 */
export const UNKNOWN_MODEL_SUPPRESSION_RATIO = 0.1

/**
 * Versions of Claude Code this build's parser has been validated against
 * (inclusive range, semver-ish x.y.z compare). Outside the range: warn,
 * never fail (feasibility §4). CI's format-drift canary pins fixtures to
 * this range (docs/PLAN.md §5).
 */
export const VALIDATED_VERSION_RANGE = { min: '2.1.193', max: '2.1.251' } as const

/** Resource limits (docs/PLAN.md §2, "Input validation"). */
export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024
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
  /** Unrecognized record `type` -> count (skip-and-count, F4). */
  skippedRecordTypes: Record<string, number>
  assistantRows: number
  dedupedRequests: number
  syntheticRowsExcluded: number
  /** Rows dropped for non-finite / negative token counts. */
  invalidUsageRowsSkipped: number
}

export type ParseWarning =
  | { kind: 'malformed-lines'; count: number }
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
 * The two TTL settings' buckets (feasibility §3): "main" =
 * `promptCacheTtl`, "subagent" = `subagentPromptCacheTtl`. The subagent
 * bucket is present only when the parsed file contains sidechain traffic
 * (see F2 for when that can happen); the UI must not imply subagent traffic
 * was evaluated when the bucket is absent.
 */
export type BucketId = 'main' | 'subagent'

/**
 * MIXED-TTL WRITE HANDLING IN COUNTERFACTUALS (frozen):
 * Server tools insert their own 5m cache writes regardless of the user's
 * setting. Counterfactuals reprice ONLY the user-controllable share:
 * user-controlled writes take the scenario TTL (both write price and expiry
 * window), while server-tool 5m writes stay 5m in BOTH scenarios and expire
 * as their own class (`expiryClass: "server-tool-5m"`). Per request, the
 * user-controllable share is the bucket's dominant-TTL write tokens; the
 * residual split tokens are the server-tool share. Two edge cases are pinned
 * so conforming simulators cannot diverge: when a bucket has no write tokens
 * at all (`observedTtl: null`) there is no user-controllable share and
 * nothing to reprice; when the 5m/1h write tokens tie exactly, the dominant
 * TTL is `"1h"` (server tools only ever add 5m writes, so nonzero 1h tokens
 * can only be user-controlled). The reconciliation check
 * (PLAN §5) replays each request with its OBSERVED per-request split — not a
 * single session-wide TTL — and must reproduce actual cost within the stated
 * approximation.
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
   * Whether the observed cross-bucket pattern proves explicit configuration
   * (the two unambiguous patterns from feasibility §3). Never claims
   * "default".
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
   * The all-or-nothing expiry approximation is conservative toward 5m
   * (feasibility §7); the UI must disclose it. Present so the UI never
   * hard-codes the disclosure's factual basis.
   */
  approximation: { allOrNothingExpiry: true; conservativeToward: CacheTtl }
}

/* ---------------------------------------------------------------------------
 * Insight events — ⚠️ AMENDABLE SECTION ⚠️
 * The ONE part of this contract expected to change after the freeze: WP-05
 * (generation) and WP-08 / WP-D (display) will discover event kinds and
 * fields they need. Amendments still require a docs/PLAN.md touch, but are
 * anticipated here.
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
