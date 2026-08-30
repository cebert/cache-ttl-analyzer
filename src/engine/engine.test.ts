/**
 * WP-05: the real engine end-to-end — stream in, analysis or rejection
 * out — including through the worker protocol handler.
 */

import { describe, expect, it } from 'vitest'
import { PRICING } from '../config/pricing'
import { createAnalysisWorkerHandler, type WorkerFileInput } from '../worker/handler'
import type { EngineProgress } from './contract'
import { createEngine } from './engine'
import type { AnalysisWorkerResponse } from './protocol'

const SESSION = [
  '{"type":"user","uuid":"u0","parentUuid":null,"timestamp":"2026-08-30T12:00:00.000Z","sessionId":"s1","cwd":"/p","gitBranch":"main"}',
  '{"type":"assistant","uuid":"a0","parentUuid":"u0","timestamp":"2026-08-30T12:00:03.000Z","version":"2.1.251","effort":"high","message":{"id":"msg_0","model":"claude-opus-5","content":"secret","usage":{"input_tokens":10,"cache_creation_input_tokens":1000,"cache_read_input_tokens":0,"output_tokens":5,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":1000}}}}',
  '{"type":"user","uuid":"u1","parentUuid":"a0","timestamp":"2026-08-30T12:10:00.000Z"}',
  '{"type":"assistant","uuid":"a1","parentUuid":"u1","timestamp":"2026-08-30T12:10:04.000Z","version":"2.1.251","effort":"high","message":{"id":"msg_1","model":"claude-opus-5","content":"secret","usage":{"input_tokens":10,"cache_creation_input_tokens":200,"cache_read_input_tokens":1000,"output_tokens":5,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":200}}}}',
  '{"type":"pr-link","prNumber":1}',
].join('\n')

function fileOf(text: string, name = 'session.jsonl'): WorkerFileInput {
  const bytes = new TextEncoder().encode(text)
  return {
    name,
    size: bytes.byteLength,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          // Two chunks so the parser crosses a boundary.
          controller.enqueue(bytes.subarray(0, 100))
          controller.enqueue(bytes.subarray(100))
          controller.close()
        },
      }),
  }
}

async function analyze(text: string, signal = new AbortController().signal) {
  const file = fileOf(text)
  const progress: EngineProgress[] = []
  const outcome = await createEngine().analyze(
    { stream: file.stream(), fileName: file.name, fileSizeBytes: file.size, pricing: PRICING },
    { onProgress: (p) => progress.push(p), signal },
  )
  return { outcome, progress }
}

describe('createEngine', () => {
  it('produces an analysis for a session log, with parsing then analyzing progress', async () => {
    const { outcome, progress } = await analyze(SESSION)
    expect(outcome.kind).toBe('analysis')
    if (outcome.kind !== 'analysis') return
    const { result } = outcome
    expect(result.buckets[0]).toMatchObject({ bucket: 'main', requestCount: 2, observedTtl: '1h' })
    // Same numbers as the simulator's shortening case: $0.01285 actual, 1h wins by $0.00125.
    expect(result.buckets[0].actualCost.totalUsd).toBeCloseTo(0.01285, 10)
    expect(result.buckets[0].recommendation).toBe('1h')
    expect(result.buckets[0].savingsUsd).toBeCloseTo(0.00125, 10)
    expect(result.parseStats).toMatchObject({
      dedupedRequests: 2,
      skippedRecordTypes: { 'pr-link': 1 },
    })
    expect(result.parseWarnings).toEqual([
      { kind: 'skipped-record-types', types: { 'pr-link': 1 } },
    ])
    expect(result.metadata).toMatchObject({
      sessionId: 's1',
      cwd: '/p',
      gitBranch: 'main',
      fileName: 'session.jsonl',
    })
    expect(result.pricesAsOf).toBe(PRICING.pricesAsOf)
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(progress.map((p) => p.phase)).toEqual(['parsing', 'analyzing'])
    expect(progress.at(-1)).toMatchObject({
      requestsSeen: 2,
      bytesProcessed: progress[0].totalBytes,
    })
  })

  it('warns about unknown models by wiring the pricing config into the parser', async () => {
    const { outcome } = await analyze(SESSION.replaceAll('claude-opus-5', 'claude-mystery-9'))
    expect(outcome.kind).toBe('analysis')
    if (outcome.kind !== 'analysis') return
    expect(outcome.result.parseWarnings).toContainEqual({
      kind: 'unknown-models',
      models: ['claude-mystery-9'],
    })
    expect(outcome.result.buckets[0]).toMatchObject({
      recommendation: 'no-verdict',
      verdictSuppressed: true,
    })
    expect(outcome.result.unknownModels).toMatchObject({
      models: ['claude-mystery-9'],
      excludedRequests: 2,
    })
  })

  it('rejects a file that is not a session log, with stats and a reason', async () => {
    const { outcome } = await analyze('{"type":"user"}\n{"type":"mode"}\n')
    expect(outcome).toMatchObject({
      kind: 'rejected',
      verdict: 'not-a-session-log',
      reason: 'no-assistant-usage-rows',
      stats: { totalLines: 2, dedupedRequests: 0 },
    })
  })

  it('rejects a mostly-malformed file with the ratio reason', async () => {
    const lines = [SESSION, ...Array<string>(10).fill('{garbage')].join('\n')
    const { outcome } = await analyze(lines)
    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'malformed-lines-exceed-threshold' })
  })

  it('throws AbortError when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(analyze(SESSION, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('runs through the worker protocol handler', async () => {
    const messages: AnalysisWorkerResponse[] = []
    const done = new Promise<void>((resolve) => {
      const handler = createAnalysisWorkerHandler(createEngine(), (message) => {
        messages.push(message)
        if (message.type === 'result' || message.type === 'rejected' || message.type === 'error')
          resolve()
      })
      handler.onMessage({
        type: 'start',
        file: fileOf(SESSION) as unknown as File,
        pricing: PRICING,
        logLevel: 'silent',
      })
    })
    await done
    const types = messages.map((m) => m.type)
    expect(types.at(-1)).toBe('result')
    expect(types.filter((t) => t === 'progress').length).toBeGreaterThanOrEqual(2)
    const result = messages.find((m) => m.type === 'result')
    expect(result?.type === 'result' && result.result.buckets[0].requestCount).toBe(2)
  })
})
