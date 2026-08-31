/**
 * WP-05 — the counterfactual simulator: replays a parsed session under
 * each cache TTL and produces the per-bucket `AnalysisResult` the UI
 * consumes (docs/PLAN.md §3, feasibility doc §6–§7).
 *
 * MODEL. Requests are partitioned into the two buckets the settings govern
 * ("main" = `promptCacheTtl`, "subagent" = `subagentPromptCacheTtl`) and,
 * inside a bucket, into cache threads (each subagent has its own cache).
 * Within a thread, requests are replayed in file order and the cache entry
 * is alive at request r iff the same-thread gap since the previous request
 * START is within the TTL (reads refresh the timer at no cost, so the clock
 * restarts at every request).
 *
 * The scenario at the OBSERVED TTL reproduces the log exactly (the
 * reconciliation property, PLAN §5). A counterfactual only edits the
 * requests where the two TTL windows disagree (§7 — all-or-nothing for a
 * whole entry, but a partially lapsed entry is split at what it read):
 *  - shortening (observed 1h, scenario 5m): where 5m < gap and the log shows
 *    a cache read, that read lapses and becomes a fresh write at the 5m
 *    rate ("expiry");
 *  - lengthening (observed 5m, scenario 1h): where 5m < gap <= 1h and the
 *    log shows a write, the share of the entry that lapsed — what was
 *    cached after the previous request minus what the request still read —
 *    would have been read instead. A log that read nothing lapsed wholly;
 *    a log that read part of the entry (a stable prefix outlived the tail,
 *    as `gap-heavy-5m` shows) lapsed partially and restores only that part.
 * A change of model, effort, or version between consecutive same-thread
 * requests is a hard reset in every scenario (§6.6): the cache is emptied,
 * no expiry is attributed to that gap, and the observed usage stands.
 *
 * MIXED TTLs (contract, frozen): only the user-controllable write share is
 * repriced. Server tools only ever add 5m writes, so in a 1h-dominant
 * bucket the 5m residual is the server-tool share — kept at 5m in both
 * scenarios as its own expiry class and never simulated for expiry (its
 * reads are not separable from `cache_read_input_tokens`). In a
 * 5m-dominant bucket every write is user-controlled, including a 1h
 * residual (a mid-session config flip), per the contract's rationale that
 * nonzero 1h tokens are user-controlled. The warm entry's observed TTL is
 * the bucket's dominant TTL: a request whose only write was a server-tool
 * 5m write did not shorten the user's live entry.
 *
 * UNKNOWN MODELS (contract, frozen): excluded from every dollar figure but
 * still replayed so cache state and events stay right; a bucket whose
 * unpriced token share exceeds `UNKNOWN_MODEL_SUPPRESSION_RATIO` gets
 * "no-verdict".
 */

import {
  CACHE_TTL_1H_MS,
  CACHE_TTL_5M_MS,
  UNKNOWN_MODEL_SUPPRESSION_RATIO,
  type AnalysisResult,
  type BucketAnalysis,
  type BucketId,
  type CacheTtl,
  type CostBreakdown,
  type HardResetCause,
  type InsightEvent,
  type ParsedSession,
  type Recommendation,
  type RequestRecord,
  type ScenarioCost,
  type SessionShape,
  type TokenTotals,
  type TtlTokenSplit,
} from './contract'
import {
  buildUnknownModelReport,
  lookupModel,
  priceRequest,
  priceTokens,
  sumCosts,
  totalTokens,
  unattributedWriteTokens,
  ZERO_COST,
} from './cost'
import type { PricingConfig } from './pricing'

export const TTL_MS: Record<CacheTtl, number> = { '5m': CACHE_TTL_5M_MS, '1h': CACHE_TTL_1H_MS }

/** Both scenarios, in the order `BucketAnalysis.scenarios` names them. */
const SCENARIOS: readonly CacheTtl[] = ['5m', '1h']

/* ---------------------------------------------------------------------------
 * Partitioning.
 * ------------------------------------------------------------------------- */

export function bucketOf(request: RequestRecord): BucketId {
  return request.isSidechain ? 'subagent' : 'main'
}

