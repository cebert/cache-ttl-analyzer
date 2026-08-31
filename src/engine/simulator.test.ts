/**
 * WP-05 simulator tests. Dollar figures are hand-computed at Opus 5 rates
 * ($5 in / $25 out per MTok; cache read $0.50, 5m write $6.25, 1h write
 * $10 per MTok) — see the arithmetic in each case.
 */

import { createReadStream, readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { PRICING } from '../config/pricing'
import {
  CACHE_TTL_5M_MS,
  UNKNOWN_MODEL_SUPPRESSION_RATIO,
  type InsightEvent,
  type ParsedSession,
  type RequestRecord,
  type RequestUsage,
} from './contract'
import { parseSession } from './parser'
import {
  analyzeBucket,
  analyzeSession,
  configExplicitness,
  dominantTtl,
  gapMs,
  hardResetCauses,
  sessionShape,
  groupByThread,
} from './simulator'

const T0 = Date.parse('2026-08-30T12:00:00.000Z')
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString()

interface ReqOpts {
  id: string
  start: number
  end?: number
  model?: string
  effort?: string
  version?: string
  threadId?: string
  sidechain?: boolean
  input?: number
  read?: number
  w5m?: number
  w1h?: number
  output?: number
  tier?: string
  speed?: string
}

function req(o: ReqOpts): RequestRecord {
  const w5m = o.w5m ?? 0
  const w1h = o.w1h ?? 0
  const usage: RequestUsage = {
    inputTokens: o.input ?? 10,
    cacheReadInputTokens: o.read ?? 0,
    cacheCreationInputTokens: w5m + w1h,
    cacheCreation5mTokens: w5m,
    cacheCreation1hTokens: w1h,
    outputTokens: o.output ?? 5,
    serviceTier: o.tier ?? 'standard',
    speed: o.speed ?? 'standard',
  }
  const record: RequestRecord = {
    messageId: o.id,
    model: o.model ?? 'claude-opus-5',
    timestamp: at(o.end ?? o.start + 3),
    requestStartTimestamp: at(o.start),
    requestStartSource: 'user-ancestor',
    threadId: o.threadId ?? (o.sidechain ? 'agent-1' : 'main'),
    isSidechain: o.sidechain ?? false,
    usage,
  }
  if (o.effort !== undefined) record.effort = o.effort
  if (o.version !== undefined) record.version = o.version
  return record
}

function session(requests: RequestRecord[]): ParsedSession {
  return {
    metadata: {
      models: [...new Set(requests.map((r) => r.model))],
      versions: [],
      efforts: [],
      fileName: 's.jsonl',
      fileSizeBytes: 1,
    },
    requests,
    stats: {
      totalLines: requests.length,
      nonEmptyLines: requests.length,
      malformedLines: 0,
      skippedRecordTypes: {},
      assistantRows: requests.length,
      dedupedRequests: requests.length,
      syntheticRowsExcluded: 0,
      invalidUsageRowsSkipped: 0,
    },
    verdict: 'valid',
    warnings: [],
  }
}

const kinds = (events: InsightEvent[]) => events.map((e) => e.kind)
const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 10)

