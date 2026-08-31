/**
 * WP-08 derivations. The interesting ones (segments, markers, resets) are
 * about real session shapes, so they run against the WP-06 captures through
 * the real parser and simulator; the arithmetic ones are hand-computed on
 * synthetic buckets.
 */

import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'

import { PRICING } from '../../config/pricing'
import type { AnalysisResult, BucketAnalysis, ParseStats } from '../../engine/contract'
import { knownModelIds } from '../../engine/cost'
import { parseSession } from '../../engine/parser'
import { analyzeSession } from '../../engine/simulator'
import {
  cacheHitRate,
  configSegments,
  errorRate,
  mainBucket,
  observedScenario,
  orderedResets,
  resetPositions,
  resetWastedTokens,
  subagentBucket,
  timelineMarkers,
  timelineWindow,
  writesAreUniform,
} from './results-model'

async function analyzeFixture(path: string): Promise<AnalysisResult> {
  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>
  const parsed = await parseSession(stream, {
    fileName: path.split('/').pop() ?? path,
    fileSizeBytes: 0,
    knownModels: knownModelIds(PRICING),
  })
  return analyzeSession(parsed, PRICING)
}

const FIXTURES = {
  modelSwitch: 'fixtures/captured/scenarios/model-switch/session.jsonl',
  gapHeavy5m: 'fixtures/captured/scenarios/gap-heavy-5m/session.jsonl',
  tightLoop: 'fixtures/captured/scenarios/tight-loop-5m/session.jsonl',
  subagent: 'fixtures/captured/parallel-subagents/subagents/agent-a01d87944318de984.jsonl',
  legacySidechains: 'fixtures/synthetic/legacy-interleaved-sidechains.jsonl',
  unknownModel: 'fixtures/synthetic/unknown-model-major.jsonl',
} as const

const stats = (overrides: Partial<ParseStats>): ParseStats => ({
  totalLines: 0,
  nonEmptyLines: 0,
  malformedLines: 0,
  skippedRecordTypes: {},
  assistantRows: 0,
  dedupedRequests: 0,
  syntheticRowsExcluded: 0,
  invalidUsageRowsSkipped: 0,
  ...overrides,
})

function bucketWith(overrides: Partial<BucketAnalysis>): BucketAnalysis {
  return {
    bucket: 'main',
    threadCount: 1,
    requestCount: 1,
    actualCost: {
      baseInputUsd: 0,
      cacheReadUsd: 0,
      cacheWrite5mUsd: 0,
      cacheWrite1hUsd: 0,
      outputUsd: 0,
      totalUsd: 0,
    },
    observedWriteSplit: { fiveMinuteWriteTokens: 0, oneHourWriteTokens: 0 },
    observedTtl: null,
    configExplicitness: 'unknown',
    scenarios: {
      fiveMinute: {
        ttl: '5m',
        cost: {
          baseInputUsd: 0,
          cacheReadUsd: 0,
          cacheWrite5mUsd: 0,
          cacheWrite1hUsd: 0,
          outputUsd: 0,
          totalUsd: 0,
        },
        events: [],
        cacheExpiries: 0,
        hardResets: 0,
        warmReadRequests: 0,
        wastedWriteTokens: 0,
      },
      oneHour: {
        ttl: '1h',
        cost: {
          baseInputUsd: 0,
          cacheReadUsd: 0,
          cacheWrite5mUsd: 0,
          cacheWrite1hUsd: 0,
          outputUsd: 0,
          totalUsd: 0,
        },
        events: [],
        cacheExpiries: 0,
        hardResets: 0,
        warmReadRequests: 0,
        wastedWriteTokens: 0,
      },
    },
    recommendation: 'no-verdict',
    savingsUsd: 0,
    verdictSuppressed: false,
    unpricedTokenShare: 0,
    shape: {
      requestCount: 1,
      spanMs: 0,
      largestGapMs: 0,
      gapsIn5mTo1hBand: 0,
      gapsUnder5m: 0,
      gapsOver1h: 0,
    },
    tokenTotals: {
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    },
    ...overrides,
  }
}