/** Requests grouped by thread, file order preserved within each thread. */
export function groupByThread(requests: readonly RequestRecord[]): Map<string, RequestRecord[]> {
  const threads = new Map<string, RequestRecord[]>()
  for (const request of requests) {
    let list = threads.get(request.threadId)
    if (!list) {
      list = []
      threads.set(request.threadId, list)
    }
    list.push(request)
  }
  return threads
}

/* ---------------------------------------------------------------------------
 * Observed write split and TTL inference (feasibility §2).
 * ------------------------------------------------------------------------- */

/**
 * The per-request write split with unattributed writes folded into the 5m
 * side (the API's default TTL; consistent with `cost.ts`).
 */
export function requestWriteSplit(request: RequestRecord): TtlTokenSplit {
  return {
    fiveMinuteWriteTokens:
      request.usage.cacheCreation5mTokens + unattributedWriteTokens(request.usage),
    oneHourWriteTokens: request.usage.cacheCreation1hTokens,
  }
}

export function sumWriteSplits(requests: readonly RequestRecord[]): TtlTokenSplit {
  let fiveMinuteWriteTokens = 0
  let oneHourWriteTokens = 0
  for (const request of requests) {
    const split = requestWriteSplit(request)
    fiveMinuteWriteTokens += split.fiveMinuteWriteTokens
    oneHourWriteTokens += split.oneHourWriteTokens
  }
  return { fiveMinuteWriteTokens, oneHourWriteTokens }
}

/** Token-weighted dominant TTL; null with no writes; exact tie → "1h". */
export function dominantTtl(split: TtlTokenSplit): CacheTtl | null {
  if (split.fiveMinuteWriteTokens === 0 && split.oneHourWriteTokens === 0) return null
  return split.fiveMinuteWriteTokens > split.oneHourWriteTokens ? '5m' : '1h'
}

/* ---------------------------------------------------------------------------
 * Hard resets (§6.6).
 * ------------------------------------------------------------------------- */

export function hardResetCauses(
  previous: RequestRecord,
  current: RequestRecord,
): { cause: HardResetCause; from: string; to: string }[] {
  const causes: { cause: HardResetCause; from: string; to: string }[] = []
  if (previous.model !== current.model) {
    causes.push({ cause: 'model-change', from: previous.model, to: current.model })
  }
  if ((previous.effort ?? '') !== (current.effort ?? '')) {
    causes.push({ cause: 'effort-change', from: previous.effort ?? '', to: current.effort ?? '' })
  }
  if ((previous.version ?? '') !== (current.version ?? '')) {
    causes.push({
      cause: 'version-change',
      from: previous.version ?? '',
      to: current.version ?? '',
    })
  }
  return causes
}

/* ---------------------------------------------------------------------------
 * Scenario replay.
 * ------------------------------------------------------------------------- */

interface ThreadReplay {
  cost: CostBreakdown
  events: InsightEvent[]
  cacheExpiries: number
  hardResets: number
  warmReadRequests: number
  wastedWriteTokens: number
}

/** Same-thread gap between request starts, clamped at zero. */
export function gapMs(previous: RequestRecord, current: RequestRecord): number {
  return Math.max(
    0,
    Date.parse(current.requestStartTimestamp) - Date.parse(previous.requestStartTimestamp),
  )
}