describe('shortening: observed 1h, scenario 5m (feasibility §7 rule)', () => {
  // r1 @0s: in 10, 1h write 1000, out 5.   r2 @600s: in 10, read 1000, 1h write 200, out 5.
  const requests = [
    req({ id: 'r1', start: 0, w1h: 1000 }),
    req({ id: 'r2', start: 600, read: 1000, w1h: 200 }),
  ]
  const bucket = analyzeBucket('main', requests, PRICING)

  it('actual cost is exact and the observed-TTL scenario reproduces it (reconciliation)', () => {
    // r1: 10×$5 = 0.00005 + 1000×$10 = 0.01 + 5×$25 = 0.000125 → 0.010175
    // r2: 0.00005 + 1000×$0.50 = 0.0005 + 200×$10 = 0.002 + 0.000125 → 0.002675
    close(bucket.actualCost.totalUsd, 0.01285)
    expect(bucket.scenarios.oneHour.cost).toEqual(bucket.actualCost)
    expect(bucket.observedTtl).toBe('1h')
    expect(bucket.observedWriteSplit).toEqual({
      fiveMinuteWriteTokens: 0,
      oneHourWriteTokens: 1200,
    })
  })

  it('under 5m the 10-minute gap lapses the entry: the read becomes a 5m write', () => {
    // r1: 0.00005 + 1000×$6.25 = 0.00625 + 0.000125 → 0.006425
    // r2: 0.00005 + (200 + 1000)×$6.25 = 0.0075 + 0.000125 → 0.007675
    const fiveMinute = bucket.scenarios.fiveMinute
    close(fiveMinute.cost.totalUsd, 0.0141)
    close(fiveMinute.cost.cacheReadUsd, 0)
    close(fiveMinute.cost.cacheWrite5mUsd, 0.01375)
    close(fiveMinute.cost.cacheWrite1hUsd, 0)
    expect(fiveMinute).toMatchObject({
      cacheExpiries: 1,
      hardResets: 0,
      warmReadRequests: 0,
      wastedWriteTokens: 1000,
    })
    expect(fiveMinute.events).toEqual([
      {
        kind: 'cache-write',
        ttl: '5m',
        tokens: 1000,
        expiryClass: 'user-controlled',
        timestamp: at(0),
        threadId: 'main',
        messageId: 'r1',
      },
      {
        kind: 'expiry',
        gapMs: 600_000,
        expiryClass: 'user-controlled',
        rewrittenTokens: 1000,
        timestamp: at(600),
        threadId: 'main',
        messageId: 'r2',
      },
      {
        kind: 'cache-write',
        ttl: '5m',
        tokens: 1200,
        expiryClass: 'user-controlled',
        timestamp: at(600),
        threadId: 'main',
        messageId: 'r2',
      },
    ])
  })

  it('the 1h scenario shows the warm read and recommends 1h with the exact delta', () => {
    const oneHour = bucket.scenarios.oneHour
    expect(oneHour).toMatchObject({ cacheExpiries: 0, warmReadRequests: 1, wastedWriteTokens: 0 })
    expect(kinds(oneHour.events)).toEqual(['cache-write', 'warm-read', 'cache-write'])
    expect(bucket.recommendation).toBe('1h')
    close(bucket.savingsUsd, 0.00125)
    expect(bucket.verdictSuppressed).toBe(false)
    expect(bucket.unpricedTokenShare).toBe(0)
  })

  it('reports the session shape', () => {
    expect(bucket.shape).toEqual({
      requestCount: 2,
      spanMs: 603_000,
      largestGapMs: 600_000,
      gapsIn5mTo1hBand: 1,
      gapsUnder5m: 0,
      gapsOver1h: 0,
    })
    expect(bucket.threadCount).toBe(1)
  })
})

describe('lengthening: observed 5m, scenario 1h', () => {
  // r1 @0s: 5m write 1000.   r2 @600s: read 0, 5m write 1500 (the log re-wrote the lapsed prefix).
  const bucket = analyzeBucket(
    'main',
    [req({ id: 'r1', start: 0, w5m: 1000 }), req({ id: 'r2', start: 600, w5m: 1500 })],
    PRICING,
  )

  it('the 5m scenario equals actual and names the observed expiry', () => {
    // r1: 0.00005 + 1000×$6.25 = 0.00625 + 0.000125 → 0.006425
    // r2: 0.00005 + 1500×$6.25 = 0.009375 + 0.000125 → 0.00955
    close(bucket.actualCost.totalUsd, 0.015975)
    expect(bucket.scenarios.fiveMinute.cost).toEqual(bucket.actualCost)
    expect(bucket.scenarios.fiveMinute).toMatchObject({
      cacheExpiries: 1,
      wastedWriteTokens: 1000,
      warmReadRequests: 0,
    })
    const expiry = bucket.scenarios.fiveMinute.events.find((e) => e.kind === 'expiry')
    expect(expiry).toMatchObject({ gapMs: 600_000, rewrittenTokens: 1000, messageId: 'r2' })
  })

  it('under 1h the lapsed prefix (bounded by what was warm) is read, not re-written', () => {
    // r1: 0.00005 + 1000×$10 = 0.01 + 0.000125 → 0.010175
    // r2: 0.00005 + read 1000×$0.50 = 0.0005 + write 500×$10 = 0.005 + 0.000125 → 0.005675
    const oneHour = bucket.scenarios.oneHour
    close(oneHour.cost.totalUsd, 0.01585)
    close(oneHour.cost.cacheReadUsd, 0.0005)
    close(oneHour.cost.cacheWrite1hUsd, 0.015)
    expect(oneHour).toMatchObject({ cacheExpiries: 0, warmReadRequests: 1, wastedWriteTokens: 0 })
    expect(oneHour.events.find((e) => e.kind === 'warm-read')).toMatchObject({
      tokens: 1000,
      messageId: 'r2',
    })
    expect(bucket.recommendation).toBe('1h')
    close(bucket.savingsUsd, 0.000125)
  })
})

