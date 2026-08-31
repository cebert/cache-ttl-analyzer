import { describe, expect, it } from 'vitest'

import type {
  BucketAnalysis,
  InsightEvent,
  ParseStats,
  SessionMetadata,
} from '../../engine/contract'
import {
  barShare,
  cacheHitRate,
  configSegments,
  costComparison,
  errorRate,
  gapBands,
  positionInSpan,
  resetPoints,
  sessionSpan,
  shortModelName,
  timelineColumns,
  totalGaps,
  writeMix,
} from './derive'

const T0 = Date.parse('2026-08-30T12:00:00.000Z')
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString()

function metadata(over: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    models: ['claude-opus-5'],
    versions: ['2.1.251'],
    efforts: ['high'],
    firstTimestamp: at(0),
    lastTimestamp: at(100),
    fileName: 'session.jsonl',
    fileSizeBytes: 1000,
    ...over,
  }
}

/** Only the fields a given assertion reads; the rest never enters these. */
function bucket(over: Partial<BucketAnalysis>): BucketAnalysis {
  return { ...over } as BucketAnalysis
}

describe('cacheHitRate', () => {
  it('is reads over every input token the session paid for somehow', () => {
    expect(
      cacheHitRate({
        inputTokens: 100,
        cacheReadTokens: 800,
        cacheWriteTokens: 100,
        outputTokens: 9_999,
      }),
    ).toBe(0.8)
  })

  it('ignores output tokens, which are never served from cache', () => {
    const withOutput = cacheHitRate({
      inputTokens: 0,
      cacheReadTokens: 50,
      cacheWriteTokens: 50,
      outputTokens: 1_000_000,
    })
    expect(withOutput).toBe(0.5)
  })

  it('is zero rather than NaN for a session with no input at all', () => {
    expect(
      cacheHitRate({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }),
    ).toBe(0)
  })
})

describe('errorRate', () => {
  const stats = (over: Partial<ParseStats>) => ({ ...over }) as ParseStats

  it('measures failed requests against every request attempted', () => {
    expect(errorRate(stats({ dedupedRequests: 48, syntheticRowsExcluded: 2 }))).toEqual({
      rate: 0.04,
      failed: 2,
    })
  })

  it('is null when nothing failed, so the column can be dropped', () => {
    expect(errorRate(stats({ dedupedRequests: 50, syntheticRowsExcluded: 0 }))).toBeNull()
  })
})

describe('writeMix', () => {
  const mix = (fiveMinuteWriteTokens: number, oneHourWriteTokens: number) =>
    writeMix(bucket({ observedWriteSplit: { fiveMinuteWriteTokens, oneHourWriteTokens } }))

  it('names which TTLs the session actually wrote at', () => {
    expect(mix(0, 1000)).toBe('all-1h')
    expect(mix(1000, 0)).toBe('all-5m')
    expect(mix(400, 600)).toBe('mixed')
    expect(mix(0, 0)).toBe('none')
  })
})

describe('costComparison', () => {
  const compare = (five: number, one: number) =>
    costComparison(
      bucket({
        scenarios: {
          fiveMinute: { cost: { totalUsd: five } },
          oneHour: { cost: { totalUsd: one } },
        },
      } as unknown as Partial<BucketAnalysis>),
    )

  it('reports the cheaper scenario and how much cheaper it is', () => {
    const result = compare(6.97, 4.83)
    expect(result.cheaper).toBe('1h')
    expect(result.maxUsd).toBe(6.97)
    expect(result.savingsRatio).toBeCloseTo(0.307, 3)
  })

  it('has no cheaper side on an exact tie', () => {
    expect(compare(2, 2)).toMatchObject({ cheaper: null, savingsRatio: null })
  })

  it('does not divide by zero on a session that cost nothing', () => {
    expect(compare(0, 0)).toMatchObject({ maxUsd: 0, savingsRatio: null })
  })
})

describe('barShare', () => {
  it('is the value over the scale, clamped to 0-1', () => {
    expect(barShare(5, 10)).toBe(0.5)
    expect(barShare(20, 10)).toBe(1)
    expect(barShare(-5, 10)).toBe(0)
  })

  it('is zero rather than Infinity when there is no scale', () => {
    expect(barShare(5, 0)).toBe(0)
    expect(barShare(5, Number.NaN)).toBe(0)
  })
})

describe('sessionSpan', () => {
  it('is the interval between the first and last timestamps', () => {
    expect(sessionSpan(metadata())).toMatchObject({ durationMs: 100 * 60_000 })
  })

  it('is null when the log carried no usable timestamps', () => {
    expect(sessionSpan(metadata({ firstTimestamp: undefined }))).toBeNull()
    expect(sessionSpan(metadata({ lastTimestamp: 'not a date' }))).toBeNull()
  })

  it('is null for an instantaneous session, which has no timeline to draw', () => {
    expect(sessionSpan(metadata({ lastTimestamp: at(0) }))).toBeNull()
  })
})