function replayThread(
  thread: readonly RequestRecord[],
  scenario: CacheTtl,
  bucketTtl: CacheTtl | null,
  pricing: PricingConfig,
): ThreadReplay {
  const scenarioMs = TTL_MS[scenario]
  const events: InsightEvent[] = []
  const costs: CostBreakdown[] = []
  let cacheExpiries = 0
  let hardResets = 0
  let warmReadRequests = 0
  let wastedWriteTokens = 0

  /** Tokens cached after the previous request (its reads + all its writes). */
  let warmTokens = 0
  /** The previous request's user-controlled write, for waste accounting. */
  let previousUserWrite = 0
  let previous: RequestRecord | undefined

  for (const request of thread) {
    const base = {
      timestamp: request.requestStartTimestamp,
      threadId: request.threadId,
      messageId: request.messageId,
    }
    const usage = request.usage
    const split = requestWriteSplit(request)
    // The user-controllable share: with no bucket TTL (no writes anywhere)
    // there is nothing to reprice. Server tools only add 5m writes, so a
    // 1h-dominant bucket's 5m residual is the server-tool share; in a
    // 5m-dominant bucket every write is user-controlled.
    const userTtl = bucketTtl ?? scenario
    let userWrite =
      userTtl === '5m'
        ? split.fiveMinuteWriteTokens + split.oneHourWriteTokens
        : split.oneHourWriteTokens
    const serverWrite = userTtl === '5m' ? 0 : split.fiveMinuteWriteTokens
    let reads = usage.cacheReadInputTokens

    if (previous !== undefined) {
      const resets = hardResetCauses(previous, request)
      if (resets.length > 0) {
        for (const reset of resets) events.push({ kind: 'hard-reset', ...reset, ...base })
        hardResets++
        wastedWriteTokens += previousUserWrite
        warmTokens = 0
      } else {
        const gap = gapMs(previous, request)
        // The TTL the warm entry actually carried is the bucket's
        // user-controlled TTL — not the previous request's own split, which
        // a server-tool 5m write would otherwise masquerade as.
        const observedMs = TTL_MS[userTtl]
        const aliveObserved = gap <= observedMs
        const aliveScenario = gap <= scenarioMs
        // The share of the warm entry the log did NOT read back: zero on a
        // full hit, the whole entry on a total lapse, and something in
        // between on a partial lapse (a stable prefix survives while the
        // conversation tail expires — observed in `gap-heavy-5m`).
        const lapsedTokens = Math.max(0, warmTokens - reads)
        if (aliveObserved && !aliveScenario) {
          // Shortening: the entry the log read from would have lapsed.
          if (reads > 0) {
            events.push({
              kind: 'expiry',
              gapMs: gap,
              expiryClass: 'user-controlled',
              rewrittenTokens: reads,
              ...base,
            })
            cacheExpiries++
            // Waste is bounded by what lapsed; here the whole entry goes,
            // and the previous write is never larger than the entry.
            wastedWriteTokens += Math.min(previousUserWrite, warmTokens)
            userWrite += reads
            reads = 0
          }
        } else if (!aliveObserved && aliveScenario) {
          // Lengthening: the prefix the log re-wrote would still be warm.
          // A partial lapse restores only the share that actually expired.
          if (userWrite > 0 && lapsedTokens > 0) {
            const restored = Math.min(userWrite, lapsedTokens)
            reads += restored
            userWrite -= restored
          }
        } else if (!aliveObserved && !aliveScenario) {
          // Lapsed in the log and in the scenario alike: name the observed
          // expiry so the timeline explains the write.
          if (userWrite > 0 && lapsedTokens > 0) {
            const rewrittenTokens = Math.min(userWrite, lapsedTokens)
            events.push({
              kind: 'expiry',
              gapMs: gap,
              expiryClass: 'user-controlled',
              rewrittenTokens,
              ...base,
            })
            cacheExpiries++
            wastedWriteTokens += Math.min(previousUserWrite, lapsedTokens)
          }
        }
      }
    }

    if (reads > 0) {
      warmReadRequests++
      events.push({ kind: 'warm-read', tokens: reads, ...base })
    }
    if (userWrite > 0) {
      events.push({
        kind: 'cache-write',
        ttl: scenario,
        tokens: userWrite,
        expiryClass: 'user-controlled',
        ...base,
      })
    }
    if (serverWrite > 0) {
      events.push({
        kind: 'cache-write',
        ttl: '5m',
        tokens: serverWrite,
        expiryClass: 'server-tool-5m',
        ...base,
      })
    }

    const model = lookupModel(pricing, request.model)
    if (model) {
      costs.push(
        priceTokens(
          {
            baseInputTokens: usage.inputTokens,
            cacheReadTokens: reads,
            cacheWrite5mTokens: (scenario === '5m' ? userWrite : 0) + serverWrite,
            cacheWrite1hTokens: scenario === '1h' ? userWrite : 0,
            outputTokens: usage.outputTokens,
          },
          model,
          pricing.cacheMultipliers,
          { serviceTier: usage.serviceTier, speed: usage.speed },
        ),
      )
    }

    warmTokens = reads + userWrite + serverWrite
    previousUserWrite = userWrite
    previous = request
  }

  return {
    cost: sumCosts(costs),
    events,
    cacheExpiries,
    hardResets,
    warmReadRequests,
    wastedWriteTokens,
  }
}