describe('partial lapse: observed 5m, a stable prefix stayed warm', () => {
  // The shape `fixtures/captured/scenarios/gap-heavy-5m` exhibits: after a
  // >5m gap the log shows a read AND a re-write, so only part of the entry
  // lapsed. r1 @0s: 5m write 2000 (warm = 2000). r2 @600s: read 800, 5m
  // write 1500 — 1200 of the warm prefix lapsed and was re-written, 300 is
  // new content.
  const bucket = analyzeBucket(
    'main',
    [req({ id: 'r1', start: 0, w5m: 2000 }), req({ id: 'r2', start: 600, read: 800, w5m: 1500 })],
    PRICING,
  )

  it('the 5m scenario equals actual and names the partial expiry', () => {
    // r1: 10×$5 = 0.00005 + 2000×$6.25 = 0.0125 + 5×$25 = 0.000125 → 0.012675
    // r2: 0.00005 + 800×$0.50 = 0.0004 + 1500×$6.25 = 0.009375 + 0.000125 → 0.00995
    close(bucket.actualCost.totalUsd, 0.022625)
    expect(bucket.scenarios.fiveMinute.cost).toEqual(bucket.actualCost)
    const fiveMinute = bucket.scenarios.fiveMinute
    // The request both read and expired, so it is a warm read as well.
    expect(fiveMinute).toMatchObject({ cacheExpiries: 1, warmReadRequests: 1 })
    expect(fiveMinute.events.find((e) => e.kind === 'expiry')).toMatchObject({
      gapMs: 600_000,
      expiryClass: 'user-controlled',
      // Only the lapsed share, min(write 1500, warm 2000 − read 800) = 1200.
      rewrittenTokens: 1200,
      messageId: 'r2',
    })
    // …and only that share of r1's write was wasted: 800 of it was read.
    expect(fiveMinute.wastedWriteTokens).toBe(1200)
  })

  it('under 1h the lapsed share is restored as a read, the new content is not', () => {
    // r1: 0.00005 + 2000×$10 = 0.02 + 0.000125 → 0.020175
    // r2: 0.00005 + read (800 + 1200)×$0.50 = 0.001 + write 300×$10 = 0.003
    //     + 0.000125 → 0.004175
    const oneHour = bucket.scenarios.oneHour
    close(oneHour.cost.totalUsd, 0.02435)
    close(oneHour.cost.cacheReadUsd, 0.001)
    close(oneHour.cost.cacheWrite1hUsd, 0.023)
    expect(oneHour).toMatchObject({ cacheExpiries: 0, warmReadRequests: 1, wastedWriteTokens: 0 })
    expect(
      oneHour.events.find((e) => e.kind === 'warm-read' && e.messageId === 'r2'),
    ).toMatchObject({ tokens: 2000 })
    expect(
      oneHour.events.find((e) => e.kind === 'cache-write' && e.messageId === 'r2'),
    ).toMatchObject({ tokens: 300, ttl: '1h' })
    // Before partial lapses were modeled the 1h scenario re-wrote all 1500
    // (0.00005 + 0.0004 + 0.015 + 0.000125 → r2 0.015575, total 0.03575);
    // 5m still wins this two-request case, but by $0.001725, not $0.013125.
    expect(bucket.recommendation).toBe('5m')
    close(bucket.savingsUsd, 0.001725)
  })

  it('a read larger than the tracked warm entry restores nothing', () => {
    // r2 reads 2500 of a 2000-token entry (the first request of a thread can
    // read a cache this file never wrote). warm − read is negative, so there
    // is no lapsed share to restore and the write stands.
    const wide = analyzeBucket(
      'main',
      [req({ id: 'r1', start: 0, w5m: 2000 }), req({ id: 'r2', start: 600, read: 2500, w5m: 400 })],
      PRICING,
    )
    const oneHour = wide.scenarios.oneHour
    // r2: 0.00005 + 2500×$0.50 = 0.00125 + 400×$10 = 0.004 + 0.000125 → 0.005425
    close(oneHour.cost.totalUsd, 0.0256)
    expect(oneHour.warmReadRequests).toBe(1)
    expect(wide.scenarios.fiveMinute.cacheExpiries).toBe(0)
  })
})

describe('session shape and token totals (WP-08 amendment)', () => {
  // Four same-thread gaps, one per band and one on each inclusive bound:
  // 0→60s (under), 60→360s (300s exactly, still under), 360→1560s (20m, in
  // band), 1560→5460s (65m, over).
  const requests = [
    req({ id: 'r1', start: 0, w1h: 1000, input: 10, output: 5 }),
    req({ id: 'r2', start: 60, read: 1000, w1h: 100 }),
    req({ id: 'r3', start: 360, read: 1100, w1h: 100 }),
    req({ id: 'r4', start: 1560, read: 1200, w1h: 100 }),
    req({ id: 'r5', start: 5460, w1h: 1500 }),
  ]

  it('buckets every gap into exactly one band', () => {
    const { shape } = analyzeBucket('main', requests, PRICING)
    expect(shape).toMatchObject({
      requestCount: 5,
      gapsUnder5m: 2,
      gapsIn5mTo1hBand: 1,
      gapsOver1h: 1,
      largestGapMs: 3_900_000,
    })
    expect(shape.gapsUnder5m + shape.gapsIn5mTo1hBand + shape.gapsOver1h).toBe(
      shape.requestCount - 1,
    )
  })

  it('totals the observed tokens, unattributed writes included', () => {
    // input 5×10 = 50; reads 1000 + 1100 + 1200 = 3300;
    // writes 1000 + 100 + 100 + 100 + 1500 = 2800; output 5×5 = 25.
    expect(analyzeBucket('main', requests, PRICING).tokenTotals).toEqual({
      inputTokens: 50,
      cacheReadTokens: 3300,
      cacheWriteTokens: 2800,
      outputTokens: 25,
    })
  })

  it('counts a write the split did not attribute', () => {
    // `cacheCreationInputTokens` 900 with a 400/100 split leaves 400
    // unattributed; pricing folds it into the 5m side, and so does this.
    const orphan = req({ id: 'r1', start: 0, w5m: 400, w1h: 100 })
    orphan.usage.cacheCreationInputTokens = 900
    expect(analyzeBucket('main', [orphan], PRICING).tokenTotals.cacheWriteTokens).toBe(900)
  })

  it('an empty bucket totals to zero rather than to nothing', () => {
    const empty = analyzeBucket('main', [], PRICING)
    expect(empty.tokenTotals).toEqual({
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    })
    expect(empty.shape).toMatchObject({ gapsUnder5m: 0, gapsIn5mTo1hBand: 0, gapsOver1h: 0 })
  })
})

