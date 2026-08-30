/**
 * WP-04 — cost engine: prices token buckets at published Anthropic API
 * rates (decision D2) using a `PricingConfig` (`pricing.ts`).
 *
 * Pure functions, no config file dependency: the worker receives the
 * pricing over the protocol. Two entry points matter to callers:
 *  - `priceRequest` prices what actually happened (`RequestRecord`).
 *  - `priceTokens` prices arbitrary buckets, so the simulator (WP-05) can
 *    reprice a request under a counterfactual TTL with the same modifiers.
 *
 * Rate model (pricing page, "Feature-specific pricing"): the `service_tier`
 * and `speed` multipliers scale both the input-side and output rates;
 * cache multipliers then apply to the (scaled) input rate. Missing
 * multiplier keys mean 1.0 — unknown *models* are never guessed (contract
 * degradation policy); unknown *tiers/speeds* are priced at standard.
 */

import type { CostBreakdown, RequestRecord, RequestUsage, UnknownModelReport } from './contract'
import type { CacheMultipliers, ModelPricing, PricingConfig } from './pricing'

const TOKENS_PER_MTOK = 1_000_000

/** Token buckets a price is computed from — the unit the simulator reprices. */
export interface TokenBuckets {
  baseInputTokens: number
  cacheReadTokens: number
  cacheWrite5mTokens: number
  cacheWrite1hTokens: number
  outputTokens: number
}

export interface RateModifiers {
  serviceTier: string
  speed: string
}

export const ZERO_COST: CostBreakdown = Object.freeze({
  baseInputUsd: 0,
  cacheReadUsd: 0,
  cacheWrite5mUsd: 0,
  cacheWrite1hUsd: 0,
  outputUsd: 0,
  totalUsd: 0,
})

/** Multiplier lookup with the schema's defaulting rule: missing = 1.0. */
export function multiplierFor(map: Record<string, number> | undefined, key: string): number {
  if (!map || !Object.hasOwn(map, key)) return 1
  return map[key]
}

/** Price token buckets for one model under the given modifiers. */
export function priceTokens(
  buckets: TokenBuckets,
  model: ModelPricing,
  cache: CacheMultipliers,
  modifiers: RateModifiers,
): CostBreakdown {
  const scale =
    multiplierFor(model.serviceTierMultipliers, modifiers.serviceTier) *
    multiplierFor(model.speedMultipliers, modifiers.speed)
  const inputRate = model.inputPerMTok * scale
  const outputRate = model.outputPerMTok * scale
  const perToken = (tokens: number, rate: number) => (tokens / TOKENS_PER_MTOK) * rate

  const baseInputUsd = perToken(buckets.baseInputTokens, inputRate)
  const cacheReadUsd = perToken(buckets.cacheReadTokens, inputRate * cache.read)
  const cacheWrite5mUsd = perToken(buckets.cacheWrite5mTokens, inputRate * cache.write5m)
  const cacheWrite1hUsd = perToken(buckets.cacheWrite1hTokens, inputRate * cache.write1h)
  const outputUsd = perToken(buckets.outputTokens, outputRate)
  return {
    baseInputUsd,
    cacheReadUsd,
    cacheWrite5mUsd,
    cacheWrite1hUsd,
    outputUsd,
    totalUsd: baseInputUsd + cacheReadUsd + cacheWrite5mUsd + cacheWrite1hUsd + outputUsd,
  }
}

/**
 * Cache-write tokens the `cache_creation` split does not account for
 * (total exceeds 5m + 1h — e.g. a log written before the split existed).
 */
export function unattributedWriteTokens(usage: RequestUsage): number {
  return Math.max(
    0,
    usage.cacheCreationInputTokens - usage.cacheCreation5mTokens - usage.cacheCreation1hTokens,
  )
}

/**
 * Observed usage as token buckets. Unattributed write tokens are priced at
 * the 5m rate — the API's default TTL when none is requested — rather than
 * dropped, so actual cost never understates the bill.
 */
export function bucketsFromUsage(usage: RequestUsage): TokenBuckets {
  return {
    baseInputTokens: usage.inputTokens,
    cacheReadTokens: usage.cacheReadInputTokens,
    cacheWrite5mTokens: usage.cacheCreation5mTokens + unattributedWriteTokens(usage),
    cacheWrite1hTokens: usage.cacheCreation1hTokens,
    outputTokens: usage.outputTokens,
  }
}

/** Total tokens as defined by the suppression policy (contract). */
export function totalTokens(usage: RequestUsage): number {
  return (
    usage.inputTokens +
    usage.cacheReadInputTokens +
    usage.cacheCreationInputTokens +
    usage.outputTokens
  )
}

export function lookupModel(pricing: PricingConfig, modelId: string): ModelPricing | undefined {
  return Object.hasOwn(pricing.models, modelId) ? pricing.models[modelId] : undefined
}

/** Priced model ids, for the parser's `knownModels` option. */
export function knownModelIds(pricing: PricingConfig): ReadonlySet<string> {
  return new Set(Object.keys(pricing.models))
}