describe('positionInSpan', () => {
  const span = sessionSpan(metadata())!

  it('places an instant as a fraction of the span', () => {
    expect(positionInSpan(span, at(25))).toBe(0.25)
  })

  it('clamps an instant outside the span rather than escaping the track', () => {
    expect(positionInSpan(span, at(-10))).toBe(0)
    expect(positionInSpan(span, at(300))).toBe(1)
  })

  it('is null for an unparseable timestamp', () => {
    expect(positionInSpan(span, 'whenever')).toBeNull()
  })
})

describe('timelineColumns', () => {
  const span = sessionSpan(metadata())!
  const event = (kind: 'warm-read' | 'expiry', minutes: number) =>
    ({ kind, timestamp: at(minutes), threadId: 'main', messageId: `m${minutes}` }) as InsightEvent

  it('buckets events into a fixed number of columns whatever the session size', () => {
    const columns = timelineColumns([event('warm-read', 0), event('expiry', 50)], span, 10)
    expect(columns).toHaveLength(10)
    expect(columns[0]).toEqual({ warmReads: 1, expiries: 0 })
    expect(columns[5]).toEqual({ warmReads: 0, expiries: 1 })
  })

  it('puts the final instant in the last column, not one past the end', () => {
    const columns = timelineColumns([event('warm-read', 100)], span, 10)
    expect(columns[9]).toEqual({ warmReads: 1, expiries: 0 })
  })

  it('ignores events that are neither reads nor expiries', () => {
    const write = {
      kind: 'cache-write',
      timestamp: at(10),
      threadId: 'main',
      messageId: 'w',
      ttl: '1h',
      tokens: 10,
      expiryClass: 'user-controlled',
    } as InsightEvent
    expect(timelineColumns([write], span, 10).every((c) => c.warmReads + c.expiries === 0)).toBe(
      true,
    )
  })
})

describe('resetPoints and configSegments', () => {
  const span = sessionSpan(metadata())!
  const reset = (minutes: number, cause: string, from: string, to: string) =>
    ({
      kind: 'hard-reset',
      cause,
      from,
      to,
      timestamp: at(minutes),
      threadId: 'main',
      messageId: `r${minutes}`,
    }) as InsightEvent

  it('places each reset along the span', () => {
    const points = resetPoints([reset(50, 'model-change', 'a', 'b')], span)
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ cause: 'model-change', from: 'a', to: 'b', position: 0.5 })
  })

  it('splits the session into runs of one model-and-effort setting', () => {
    const points = resetPoints(
      [
        reset(40, 'model-change', 'claude-opus-5', 'claude-sonnet-5'),
        reset(70, 'effort-change', 'high', 'medium'),
      ],
      span,
    )
    const segments = configSegments(metadata(), points)
    expect(segments.map(({ model, effort }) => ({ model, effort }))).toEqual([
      { model: 'claude-opus-5', effort: 'high' },
      { model: 'claude-sonnet-5', effort: 'high' },
      { model: 'claude-sonnet-5', effort: 'medium' },
    ])
    // Widths are differences of floats, so they are compared with a
    // tolerance; what has to hold exactly is that they cover the span.
    expect(segments.map((segment) => segment.width)).toEqual([
      expect.closeTo(0.4, 10),
      expect.closeTo(0.3, 10),
      expect.closeTo(0.3, 10),
    ])
    expect(segments.reduce((sum, segment) => sum + segment.width, 0)).toBeCloseTo(1, 10)
  })

  it('is one segment covering the whole span when nothing changed', () => {
    expect(configSegments(metadata(), [])).toEqual([
      { model: 'claude-opus-5', effort: 'high', width: 1 },
    ])
  })

  it('does not break a segment on a version change, which changes no label', () => {
    const points = resetPoints([reset(50, 'version-change', '2.1.250', '2.1.251')], span)
    expect(configSegments(metadata(), points)).toEqual([
      { model: 'claude-opus-5', effort: 'high', width: 1 },
    ])
  })

  it('draws nothing when the log named no model', () => {
    expect(configSegments(metadata({ models: [] }), [])).toEqual([])
  })

  it('omits effort when the log recorded none', () => {
    expect(configSegments(metadata({ efforts: [] }), [])).toEqual([
      { model: 'claude-opus-5', width: 1 },
    ])
  })
})

describe('gap bands', () => {
  const shaped = bucket({
    shape: {
      requestCount: 50,
      spanMs: 0,
      largestGapMs: 0,
      gapsUnder5m: 38,
      gapsIn5mTo1hBand: 11,
      gapsOver1h: 0,
    },
  })

  it('marks only the 5m-1h band as the one the setting turns on', () => {
    expect(
      gapBands(shaped)
        .filter((band) => band.decisive)
        .map((band) => band.id),
    ).toEqual(['band'])
  })

  it('totals every gap across the three bands', () => {
    expect(totalGaps(shaped)).toBe(49)
  })
})

describe('shortModelName', () => {
  it('drops the vendor prefix a column has no room for', () => {
    expect(shortModelName('claude-opus-5')).toBe('opus-5')
  })

  it('leaves an id it does not recognize exactly as the log wrote it', () => {
    expect(shortModelName('some-other-model')).toBe('some-other-model')
  })
})