describe('tight loop: gaps under 5m, observed 1h', () => {
  it('only the write price differs, so 5m wins', () => {
    // actual/1h: r1 0.010175; r2 0.00005 + 0.0005 + 100×$10 = 0.001 + 0.000125 → 0.001675 → 0.01185
    // 5m: r1 0.006425; r2 0.00005 + 0.0005 + 100×$6.25 = 0.000625 + 0.000125 → 0.0013 → 0.007725
    const bucket = analyzeBucket(
      'main',
      [req({ id: 'r1', start: 0, w1h: 1000 }), req({ id: 'r2', start: 60, read: 1000, w1h: 100 })],
      PRICING,
    )
    close(bucket.actualCost.totalUsd, 0.01185)
    close(bucket.scenarios.fiveMinute.cost.totalUsd, 0.007725)
    expect(bucket.recommendation).toBe('5m')
    close(bucket.savingsUsd, 0.004125)
    expect(bucket.scenarios.fiveMinute.cacheExpiries).toBe(0)
    expect(bucket.scenarios.fiveMinute.warmReadRequests).toBe(1)
    expect(bucket.shape.gapsIn5mTo1hBand).toBe(0)
  })

  it('a gap of exactly 5m is still alive under 5m (inclusive bound)', () => {
    const bucket = analyzeBucket(
      'main',
      [req({ id: 'r1', start: 0, w1h: 1000 }), req({ id: 'r2', start: 300, read: 1000 })],
      PRICING,
    )
    expect(bucket.scenarios.fiveMinute.cacheExpiries).toBe(0)
    expect(bucket.shape.gapsIn5mTo1hBand).toBe(0)
    const over = analyzeBucket(
      'main',
      [req({ id: 'r1', start: 0, w1h: 1000 }), req({ id: 'r2', start: 301, read: 1000 })],
      PRICING,
    )
    expect(over.scenarios.fiveMinute.cacheExpiries).toBe(1)
    expect(over.shape.gapsIn5mTo1hBand).toBe(1)
  })

  it('gaps beyond 1h lapse in both scenarios and are not in the 5m–1h band', () => {
    const bucket = analyzeBucket(
      'main',
      [req({ id: 'r1', start: 0, w1h: 1000 }), req({ id: 'r2', start: 3601, w1h: 1000 })],
      PRICING,
    )
    expect(bucket.scenarios.fiveMinute.cacheExpiries).toBe(1)
    expect(bucket.scenarios.oneHour.cacheExpiries).toBe(1)
    expect(bucket.shape).toMatchObject({ largestGapMs: 3_601_000, gapsIn5mTo1hBand: 0 })
    // Both scenarios re-write; they differ only by the write price.
    close(bucket.scenarios.fiveMinute.cost.cacheWrite5mUsd, 0.0125)
    close(bucket.scenarios.oneHour.cost.cacheWrite1hUsd, 0.02)
  })
})

