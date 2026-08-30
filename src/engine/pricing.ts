/**
 * WP-02 — schema for `src/config/pricing.json` (frozen with the contract;
 * WP-04 populates the actual file from the published pricing page).
 *
 * Rates are USD per million tokens at published Anthropic API rates
 * (decision D2). Unknown model ids are never guessed — see the
 * unknown-model degradation policy in `contract.ts`.
 */

export interface CacheMultipliers {
  /** Cache read, × base input rate (published: 0.1). */
  read: number
  /** 5m-TTL cache write, × base input rate (published: 1.25). */
  write5m: number
  /** 1h-TTL cache write, × base input rate (published: 2.0). */
  write1h: number
}

export interface ModelPricing {
  /** Human-readable name for the UI, e.g. "Claude Opus 5". */
  displayName: string
  /** Base input rate, USD per 1M tokens. */
  inputPerMTok: number
  /** Output rate, USD per 1M tokens. */
  outputPerMTok: number
  /**
   * Multipliers keyed by observed `usage.service_tier` values ("standard",
   * "batch", ...). Applied to both input-side and output rates. Missing key
   * or missing map = 1.0 ("standard" MUST be 1.0 when present).
   */
  serviceTierMultipliers?: Record<string, number>
  /**
   * Multipliers keyed by observed `usage.speed` values (e.g. "fast" = 2.0 on
   * Opus 5, so $5/$25 becomes $10/$50). Same defaulting rule as tiers.
   */
  speedMultipliers?: Record<string, number>
}

export interface PricingConfig {
  /** ISO date shown beside every dollar figure in the UI (decision D5). */
  pricesAsOf: string
  /** URL of the published pricing page the numbers were taken from. */
  source: string
  cacheMultipliers: CacheMultipliers
  /** Keyed by raw `message.model` ids, e.g. "claude-opus-5". */
  models: Record<string, ModelPricing>
}
