import { describe, expect, it } from 'vitest'
import { MAX_LINE_LENGTH_BYTES } from './contract'
import { JsonlLineSplitter, readJsonlLines, type LineEvent } from './jsonl-stream'

const encoder = new TextEncoder()

function collect(splitter: JsonlLineSplitter, chunks: (string | Uint8Array)[]): LineEvent[] {
  const events: LineEvent[] = []
  for (const chunk of chunks) {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
    events.push(...splitter.push(bytes))
  }
  events.push(...splitter.finish())
  return events
}

function texts(events: LineEvent[]): string[] {
  return events.map((e) => (e.kind === 'line' ? e.text : `<capped ${e.bytes}>`))
}

/** A stream of `count` chunks, each produced lazily by `make`. */
function chunkStream(count: number, make: (i: number) => Uint8Array): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= count) {
        controller.close()
        return
      }
      controller.enqueue(make(i++))
    },
  })
}

describe('JsonlLineSplitter', () => {
  it('splits on \\n and yields the final unterminated line', () => {
    expect(texts(collect(new JsonlLineSplitter(), ['a\nb\nc']))).toEqual(['a', 'b', 'c'])
  })

  it('does not emit a phantom line after a trailing newline', () => {
    expect(texts(collect(new JsonlLineSplitter(), ['a\nb\n']))).toEqual(['a', 'b'])
    expect(texts(collect(new JsonlLineSplitter(), ['']))).toEqual([])
  })

  it('strips \\r from CRLF line endings but keeps interior \\r', () => {
    expect(texts(collect(new JsonlLineSplitter(), ['a\r\nb\rc\r\n']))).toEqual(['a', 'b\rc'])
  })

  it('preserves empty lines so they can be counted', () => {
    expect(texts(collect(new JsonlLineSplitter(), ['a\n\n\nb\n']))).toEqual(['a', '', '', 'b'])
  })

  it('reassembles lines and multi-byte characters split across chunks', () => {
    const line = '{"cwd":"/tmp/résumé — 日本語 🚀"}'
    const bytes = encoder.encode(line + '\n' + line)
    // Push one byte at a time: every UTF-8 sequence gets split.
    const chunks: Uint8Array[] = []
    for (let i = 0; i < bytes.length; i++) chunks.push(bytes.subarray(i, i + 1))
    expect(texts(collect(new JsonlLineSplitter(), chunks))).toEqual([line, line])
  })

  it('strips a leading BOM on the first line only', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf])
    const events = collect(new JsonlLineSplitter(), [bom, '{"a":1}\n', bom, '{"b":2}'])
    expect(texts(events)).toEqual(['{"a":1}', '\uFEFF{"b":2}'])
  })

  it('copies chunk bytes so a reused input buffer cannot corrupt pending lines', () => {
    const splitter = new JsonlLineSplitter()
    const buffer = encoder.encode('abc')
    const events = splitter.push(buffer)
    buffer.fill(0x78) // 'x'
    expect(
      texts([...events, ...splitter.push(encoder.encode('\n')), ...splitter.finish()]),
    ).toEqual(['abc'])
  })

  describe('line-length cap', () => {
    it('drops a line that exceeds the cap and reports its size', () => {
      const splitter = new JsonlLineSplitter(8)
      const events = collect(splitter, ['short\n', '123456789\n', 'ok'])
      expect(events).toEqual([
        { kind: 'line', text: 'short' },
        { kind: 'capped', bytes: 9 },
        { kind: 'line', text: 'ok' },
      ])
    })

    it('accepts a line exactly at the cap', () => {
      const events = collect(new JsonlLineSplitter(8), ['12345678\n'])
      expect(events).toEqual([{ kind: 'line', text: '12345678' }])
    })

    it('reports a capped final line with no trailing newline', () => {
      const events = collect(new JsonlLineSplitter(4), ['abcdefgh'])
      expect(events).toEqual([{ kind: 'capped', bytes: 8 }])
    })

    it('never buffers more than the cap while an over-cap line streams past', () => {
      const cap = 16
      const splitter = new JsonlLineSplitter(cap)
      const chunks = Array.from({ length: 100 }, () => 'x'.repeat(5))
      const events = collect(splitter, [...chunks, '\nnext'])
      expect(events).toEqual([
        { kind: 'capped', bytes: 500 },
        { kind: 'line', text: 'next' },
      ])
      expect(splitter.peakPendingBytes).toBeLessThanOrEqual(cap)
    })

    it('handles a single multi-hundred-MB line without holding it in memory', async () => {
      // 300MB of a single line with no newline, streamed in 1MB chunks that
      // are generated lazily — the test itself never materializes the line.
      const chunkBytes = 1024 * 1024
      const chunkCount = 300
      const chunk = new Uint8Array(chunkBytes).fill(0x61)
      const splitter = new JsonlLineSplitter()
      const events: LineEvent[] = []
      let bytes = 0
      await readJsonlLines(
        chunkStream(chunkCount, () => chunk),
        (e) => events.push(e),
        { splitter, onChunk: (b) => (bytes = b) },
      )
      expect(bytes).toBe(chunkBytes * chunkCount)
      expect(events).toEqual([{ kind: 'capped', bytes: chunkBytes * chunkCount }])
      expect(splitter.peakPendingBytes).toBeLessThanOrEqual(MAX_LINE_LENGTH_BYTES)
    }, 30_000)
  })
})

describe('readJsonlLines', () => {
  it('drives a splitter from a ReadableStream and reports byte progress', async () => {
    const seen: string[] = []
    const progress: number[] = []
    await readJsonlLines(
      chunkStream(3, (i) => encoder.encode(`{"i":${i}}\n`)),
      (e) => seen.push(e.kind === 'line' ? e.text : 'capped'),
      { onChunk: (b) => progress.push(b) },
    )
    expect(seen).toEqual(['{"i":0}', '{"i":1}', '{"i":2}'])
    expect(progress).toEqual([8, 16, 24])
  })

  it('rejects with AbortError when the signal aborts mid-stream, cancelling the source', async () => {
    const controller = new AbortController()
    let pulled = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++
        if (pulled === 2) controller.abort()
        c.enqueue(encoder.encode('{"a":1}\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    await expect(
      readJsonlLines(stream, () => {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(pulled).toBeLessThan(5)
    expect(cancelled).toBe(true)
  })

  it('cancels the source when the line callback throws', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(encoder.encode('{"a":1}\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    await expect(
      readJsonlLines(stream, () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(cancelled).toBe(true)
  })
})