describe('hard resets (§6.6)', () => {
  it('a model switch empties the cache and attributes no expiry to the gap', () => {
    const bucket = analyzeBucket(
      'main',
      [
        req({ id: 'r1', start: 0, w1h: 1000 }),
        req({ id: 'r2', start: 700, model: 'claude-fable-5', read: 5000, w1h: 300 }),
      ],
      PRICING,
    )
    for (const scenario of [bucket.scenarios.fiveMinute, bucket.scenarios.oneHour]) {
      expect(scenario.hardResets).toBe(1)
      expect(scenario.cacheExpiries).toBe(0)
      expect(scenario.wastedWriteTokens).toBe(1000)
      expect(scenario.events.find((e) => e.kind === 'hard-reset')).toEqual({
        kind: 'hard-reset',
        cause: 'model-change',
        from: 'claude-opus-5',
        to: 'claude-fable-5',
        timestamp: at(700),
        threadId: 'main',
        messageId: 'r2',
      })
    }
    // The observed usage stands: r2's 5000-token read is priced as a read
    // in both scenarios (Fable 5: 5000 × $1 = 0.005).
    close(bucket.scenarios.fiveMinute.cost.cacheReadUsd, 0.005)
    close(bucket.scenarios.oneHour.cost.cacheReadUsd, 0.005)
    expect(bucket.recommendation).toBe('5m')
  })

  it('effort and version changes are resets too; all causes are named', () => {
    const previous = req({ id: 'a', start: 0, effort: 'high', version: '2.1.250' })
    const current = req({
      id: 'b',
      start: 1,
      effort: 'medium',
      version: '2.1.251',
      model: 'claude-opus-4-8',
    })
    expect(hardResetCauses(previous, current)).toEqual([
      { cause: 'model-change', from: 'claude-opus-5', to: 'claude-opus-4-8' },
      { cause: 'effort-change', from: 'high', to: 'medium' },
      { cause: 'version-change', from: '2.1.250', to: '2.1.251' },
    ])
    expect(
      hardResetCauses(previous, req({ id: 'c', start: 2, effort: 'high', version: '2.1.250' })),
    ).toEqual([])
    const bucket = analyzeBucket('main', [previous, current], PRICING)
    expect(bucket.scenarios.oneHour.hardResets).toBe(1)
    expect(kinds(bucket.scenarios.oneHour.events).filter((k) => k === 'hard-reset')).toHaveLength(3)
  })

  it('an absent effort/version on both sides is not a change', () => {
    expect(hardResetCauses(req({ id: 'a', start: 0 }), req({ id: 'b', start: 1 }))).toEqual([])
  })
})

describe('mixed TTLs: only the user-controllable share is repriced', () => {
  // Bucket is 1h-dominant; r2 carries 300 server-tool 5m tokens beside its 1000 1h tokens.
  const bucket = analyzeBucket(
    'main',
    [
      req({ id: 'r1', start: 0, w1h: 1000 }),
      req({ id: 'r2', start: 60, read: 1000, w5m: 300, w1h: 1000 }),
    ],
    PRICING,
  )

  it('server-tool 5m writes stay at 5m in both scenarios as their own class', () => {
    // 5m scenario r2 writes: (1000 user + 300 server) × $6.25 = 0.008125
    // 1h scenario r2 writes: 1000 × $10 = 0.01 (1h) + 300 × $6.25 = 0.001875 (5m)
    const { fiveMinute, oneHour } = bucket.scenarios
    close(fiveMinute.cost.cacheWrite5mUsd, 0.00625 + 0.008125)
    close(fiveMinute.cost.cacheWrite1hUsd, 0)
    close(oneHour.cost.cacheWrite1hUsd, 0.02)
    close(oneHour.cost.cacheWrite5mUsd, 0.001875)
    expect(oneHour.cost).toEqual(bucket.actualCost)
    const writes = oneHour.events.filter((e) => e.kind === 'cache-write' && e.messageId === 'r2')
    expect(writes).toEqual([
      expect.objectContaining({ ttl: '1h', tokens: 1000, expiryClass: 'user-controlled' }),
      expect.objectContaining({ ttl: '5m', tokens: 300, expiryClass: 'server-tool-5m' }),
    ])
    expect(bucket.observedWriteSplit).toEqual({
      fiveMinuteWriteTokens: 300,
      oneHourWriteTokens: 2000,
    })
  })

  it("a request whose only write is a server-tool 5m write does not shorten the user's warm entry", () => {
    // 1h-dominant: r1 writes 1000@1h; r2 (+60s) reads 1000 and only writes 300@5m
    // (web search); r3 (+660s) reads 1300 warm — the log proves the 1h entry lived.
    const bucket = analyzeBucket(
      'main',
      [
        req({ id: 'r1', start: 0, w1h: 1000 }),
        req({ id: 'r2', start: 60, read: 1000, w5m: 300 }),
        req({ id: 'r3', start: 660, read: 1300 }),
      ],
      PRICING,
    )
    expect(bucket.observedTtl).toBe('1h')
    expect(bucket.scenarios.oneHour.cost).toEqual(bucket.actualCost)
    expect(bucket.scenarios.oneHour.cacheExpiries).toBe(0)
    // Under 5m the 600s gap before r3 lapses the entry: its read becomes a write.
    expect(bucket.scenarios.fiveMinute.cacheExpiries).toBe(1)
    expect(bucket.scenarios.fiveMinute.events.find((e) => e.kind === 'expiry')).toMatchObject({
      messageId: 'r3',
      rewrittenTokens: 1300,
    })
    expect(bucket.recommendation).toBe('1h')
  })

  it('in a 5m-dominant bucket a 1h residual is user-controlled, never a server-tool write', () => {
    // r1 writes 5000@5m; r2 (+60s) reads 5000, writes 1000@5m + 800@1h (a config flip).
    const bucket = analyzeBucket(
      'main',
      [
        req({ id: 'r1', start: 0, w5m: 5000 }),
        req({ id: 'r2', start: 60, read: 5000, w5m: 1000, w1h: 800 }),
      ],
      PRICING,
    )
    expect(bucket.observedTtl).toBe('5m')
    const { fiveMinute, oneHour } = bucket.scenarios
    // "Everything at 5m" prices the 1800 tokens at 5m: 1800 × $6.25 = 0.01125 (+ r1's 0.03125)
    close(fiveMinute.cost.cacheWrite1hUsd, 0)
    close(fiveMinute.cost.cacheWrite5mUsd, 0.03125 + 0.01125)
    // "Everything at 1h" prices them at 1h: 1800 × $10 = 0.018 (+ r1's 0.05)
    close(oneHour.cost.cacheWrite1hUsd, 0.05 + 0.018)
    close(oneHour.cost.cacheWrite5mUsd, 0)
    for (const scenario of [fiveMinute, oneHour]) {
      const writes = scenario.events.filter((e) => e.kind === 'cache-write' && e.messageId === 'r2')
      expect(writes).toEqual([
        expect.objectContaining({
          ttl: scenario.ttl,
          tokens: 1800,
          expiryClass: 'user-controlled',
        }),
      ])
    }
  })

  it('dominant TTL is token-weighted, null without writes, and 1h on an exact tie', () => {
    expect(dominantTtl({ fiveMinuteWriteTokens: 0, oneHourWriteTokens: 0 })).toBeNull()
    expect(dominantTtl({ fiveMinuteWriteTokens: 10, oneHourWriteTokens: 9 })).toBe('5m')
    expect(dominantTtl({ fiveMinuteWriteTokens: 9, oneHourWriteTokens: 10 })).toBe('1h')
    expect(dominantTtl({ fiveMinuteWriteTokens: 10, oneHourWriteTokens: 10 })).toBe('1h')
  })

  it('with no writes at all there is nothing to reprice: both scenarios equal actual', () => {
    const none = analyzeBucket(
      'main',
      [req({ id: 'r1', start: 0, read: 500 }), req({ id: 'r2', start: 900, read: 500 })],
      PRICING,
    )
    expect(none.observedTtl).toBeNull()
    expect(none.scenarios.fiveMinute.cost).toEqual(none.actualCost)
    expect(none.scenarios.oneHour.cost).toEqual(none.actualCost)
    expect(none.recommendation).toBe('5m') // tie with nothing observed
  })
})

