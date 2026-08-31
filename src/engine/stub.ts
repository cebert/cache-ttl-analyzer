/**
 * WP-02 acceptance stub: an `AnalysisEngine` returning canned data through
 * the full worker protocol. Replaced by the real engine in WP-03/04/05.
 * Numbers are loosely modeled on the feasibility doc's gap-heavy session
 * where 1h won; they are NOT real analysis output.
 */

import type {
  AnalysisEngine,
  AnalysisResult,
  CostBreakdown,
  EngineOutcome,
  ParseStats,
} from './contract'

function cost(parts: Omit<CostBreakdown, 'totalUsd'>): CostBreakdown {
  return {
    ...parts,
    totalUsd:
      parts.baseInputUsd +
      parts.cacheReadUsd +
      parts.cacheWrite5mUsd +
      parts.cacheWrite1hUsd +
      parts.outputUsd,
  }
}

const STUB_STATS: ParseStats = {
  totalLines: 715,
  nonEmptyLines: 715,
  malformedLines: 0,
  skippedRecordTypes: { 'frame-link': 25, 'pr-link': 8 },
  assistantRows: 201,
  dedupedRequests: 50,
  syntheticRowsExcluded: 0,
  invalidUsageRowsSkipped: 0,
}

export function makeStubResult(
  fileName: string,
  fileSizeBytes: number,
  pricesAsOf: string,
): AnalysisResult {
  return {
    metadata: {
      sessionId: '00000000-0000-4000-8000-000000stub00',
      title: 'Stub session (canned data)',
      cwd: '/home/user/example-project',
      gitBranch: 'main',
      models: ['claude-opus-5'],
      versions: ['2.1.251'],
      efforts: ['high'],
      firstTimestamp: '2026-08-30T12:00:00.000Z',
      lastTimestamp: '2026-08-30T13:20:12.000Z',
      fileName,
      fileSizeBytes,
    },
    parseStats: STUB_STATS,
    parseWarnings: [{ kind: 'skipped-record-types', types: STUB_STATS.skippedRecordTypes }],
    buckets: [
      {
        bucket: 'main',
        threadCount: 1,
        requestCount: 50,
        actualCost: cost({
          baseInputUsd: 0.02,
          cacheReadUsd: 1.1,
          cacheWrite5mUsd: 0,
          cacheWrite1hUsd: 2.51,
          outputUsd: 1.2,
        }),
        actualUsage: {
          inputTokens: 38_000,
          cacheReadTokens: 2_410_000,
          cacheWriteTokens: 251_000,
          outputTokens: 96_000,
        },
        warmReadRequestCount: 38,
        observedWriteSplit: { fiveMinuteWriteTokens: 0, oneHourWriteTokens: 251_000 },
        observedTtl: '1h',
        configExplicitness: 'ambiguous',
        scenarios: {
          fiveMinute: {
            ttl: '5m',
            cost: cost({
              baseInputUsd: 0.02,
              cacheReadUsd: 0.9,
              cacheWrite5mUsd: 4.85,
              cacheWrite1hUsd: 0,
              outputUsd: 1.2,
            }),
            events: [
              {
                kind: 'cache-write',
                ttl: '5m',
                tokens: 38_000,
                expiryClass: 'user-controlled',
                timestamp: '2026-08-30T12:00:00.000Z',
                threadId: 'main',
                messageId: 'msg_stub_001',
              },
              {
                kind: 'expiry',
                gapMs: 11 * 60_000,
                expiryClass: 'user-controlled',
                rewrittenTokens: 38_000,
                timestamp: '2026-08-30T12:11:00.000Z',
                threadId: 'main',
                messageId: 'msg_stub_002',
              },
            ],
            cacheExpiries: 6,
            hardResets: 0,
            warmReadRequests: 43,
            wastedWriteTokens: 228_000,
          },
          oneHour: {
            ttl: '1h',
            cost: cost({
              baseInputUsd: 0.02,
              cacheReadUsd: 1.1,
              cacheWrite5mUsd: 0,
              cacheWrite1hUsd: 2.51,
              outputUsd: 1.2,
            }),
            events: [
              {
                kind: 'warm-read',
                tokens: 37_044,
                timestamp: '2026-08-30T12:11:00.000Z',
                threadId: 'main',
                messageId: 'msg_stub_002',
              },
            ],
            cacheExpiries: 0,
            hardResets: 0,
            warmReadRequests: 49,
            wastedWriteTokens: 0,
          },
        },
        recommendation: '1h',
        savingsUsd: 2.14,
        verdictSuppressed: false,
        unpricedTokenShare: 0,
        shape: {
          requestCount: 50,
          spanMs: 80.2 * 60_000,
          largestGapMs: 14 * 60_000,
          gapsIn5mTo1hBand: 6,
          gapsUnder5m: 42,
          gapsOver1h: 1,
        },
      },
    ],
    unknownModels: { models: [], excludedRequests: 0, excludedTotalTokens: 0 },
    pricesAsOf,
    approximation: { allOrNothingExpiry: true, conservativeToward: '5m' },
  }
}

/** Fake progress ticks so the UI's progress plumbing is exercised. */
const STUB_PROGRESS_TICKS = 4

export function createStubEngine(): AnalysisEngine {
  return {
    async analyze(input, { onProgress, signal }) {
      for (let i = 1; i <= STUB_PROGRESS_TICKS; i++) {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        onProgress({
          phase: i < STUB_PROGRESS_TICKS ? 'parsing' : 'analyzing',
          bytesProcessed: Math.round((input.fileSizeBytes * i) / STUB_PROGRESS_TICKS),
          totalBytes: input.fileSizeBytes,
          requestsSeen: i * 12,
        })
        // Yield so a cancel message can be observed between ticks.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      const outcome: EngineOutcome = {
        kind: 'analysis',
        result: makeStubResult(input.fileName, input.fileSizeBytes, input.pricing.pricesAsOf),
      }
      return outcome
    },
  }
}
