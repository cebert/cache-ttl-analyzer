/**
 * WP-04 — the shipped pricing config (decision D5): rates live in
 * `pricing.json`, keyed by raw `message.model` ids, with a `pricesAsOf`
 * date the UI shows beside every dollar figure. Every number comes from
 * the published page named in `source`; nothing is guessed.
 *
 * Provenance and policy (all from that page as of `pricesAsOf`):
 *  - Base input/output rates from the "Model pricing" table; cache
 *    multipliers (0.1x read, 1.25x 5m write, 2x 1h write) from "Prompt
 *    caching".
 *  - `batch` = 0.5 on input and output ("Batch processing"); caching
 *    multipliers stack on top.
 *  - `fast` = 2 on Claude Opus 5 / Opus 4.8 only ($10 / $50 per MTok, with
 *    caching multipliers stacking); Opus 4.6 runs fast-mode requests at
 *    standard speed and standard rates (explicit 1); other models reject
 *    or ignore it (no entry, so the schema's default of 1 applies).
 *  - `priority` = 1: Priority Tier is a pre-purchased capacity commitment,
 *    not a per-token premium, so those requests are shown at standard
 *    rates.
 *  - Not modeled: the 1.1x `inference_geo: "us"` data-residency multiplier
 *    (the parser does not carry `inference_geo`; see docs/PLAN.md WP-04).
 *  - Dated ids (e.g. `claude-opus-4-5-20251101`) duplicate their alias
 *    entries because older Claude Code versions wrote dated ids.
 *
 * To update: edit `pricing.json`, bump `pricesAsOf`, run `npm test` (the
 * config is validated on load and in `cost.test.ts`).
 */

import type { PricingConfig } from '../engine/pricing'
import { validatePricingConfig } from '../engine/cost'
import raw from './pricing.json'

export const PRICING: PricingConfig = validatePricingConfig(raw)