describe('unknown models (degradation policy)', () => {
  it('excludes unpriced requests from cost and suppresses the verdict above the ratio', () => {
    // opus-5 request: 10 + 0 + 1000 + 5 = 1015 tokens; mystery: 10 + 500 + 0 + 5 = 515 → share 0.3366
    const bucket = analyzeBucket(
      'main',
      [
        req({ id: 'r1', start: 0, w1h: 1000 }),
        req({ id: 'r2', start: 60, model: 'claude-mystery-9', read: 500 }),
      ],
      PRICING,
    )
    close(bucket.unpricedTokenShare, 515 / 1530)
    expect(bucket.unpricedTokenShare).toBeGreaterThan(UNKNOWN_MODEL_SUPPRESSION_RATIO)
    expect(bucket).toMatchObject({
      verdictSuppressed: true,
      suppressionReason: 'unknown-model-share-exceeded',
      recommendation: 'no-verdict',
    })
    close(bucket.actualCost.totalUsd, 0.010175) // r1 only
    // The unpriced request is still replayed: its read shows up as an event.
    expect(bucket.scenarios.oneHour.warmReadRequests).toBe(1)
  })

  it('a small unpriced share keeps the verdict and is still disclosed', () => {
    // 1015 priced vs 55 unpriced (10 + 40 + 0 + 5) → 0.0514
    const bucket = analyzeBucket(
      'main',
      [
        req({ id: 'r1', start: 0, w1h: 1000 }),
        req({ id: 'r2', start: 60, model: 'claude-mystery-9', read: 40 }),
      ],
      PRICING,
    )
    close(bucket.unpricedTokenShare, 55 / 1070)
    expect(bucket.verdictSuppressed).toBe(false)
    expect(bucket.suppressionReason).toBeUndefined()
    expect(bucket.recommendation).toBe('5m')
  })

  it('analyzeSession reports them across buckets', () => {
    const result = analyzeSession(
      session([
        req({ id: 'r1', start: 0, w1h: 1000 }),
        req({ id: 'r2', start: 60, model: 'claude-mystery-9', read: 40 }),
        req({ id: 'r3', start: 70, model: 'claude-mystery-9', sidechain: true, output: 1 }),
      ]),
      PRICING,
    )
    expect(result.unknownModels).toEqual({
      models: ['claude-mystery-9'],
      excludedRequests: 2,
      excludedTotalTokens: 55 + 11,
    })
  })
})

