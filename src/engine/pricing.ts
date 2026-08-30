/**
 * WP-02 — schema for `src/config/pricing.json`. That file does NOT exist
 * yet: WP-04 creates it, sourcing every number from Anthropic's published
 * pages and recording the exact provenance in the config itself (`source`,
 * `pricesAsOf`):
 *
 * - Base model rates: https://platform.claude.com/docs/en/about-claude/pricing
 * - Cache read/write multipliers:
 *   https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing
 *
 * Rates are USD per million tokens at published Anthropic API rates (D2).
 * Unknown model ids are never guessed — see the degradation policy in
 * `contract.ts`.
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
   * Keyed by observed `usage.service_tier` values ("standard", "batch", ...),
   * applied to input-side and output rates. Missing key or map = 1.0;
   * "standard" MUST be 1.0 when present.
   */
  serviceTierMultipliers?: Record<string, number>
  /**
   * Keyed by observed `usage.speed` values (e.g. "fast" = 2.0 on Opus 5).
   * Same defaulting rule as tiers.
   */
  speedMultipliers?: Record<string, number>
}

export interface PricingConfig {
  /** ISO date shown beside every dollar figure in the UI (decision D5). */
  pricesAsOf: string
  /**
   * Direct URL of the published Anthropic pricing page the numbers were
   * taken from (see the header) — required, so every rate is auditable.
   */
  source: string
  cacheMultipliers: CacheMultipliers
  /** Keyed by raw `message.model` ids, e.g. "claude-opus-5". */
  models: Record<string, ModelPricing>
}