/** Exact cost of what happened, or null when the model is unpriced. */
export function priceRequest(request: RequestRecord, pricing: PricingConfig): CostBreakdown | null {
  const model = lookupModel(pricing, request.model)
  if (!model) return null
  return priceTokens(bucketsFromUsage(request.usage), model, pricing.cacheMultipliers, {
    serviceTier: request.usage.serviceTier,
    speed: request.usage.speed,
  })
}

export function addCosts(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return {
    baseInputUsd: a.baseInputUsd + b.baseInputUsd,
    cacheReadUsd: a.cacheReadUsd + b.cacheReadUsd,
    cacheWrite5mUsd: a.cacheWrite5mUsd + b.cacheWrite5mUsd,
    cacheWrite1hUsd: a.cacheWrite1hUsd + b.cacheWrite1hUsd,
    outputUsd: a.outputUsd + b.outputUsd,
    totalUsd: a.totalUsd + b.totalUsd,
  }
}

export function sumCosts(costs: Iterable<CostBreakdown>): CostBreakdown {
  let total: CostBreakdown = ZERO_COST
  for (const cost of costs) total = addCosts(total, cost)
  return total
}

/** Unknown-model disclosure (contract degradation policy). */
export function buildUnknownModelReport(
  requests: readonly RequestRecord[],
  pricing: PricingConfig,
): UnknownModelReport {
  const models: string[] = []
  let excludedRequests = 0
  let excludedTotalTokens = 0
  for (const request of requests) {
    if (lookupModel(pricing, request.model)) continue
    if (!models.includes(request.model)) models.push(request.model)
    excludedRequests++
    excludedTotalTokens += totalTokens(request.usage)
  }
  return { models, excludedRequests, excludedTotalTokens }
}

/* ---------------------------------------------------------------------------
 * Config validation — run once at load so a bad edit fails tests, not users.
 * ------------------------------------------------------------------------- */

export class PricingConfigError extends Error {
  constructor(message: string) {
    super(`pricing config: ${message}`)
    this.name = 'PricingConfigError'
  }
}

function assertRate(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new PricingConfigError(`${label} must be a finite non-negative number`)
  }
}

function assertMultiplierMap(map: unknown, label: string): void {
  if (map === undefined) return
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    throw new PricingConfigError(`${label} must be an object`)
  }
  for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
    assertRate(value, `${label}.${key}`)
  }
  const standard = (map as Record<string, unknown>)['standard']
  if (standard !== undefined && standard !== 1) {
    throw new PricingConfigError(`${label}.standard must be 1 when present`)
  }
}

/**
 * Structural + semantic validation of a `PricingConfig` (the schema's
 * documented rules: rates finite and non-negative, "standard" = 1.0 when
 * present, cache multipliers positive, a dated `pricesAsOf` and a source
 * URL). Returns the same object, typed.
 */
export function validatePricingConfig(config: unknown): PricingConfig {
  if (typeof config !== 'object' || config === null) {
    throw new PricingConfigError('must be an object')
  }
  const c = config as Record<string, unknown>
  if (typeof c['pricesAsOf'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c['pricesAsOf'])) {
    throw new PricingConfigError('pricesAsOf must be an ISO date (YYYY-MM-DD)')
  }
  if (typeof c['source'] !== 'string' || !/^https:\/\//.test(c['source'])) {
    throw new PricingConfigError('source must be an https URL')
  }
  const cache = c['cacheMultipliers'] as Record<string, unknown> | undefined
  if (typeof cache !== 'object' || cache === null) {
    throw new PricingConfigError('cacheMultipliers must be an object')
  }
  for (const key of ['read', 'write5m', 'write1h'] as const) {
    assertRate(cache[key], `cacheMultipliers.${key}`)
    if (cache[key] === 0) throw new PricingConfigError(`cacheMultipliers.${key} must be positive`)
  }
  const models = c['models']
  if (typeof models !== 'object' || models === null || Array.isArray(models)) {
    throw new PricingConfigError('models must be an object')
  }
  const entries = Object.entries(models as Record<string, unknown>)
  if (entries.length === 0) throw new PricingConfigError('models must not be empty')
  for (const [id, model] of entries) {
    if (typeof model !== 'object' || model === null) {
      throw new PricingConfigError(`models.${id} must be an object`)
    }
    const m = model as Record<string, unknown>
    if (typeof m['displayName'] !== 'string' || m['displayName'].length === 0) {
      throw new PricingConfigError(`models.${id}.displayName must be a non-empty string`)
    }
    assertRate(m['inputPerMTok'], `models.${id}.inputPerMTok`)
    assertRate(m['outputPerMTok'], `models.${id}.outputPerMTok`)
    assertMultiplierMap(m['serviceTierMultipliers'], `models.${id}.serviceTierMultipliers`)
    assertMultiplierMap(m['speedMultipliers'], `models.${id}.speedMultipliers`)
  }
  return config as PricingConfig
}