describe('buckets and threads (F2, D4)', () => {
  it('a modern main-session upload yields only the main bucket', () => {
    const result = analyzeSession(session([req({ id: 'r1', start: 0, w1h: 1000 })]), PRICING)
    expect(result.buckets.map((b) => b.bucket)).toEqual(['main'])
    expect(result.buckets[0].configExplicitness).toBe('unknown')
  })

  it('sidechain requests form the subagent bucket, with per-thread gaps', () => {
    const requests = [
      req({ id: 'm1', start: 0, w1h: 1000 }),
      req({ id: 'a1', start: 10, sidechain: true, threadId: 'agent-1', w5m: 2000 }),
      req({ id: 'b1', start: 200, sidechain: true, threadId: 'agent-2', w5m: 3000 }),
      req({ id: 'b2', start: 250, sidechain: true, threadId: 'agent-2', read: 3000, w5m: 10 }),
      // agent-1 lapsed at 5m: the log re-wrote its 2000-token prefix plus 10 new.
      req({ id: 'a2', start: 410, sidechain: true, threadId: 'agent-1', w5m: 2010 }),
      req({ id: 'm2', start: 500, read: 1000, w1h: 50 }),
    ]
    const result = analyzeSession(session(requests), PRICING)
    expect(result.buckets.map((b) => b.bucket)).toEqual(['main', 'subagent'])
    const [main, subagent] = result.buckets
    expect(main).toMatchObject({ threadCount: 1, requestCount: 2, observedTtl: '1h' })
    expect(subagent).toMatchObject({ threadCount: 2, requestCount: 4, observedTtl: '5m' })
    // agent-1's own gap is 400s (a 5m lapse); agent-2's is 50s. Interleaving
    // must not create cross-thread gaps.
    expect(subagent.shape).toMatchObject({ largestGapMs: 400_000, gapsIn5mTo1hBand: 1 })
    expect(subagent.scenarios.fiveMinute.cacheExpiries).toBe(1)
    expect(subagent.scenarios.oneHour.cacheExpiries).toBe(0)
    // Under 1h the 2000-token prefix would have been read back.
    expect(subagent.scenarios.oneHour.warmReadRequests).toBe(2)
    expect(
      subagent.scenarios.oneHour.events.find((e) => e.kind === 'warm-read' && e.messageId === 'a2'),
    ).toMatchObject({ tokens: 2000 })
    expect(
      subagent.scenarios.oneHour.events.filter((e) => e.kind === 'subagent-thread-start'),
    ).toEqual([
      expect.objectContaining({ threadId: 'agent-1', messageId: 'a1', timestamp: at(10) }),
      expect.objectContaining({ threadId: 'agent-2', messageId: 'b1', timestamp: at(200) }),
    ])
    // Events are ordered by time across threads.
    const times = subagent.scenarios.oneHour.events.map((e) => Date.parse(e.timestamp))
    expect([...times].sort((x, y) => x - y)).toEqual(times)
    // Main 1h + subagents 5m is the ambiguous default-looking pattern.
    expect(main.configExplicitness).toBe('ambiguous')
    expect(subagent.configExplicitness).toBe('ambiguous')
  })

  it('a subagent-only upload still carries an empty main bucket with no verdict', () => {
    const result = analyzeSession(
      session([req({ id: 'a1', start: 0, sidechain: true, w5m: 100 })]),
      PRICING,
    )
    expect(result.buckets.map((b) => b.bucket)).toEqual(['main', 'subagent'])
    const main = result.buckets[0]
    expect(main).toMatchObject({
      requestCount: 0,
      threadCount: 0,
      recommendation: 'no-verdict',
      verdictSuppressed: false,
      observedTtl: null,
      savingsUsd: 0,
      unpricedTokenShare: 0,
      shape: { requestCount: 0, spanMs: 0, largestGapMs: 0, gapsIn5mTo1hBand: 0 },
    })
    expect(main.actualCost.totalUsd).toBe(0)
    expect(main.scenarios.oneHour.events).toEqual([])
  })

  it('config explicitness follows the feasibility §3 table', () => {
    expect(configExplicitness('1h', '1h')).toBe('provably-explicit')
    expect(configExplicitness('5m', '1h')).toBe('provably-explicit')
    expect(configExplicitness('1h', '5m')).toBe('ambiguous')
    expect(configExplicitness('5m', '5m')).toBe('ambiguous')
    expect(configExplicitness('1h', undefined)).toBe('unknown')
    expect(configExplicitness('1h', null)).toBe('unknown')
    expect(configExplicitness(null, '5m')).toBe('unknown')
  })

  it('groupByThread keeps file order inside each thread', () => {
    const threads = groupByThread([
      req({ id: 'a', start: 5, threadId: 'x' }),
      req({ id: 'b', start: 1, threadId: 'y' }),
      req({ id: 'c', start: 0, threadId: 'x' }),
    ])
    expect([...threads.keys()]).toEqual(['x', 'y'])
    expect(threads.get('x')?.map((r) => r.messageId)).toEqual(['a', 'c'])
  })

  it('gaps never go negative (request-start fallbacks can be out of order)', () => {
    expect(gapMs(req({ id: 'a', start: 10 }), req({ id: 'b', start: 4 }))).toBe(0)
    const shape = sessionShape(
      [req({ id: 'a', start: 10 }), req({ id: 'b', start: 4, end: 6 })],
      groupByThread([req({ id: 'a', start: 10 }), req({ id: 'b', start: 4, end: 6 })]),
    )
    // A clamped gap is zero, so it lands in the under-5m band.
    expect(shape).toEqual({
      requestCount: 2,
      spanMs: 9_000,
      largestGapMs: 0,
      gapsIn5mTo1hBand: 0,
      gapsUnder5m: 1,
      gapsOver1h: 0,
    })
  })
})

