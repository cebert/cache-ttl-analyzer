/**
 * WP-02 acceptance: the stub engine satisfies the frozen contract
 * end-to-end through the worker protocol — start -> progress* -> result,
 * plus cooperative cancellation.
 */

import { describe, expect, it } from 'vitest'
import { UNKNOWN_MODEL_SUPPRESSION_RATIO, MALFORMED_LINE_REJECT_RATIO } from '../engine/contract'
import type { AnalysisWorkerResponse } from '../engine/protocol'
import type { PricingConfig } from '../engine/pricing'
import { createStubEngine } from '../engine/stub'
import { createAnalysisWorkerHandler, type WorkerFileInput } from './handler'

const pricing: PricingConfig = {
  pricesAsOf: '2026-08-30',
  source: 'https://platform.claude.com/docs/en/about-claude/pricing',
  cacheMultipliers: { read: 0.1, write5m: 1.25, write1h: 2.0 },
  models: {
    'claude-opus-5': {
      displayName: 'Claude Opus 5',
      inputPerMTok: 5,
      outputPerMTok: 25,
      serviceTierMultipliers: { standard: 1, batch: 0.5 },
      speedMultipliers: { standard: 1, fast: 2 },
    },
  },
}

function fakeFile(): WorkerFileInput {
  const bytes = new TextEncoder().encode('{"type":"assistant"}\n')
  return {
    name: 'session.jsonl',
    size: bytes.byteLength,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      }),
  }
}

function collect() {
  const messages: AnalysisWorkerResponse[] = []
  let settle: (() => void) | null = null
  const done = new Promise<void>((resolve) => {
    settle = resolve
  })
  const post = (m: AnalysisWorkerResponse) => {
    messages.push(m)
    if (m.type !== 'progress' && m.type !== 'log') settle?.()
  }
  return { messages, done, post }
}

describe('analysis worker protocol with the stub engine', () => {
  it('start produces progress messages then a contract-shaped result', async () => {
    const { messages, done, post } = collect()
    const handler = createAnalysisWorkerHandler(createStubEngine(), post)
    const file = fakeFile()
    handler.onMessage({ type: 'start', file: file as unknown as File, pricing, logLevel: 'silent' })
    await done

    const progress = messages.filter((m) => m.type === 'progress')
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.at(-1)).toMatchObject({
      progress: { totalBytes: file.size, bytesProcessed: file.size },
    })

    const terminal = messages.at(-1)
    expect(terminal?.type).toBe('result')
    if (terminal?.type !== 'result') return
    const { result } = terminal

    // Contract invariants the stub must satisfy end-to-end.
    expect(result.metadata.fileName).toBe('session.jsonl')
    expect(result.metadata.fileSizeBytes).toBe(file.size)
    expect(result.pricesAsOf).toBe('2026-08-30')
    expect(result.approximation).toEqual({ allOrNothingExpiry: true, conservativeToward: '5m' })
    expect(result.buckets.map((b) => b.bucket)).toContain('main')
    for (const bucket of result.buckets) {
      expect(bucket.scenarios.fiveMinute.ttl).toBe('5m')
      expect(bucket.scenarios.oneHour.ttl).toBe('1h')
      const { cost } = bucket.scenarios.oneHour
      expect(cost.totalUsd).toBeCloseTo(
        cost.baseInputUsd +
          cost.cacheReadUsd +
          cost.cacheWrite5mUsd +
          cost.cacheWrite1hUsd +
          cost.outputUsd,
        10,
      )
      expect(bucket.unpricedTokenShare).toBeLessThanOrEqual(UNKNOWN_MODEL_SUPPRESSION_RATIO)
      expect(['5m', '1h', 'no-verdict']).toContain(bucket.recommendation)
    }
  })

  it('cancel aborts the run and yields a cancelled message, not a result', async () => {
    const { messages, done, post } = collect()
    const handler = createAnalysisWorkerHandler(createStubEngine(), post)
    handler.onMessage({
      type: 'start',
      file: fakeFile() as unknown as File,
      pricing,
      logLevel: 'silent',
    })
    handler.onMessage({ type: 'cancel' })
    await done
    expect(messages.at(-1)?.type).toBe('cancelled')
    expect(messages.some((m) => m.type === 'result')).toBe(false)
  })

  it('policy constants are the named values frozen in the plan', () => {
    expect(MALFORMED_LINE_REJECT_RATIO).toBe(0.1)
    expect(UNKNOWN_MODEL_SUPPRESSION_RATIO).toBe(0.1)
  })
})