function simulateScenario(
  threads: Map<string, RequestRecord[]>,
  scenario: CacheTtl,
  bucketTtl: CacheTtl | null,
  pricing: PricingConfig,
): ScenarioCost {
  const result: ScenarioCost = {
    ttl: scenario,
    cost: ZERO_COST,
    events: [],
    cacheExpiries: 0,
    hardResets: 0,
    warmReadRequests: 0,
    wastedWriteTokens: 0,
  }
  const costs: CostBreakdown[] = []
  for (const [threadId, thread] of threads) {
    const first = thread[0]
    if (first.isSidechain) {
      result.events.push({
        kind: 'subagent-thread-start',
        timestamp: first.requestStartTimestamp,
        threadId,
        messageId: first.messageId,
      })
    }
    const replay = replayThread(thread, scenario, bucketTtl, pricing)
    costs.push(replay.cost)
    // No spread: a dense session's main thread can exceed the argument
    // limit of a single call.
    for (const event of replay.events) result.events.push(event)
    result.cacheExpiries += replay.cacheExpiries
    result.hardResets += replay.hardResets
    result.warmReadRequests += replay.warmReadRequests
    result.wastedWriteTokens += replay.wastedWriteTokens
  }
  result.cost = sumCosts(costs)
  result.events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  return result
}

/* ---------------------------------------------------------------------------
 * Session shape (§3 insights).
 * ------------------------------------------------------------------------- */

export function sessionShape(
  requests: readonly RequestRecord[],
  threads: Map<string, RequestRecord[]>,
): SessionShape {
  let firstStart = Number.POSITIVE_INFINITY
  let lastEnd = Number.NEGATIVE_INFINITY
  for (const request of requests) {
    firstStart = Math.min(firstStart, Date.parse(request.requestStartTimestamp))
    lastEnd = Math.max(lastEnd, Date.parse(request.timestamp))
  }
  let largestGapMs = 0
  let gapsUnder5m = 0
  let gapsIn5mTo1hBand = 0
  let gapsOver1h = 0
  for (const thread of threads.values()) {
    for (let i = 1; i < thread.length; i++) {
      const gap = gapMs(thread[i - 1], thread[i])
      largestGapMs = Math.max(largestGapMs, gap)
      // The band boundaries match `replayThread`'s expiry test exactly, so
      // the histogram cannot disagree with the simulation it explains.
      if (gap <= CACHE_TTL_5M_MS) gapsUnder5m++
      else if (gap <= CACHE_TTL_1H_MS) gapsIn5mTo1hBand++
      else gapsOver1h++
    }
  }
  return {
    requestCount: requests.length,
    spanMs: requests.length === 0 ? 0 : Math.max(0, lastEnd - firstStart),
    largestGapMs,
    gapsIn5mTo1hBand,
    gapsUnder5m,
    gapsOver1h,
  }
}

/* ---------------------------------------------------------------------------
 * Bucket analysis.
 * ------------------------------------------------------------------------- */