describe('headline metrics', () => {
  it('rates reads against every input-side token, output excluded', () => {
    // 800 read of (100 input + 800 read + 100 write) = 800/1000.
    const bucket = bucketWith({
      tokenTotals: {
        inputTokens: 100,
        cacheReadTokens: 800,
        cacheWriteTokens: 100,
        outputTokens: 50_000,
      },
    })
    expect(cacheHitRate(bucket)).toBe(0.8)
  })

  it('has no hit rate when the bucket used no input-side tokens', () => {
    expect(cacheHitRate(bucketWith({}))).toBeNull()
  })

  it('rates synthetic rows against the requests that did bill', () => {
    // 2 failed of 48 priced + 2 = 4%.
    expect(errorRate(stats({ dedupedRequests: 48, syntheticRowsExcluded: 2 }))).toBe(0.04)
    expect(errorRate(stats({ dedupedRequests: 0, syntheticRowsExcluded: 0 }))).toBeNull()
  })

  it('calls writes uniform only when one TTL carried all of them', () => {
    expect(
      writesAreUniform(
        bucketWith({ observedWriteSplit: { fiveMinuteWriteTokens: 0, oneHourWriteTokens: 900 } }),
      ),
    ).toBe(true)
    expect(
      writesAreUniform(
        bucketWith({ observedWriteSplit: { fiveMinuteWriteTokens: 12, oneHourWriteTokens: 900 } }),
      ),
    ).toBe(false)
  })
})

describe('configuration segments', () => {
  it('reads the starting model off the first change, not the metadata order', async () => {
    // `model-switch`: Opus 5, then /model to Sonnet 5, then effort high →
    // medium. Three segments, and the first is what the reset says it left.
    const result = await analyzeFixture(FIXTURES.modelSwitch)
    const main = mainBucket(result)!
    const segments = configSegments(result, main)

    expect(segments).toHaveLength(3)
    expect(segments[0].model).toBe(result.metadata.models[0])
    expect(segments[0].effort).toBe('high')
    expect(segments[1].model).toBe(segments[2].model)
    expect(segments[1].model).not.toBe(segments[0].model)
    expect(segments[1].effort).toBe('high')
    expect(segments[2].effort).toBe('medium')
    // They tile the whole span, in order, without gaps.
    expect(segments[0].start).toBe(0)
    expect(segments.at(-1)!.end).toBe(1)
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].start).toBe(segments[i - 1].end)
    }
  })

  it('is one segment for a session that never changed anything', async () => {
    const result = await analyzeFixture(FIXTURES.tightLoop)
    const segments = configSegments(result, mainBucket(result)!)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ start: 0, end: 1, model: result.metadata.models[0] })
  })

  it('is empty when the bucket has no events to span', () => {
    const result = { metadata: { models: [], efforts: [] } } as unknown as AnalysisResult
    expect(configSegments(result, bucketWith({}))).toEqual([])
  })
})

