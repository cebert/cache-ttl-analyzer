/**
 * WP-03 — byte stream -> JSONL lines, with the per-line length cap.
 *
 * The parser must never hold the whole file (or one runaway line) in
 * memory (docs/PLAN.md §2, "Resource limits"). This splitter keeps only the
 * bytes of the line currently being assembled; once a line exceeds
 * `MAX_LINE_LENGTH_BYTES` its pending bytes are dropped and the rest of the
 * line is discarded as it streams past, so peak memory is bounded by the
 * cap plus one input chunk regardless of file or line size.
 *
 * Lines are split on `\n` (an ASCII byte, so splitting before UTF-8
 * decoding is safe); a trailing `\r` and a leading BOM are removed.
 */

import { MAX_LINE_LENGTH_BYTES } from './contract'

const NEWLINE = 0x0a
const CARRIAGE_RETURN = 0x0d

export type LineEvent =
  | { kind: 'line'; text: string }
  /** A line longer than the cap; its bytes were never assembled. */
  | { kind: 'capped'; bytes: number }

export class JsonlLineSplitter {
  private pending: Uint8Array[] = []
  private pendingBytes = 0
  /** True while skipping the remainder of an over-cap line. */
  private discarding = false
  private discardedBytes = 0
  /** `ignoreBOM: true` = keep a BOM as data; we strip it ourselves, once. */
  private readonly decoder = new TextDecoder('utf-8', { ignoreBOM: true })
  private sawFirstLine = false
  /** Diagnostics for the memory-bound tests: most bytes ever buffered. */
  peakPendingBytes = 0
  private readonly maxLineBytes: number

  constructor(maxLineBytes: number = MAX_LINE_LENGTH_BYTES) {
    this.maxLineBytes = maxLineBytes
  }

  /** Feed one chunk; returns the complete lines it terminated, in order. */
  push(chunk: Uint8Array): LineEvent[] {
    const events: LineEvent[] = []
    let start = 0
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] !== NEWLINE) continue
      this.append(chunk.subarray(start, i))
      events.push(this.flushLine())
      start = i + 1
    }
    if (start < chunk.length) this.append(chunk.subarray(start))
    return events
  }

  /** Signal end of input; returns the final unterminated line, if any. */
  finish(): LineEvent[] {
    if (this.discarding) return [this.flushLine()]
    if (this.pendingBytes === 0) return []
    return [this.flushLine()]
  }

  private append(segment: Uint8Array): void {
    if (segment.length === 0) return
    if (this.discarding) {
      this.discardedBytes += segment.length
      return
    }
    if (this.pendingBytes + segment.length > this.maxLineBytes) {
      // Over the cap: drop what we have and skip to the next newline.
      this.discardedBytes = this.pendingBytes + segment.length
      this.pending = []
      this.pendingBytes = 0
      this.discarding = true
      return
    }
    // Copy: the caller may reuse the chunk's backing buffer.
    this.pending.push(segment.slice())
    this.pendingBytes += segment.length
    if (this.pendingBytes > this.peakPendingBytes) this.peakPendingBytes = this.pendingBytes
  }

  private flushLine(): LineEvent {
    if (this.discarding) {
      const bytes = this.discardedBytes
      this.discarding = false
      this.discardedBytes = 0
      this.sawFirstLine = true
      return { kind: 'capped', bytes }
    }
    let bytes: Uint8Array
    if (this.pending.length === 1) {
      bytes = this.pending[0]
    } else {
      bytes = new Uint8Array(this.pendingBytes)
      let offset = 0
      for (const part of this.pending) {
        bytes.set(part, offset)
        offset += part.length
      }
    }
    this.pending = []
    this.pendingBytes = 0
    if (bytes.length > 0 && bytes[bytes.length - 1] === CARRIAGE_RETURN) {
      bytes = bytes.subarray(0, bytes.length - 1)
    }
    // Non-streaming decode: each line is complete, so multi-byte sequences
    // never straddle calls. A UTF-8 BOM is a file marker only on line one.
    if (
      !this.sawFirstLine &&
      bytes.length >= 3 &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf
    ) {
      bytes = bytes.subarray(3)
    }
    const text = this.decoder.decode(bytes)
    this.sawFirstLine = true
    return { kind: 'line', text }
  }
}

const abortError = () => new DOMException('aborted', 'AbortError')

/**
 * Drive a splitter from a `ReadableStream`, invoking `onLine` per event.
 * Honors `signal` even while a read is pending (a `read()` takes no signal
 * of its own, so each one is raced against the abort) and reports consumed
 * byte counts. On abort or a callback error the source is cancelled.
 */
export async function readJsonlLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (event: LineEvent) => void,
  options: {
    signal?: AbortSignal
    onChunk?: (bytesSoFar: number) => void
    splitter?: JsonlLineSplitter
  } = {},
): Promise<void> {
  const splitter = options.splitter ?? new JsonlLineSplitter()
  const { signal } = options
  if (signal?.aborted) throw abortError()
  let onAbort: (() => void) | undefined
  const aborted = signal
    ? new Promise<never>((_, reject) => {
        onAbort = () => reject(abortError())
        signal.addEventListener('abort', onAbort, { once: true })
      })
    : undefined
  // Always handled: a late abort after completion must not surface as an
  // unhandled rejection.
  aborted?.catch(() => {})
  const reader = stream.getReader()
  let bytes = 0
  let completed = false
  try {
    for (;;) {
      // Both checks are needed: the flag catches an abort raised while a
      // chunk was being handled (a source that enqueues synchronously can
      // otherwise keep winning the race), the race catches an abort raised
      // while a read is pending on an idle source.
      if (signal?.aborted) throw abortError()
      const { done, value } = aborted
        ? await Promise.race([reader.read(), aborted])
        : await reader.read()
      if (done) break
      bytes += value.length
      for (const event of splitter.push(value)) onLine(event)
      options.onChunk?.(bytes)
    }
    for (const event of splitter.finish()) onLine(event)
    completed = true
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort)
    // On abort or an error from `onLine`, cancel the source so a File or
    // file stream releases its resources now rather than at GC time.
    if (!completed) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