describe('per-request pricing modifiers survive the replay', () => {
  it('fast-mode and batch requests are repriced with their own multipliers', () => {
    // Opus 5 fast: base 10×$10 = 0.0001; 1h write 1000×$20 = 0.02; out 5×$50 = 0.00025 → 0.02035
    // 5m scenario: write 1000×$12.50 = 0.0125 → 0.01285
    const bucket = analyzeBucket(
      'main',
      [req({ id: 'r1', start: 0, w1h: 1000, speed: 'fast' })],
      PRICING,
    )
    close(bucket.actualCost.totalUsd, 0.02035)
    close(bucket.scenarios.fiveMinute.cost.totalUsd, 0.01285)
  })

  it('batch requests keep their half-price tier in both scenarios', () => {
    // Opus 5 batch: base 10×$2.50 = 0.000025; 1h write 1000×$5 = 0.005; out 5×$12.50 = 0.0000625 → 0.0050875
    // 5m scenario: write 1000×$3.125 = 0.003125 → 0.0032125
    const bucket = analyzeBucket(
      'main',
      [req({ id: 'r1', start: 0, w1h: 1000, tier: 'batch' })],
      PRICING,
    )
    close(bucket.actualCost.totalUsd, 0.0050875)
    expect(bucket.scenarios.oneHour.cost).toEqual(bucket.actualCost)
    close(bucket.scenarios.fiveMinute.cost.totalUsd, 0.0032125)
  })
})

describe('analyzeSession plumbing', () => {
  it('passes parser output through and stamps pricing metadata', () => {
    const parsed = session([req({ id: 'r1', start: 0, w1h: 1000 })])
    parsed.warnings = [{ kind: 'malformed-lines', count: 2 }]
    const result = analyzeSession(parsed, PRICING)
    expect(result.metadata).toBe(parsed.metadata)
    expect(result.parseStats).toBe(parsed.stats)
    expect(result.parseWarnings).toBe(parsed.warnings)
    expect(result.pricesAsOf).toBe(PRICING.pricesAsOf)
    expect(result.approximation).toEqual({ allOrNothingExpiry: true, conservativeToward: '5m' })
  })
})

describe('real corpus reconciliation (PLAN §5)', () => {
  it('replaying transcripts/004-build-plan at its observed TTL reproduces the actual cost', async () => {
    const path = 'transcripts/004-build-plan/session.jsonl'
    const parsed = await parseSession(
      Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>,
      { fileName: 'session.jsonl', fileSizeBytes: readFileSync(path).byteLength },
    )
    const result = analyzeSession(parsed, PRICING)
    expect(result.buckets).toHaveLength(1)
    const main = result.buckets[0]
    expect(main.observedTtl).toBe('1h')
    expect(main.requestCount).toBe(79)
    expect(main.scenarios.oneHour.cost).toEqual(main.actualCost)
    expect(main.actualCost.totalUsd).toBeGreaterThan(0)
    expect(main.scenarios.oneHour.hardResets).toBe(0)
    expect(main.scenarios.oneHour.cacheExpiries).toBe(0)
    expect(result.unknownModels.excludedRequests).toBe(0)
    expect(main.verdictSuppressed).toBe(false)
    expect(['5m', '1h']).toContain(main.recommendation)
    // Every event carries a request start from the corpus.
    for (const event of main.scenarios.fiveMinute.events) {
      expect(Number.isFinite(Date.parse(event.timestamp))).toBe(true)
    }
    // 5m can only add expiries where gaps exceed 5m; the count matches the shape.
    const over5m = main.scenarios.fiveMinute.events.filter((e) => e.kind === 'expiry')
    for (const e of over5m) expect(e.kind === 'expiry' && e.gapMs).toBeGreaterThan(CACHE_TTL_5M_MS)
  })
})