describe('resets', () => {
  it('numbers each reset by the request it happened on, in time order', async () => {
    const result = await analyzeFixture(FIXTURES.modelSwitch)
    const main = mainBucket(result)!
    const resets = orderedResets(main)

    expect(resets.map((r) => r.cause)).toEqual(['model-change', 'effort-change'])
    expect(resets[0].requestNumber).toBeGreaterThan(0)
    expect(resets[1].requestNumber).toBeGreaterThan(resets[0].requestNumber)
    expect(resets[1].requestNumber).toBeLessThanOrEqual(main.requestCount)
    expect(Date.parse(resets[1].timestamp)).toBeGreaterThan(Date.parse(resets[0].timestamp))
    // One rule per reset on the rail, both inside the span.
    for (const position of resetPositions(main)) {
      expect(position).toBeGreaterThan(0)
      expect(position).toBeLessThan(1)
    }
  })

  it('reports rewritten tokens only when a reset actually happened', async () => {
    // model-switch resets twice and expires never, so the whole waste figure
    // is reset-driven and the claim "the same under either TTL" holds.
    const withResets = await analyzeFixture(FIXTURES.modelSwitch)
    const main = mainBucket(withResets)!
    expect(observedScenario(main).cacheExpiries).toBe(0)
    expect(resetWastedTokens(main)).toBeGreaterThan(0)

    const without = await analyzeFixture(FIXTURES.tightLoop)
    expect(orderedResets(mainBucket(without)!)).toEqual([])
    expect(resetWastedTokens(mainBucket(without)!)).toBeNull()
  })

  it('makes no reset-waste claim it cannot separate from expiry waste', async () => {
    // `wastedWriteTokens` sums both causes and the contract does not split
    // them, so a bucket that also expired gets no figure rather than a
    // wrong one.
    const gapHeavy = await analyzeFixture(FIXTURES.gapHeavy5m)
    const bucket = mainBucket(gapHeavy)!
    expect(observedScenario(bucket).cacheExpiries).toBeGreaterThan(0)
    expect(resetWastedTokens(bucket)).toBeNull()
  })
})

describe('timeline', () => {
  it('marks every request once, in time order, inside the window', async () => {
    const result = await analyzeFixture(FIXTURES.gapHeavy5m)
    const main = mainBucket(result)!
    const markers = timelineMarkers(main)

    expect(markers).toHaveLength(main.requestCount)
    expect(new Set(markers.map((m) => m.messageId)).size).toBe(markers.length)
    for (const marker of markers) {
      expect(marker.position).toBeGreaterThanOrEqual(0)
      expect(marker.position).toBeLessThanOrEqual(1)
    }
    for (let i = 1; i < markers.length; i++) {
      expect(markers[i].position).toBeGreaterThanOrEqual(markers[i - 1].position)
    }
  })

  it('shows what the log did, so a partial lapse reads as an expiry', async () => {
    // gap-heavy-5m has three expiries at its observed 5m TTL, two of them
    // partial — the request read *and* re-wrote. The marker is the expiry.
    const result = await analyzeFixture(FIXTURES.gapHeavy5m)
    const main = mainBucket(result)!
    const observed = observedScenario(main)

    expect(main.observedTtl).toBe('5m')
    expect(observed.ttl).toBe('5m')
    expect(observed.cacheExpiries).toBe(3)
    expect(timelineMarkers(main).filter((m) => m.kind === 'expiry')).toHaveLength(3)
    const partial = observed.events.filter((e) => e.kind === 'expiry').at(-1)!
    expect(
      observed.events.some((e) => e.kind === 'warm-read' && e.messageId === partial.messageId),
    ).toBe(true)
  })

  it('has no window for a bucket with no events', () => {
    expect(timelineWindow(bucketWith({}))).toBeNull()
    expect(timelineMarkers(bucketWith({}))).toEqual([])
    expect(resetPositions(bucketWith({}))).toEqual([])
  })
})

describe('bucket selection', () => {
  it('offers no subagent bucket for a modern main-session upload (F2)', async () => {
    const result = await analyzeFixture(FIXTURES.gapHeavy5m)
    expect(mainBucket(result)).not.toBeNull()
    expect(subagentBucket(result)).toBeNull()
  })

  it('offers one when the log actually carries sidechain traffic', async () => {
    const legacy = await analyzeFixture(FIXTURES.legacySidechains)
    expect(subagentBucket(legacy)?.requestCount).toBeGreaterThan(0)

    // A subagent transcript uploaded on its own is all sidechain: the main
    // bucket is the empty one.
    const transcript = await analyzeFixture(FIXTURES.subagent)
    expect(subagentBucket(transcript)?.requestCount).toBeGreaterThan(0)
    expect(mainBucket(transcript)?.requestCount).toBe(0)
  })
})