export function analyzeBucket(
  bucket: BucketId,
  requests: readonly RequestRecord[],
  pricing: PricingConfig,
): Omit<BucketAnalysis, 'configExplicitness'> {
  const threads = groupByThread(requests)
  const observedWriteSplit = sumWriteSplits(requests)
  const observedTtl = dominantTtl(observedWriteSplit)

  const actualCosts: CostBreakdown[] = []
  let bucketTokens = 0
  let unpricedTokens = 0
  // Token totals count every request, priced or not (see `TokenTotals`).
  const actualUsage: TokenTotals = {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
  }
  let warmReadRequestCount = 0
  for (const request of requests) {
    const { usage } = request
    actualUsage.inputTokens += usage.inputTokens
    actualUsage.cacheReadTokens += usage.cacheReadInputTokens
    actualUsage.cacheWriteTokens += usage.cacheCreationInputTokens
    actualUsage.outputTokens += usage.outputTokens
    if (usage.cacheReadInputTokens > 0) warmReadRequestCount++

    const tokens = totalTokens(usage)
    bucketTokens += tokens
    const cost = priceRequest(request, pricing)
    if (cost) actualCosts.push(cost)
    else unpricedTokens += tokens
  }
  const actualCost = sumCosts(actualCosts)
  const rawShare = bucketTokens === 0 ? 0 : unpricedTokens / bucketTokens
  // Token counts are safe integers (parser), so this is defensive: a
  // non-finite share must suppress, never silently pass the comparison.
  const unpricedTokenShare = Number.isFinite(rawShare) ? rawShare : 1

  const fiveMinute = simulateScenario(threads, SCENARIOS[0], observedTtl, pricing)
  const oneHour = simulateScenario(threads, SCENARIOS[1], observedTtl, pricing)

  const verdictSuppressed = unpricedTokenShare > UNKNOWN_MODEL_SUPPRESSION_RATIO
  let recommendation: Recommendation
  if (verdictSuppressed || requests.length === 0) {
    recommendation = 'no-verdict'
  } else if (fiveMinute.cost.totalUsd < oneHour.cost.totalUsd) {
    recommendation = '5m'
  } else if (oneHour.cost.totalUsd < fiveMinute.cost.totalUsd) {
    recommendation = '1h'
  } else {
    // Exact tie: nothing to gain from switching — keep what was observed.
    recommendation = observedTtl ?? '5m'
  }

  const analysis: Omit<BucketAnalysis, 'configExplicitness'> = {
    bucket,
    threadCount: threads.size,
    requestCount: requests.length,
    actualCost,
    actualUsage,
    warmReadRequestCount,
    observedWriteSplit,
    observedTtl,
    scenarios: { fiveMinute, oneHour },
    recommendation,
    savingsUsd: Math.abs(fiveMinute.cost.totalUsd - oneHour.cost.totalUsd),
    verdictSuppressed,
    unpricedTokenShare,
    shape: sessionShape(requests, threads),
  }
  if (verdictSuppressed) analysis.suppressionReason = 'unknown-model-share-exceeded'
  return analysis
}

/**
 * Feasibility §3: only two cross-bucket patterns prove explicit
 * configuration; everything else is ambiguous, and with one bucket missing
 * (or writes absent) nothing can be said.
 */
export function configExplicitness(
  main: CacheTtl | null,
  subagent: CacheTtl | null | undefined,
): BucketAnalysis['configExplicitness'] {
  if (main === null || subagent === null || subagent === undefined) return 'unknown'
  if (main === '1h' && subagent === '1h') return 'provably-explicit'
  if (main === '5m' && subagent === '1h') return 'provably-explicit'
  return 'ambiguous'
}

/** Run the whole analysis over a parsed (accepted) session. */
export function analyzeSession(parsed: ParsedSession, pricing: PricingConfig): AnalysisResult {
  const mainRequests = parsed.requests.filter((r) => bucketOf(r) === 'main')
  const subagentRequests = parsed.requests.filter((r) => bucketOf(r) === 'subagent')

  const main = analyzeBucket('main', mainRequests, pricing)
  const subagent =
    subagentRequests.length > 0 ? analyzeBucket('subagent', subagentRequests, pricing) : undefined
  const explicitness = configExplicitness(main.observedTtl, subagent?.observedTtl)

  const buckets: BucketAnalysis[] = [{ ...main, configExplicitness: explicitness }]
  if (subagent) buckets.push({ ...subagent, configExplicitness: explicitness })

  return {
    metadata: parsed.metadata,
    parseStats: parsed.stats,
    parseWarnings: parsed.warnings,
    buckets,
    unknownModels: buildUnknownModelReport(parsed.requests, pricing),
    pricesAsOf: pricing.pricesAsOf,
    approximation: { allOrNothingExpiry: true, conservativeToward: '5m' },
  }
}
