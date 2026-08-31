/**
 * Vitest setup, loaded for every test file. The engine tests run in the Node
 * environment and must not pull in DOM-only helpers, so the jsdom-side setup
 * (jest-dom matchers, React Testing Library's between-test cleanup, which does
 * not self-register without Vitest globals) is loaded only when a document
 * exists.
 */

import { afterEach } from 'vitest'

if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
  const { cleanup } = await import('@testing-library/react')
  afterEach(cleanup)
  installBlobStream()
}

/**
 * jsdom implements `Blob` without `stream()`, and streaming the file is how the
 * whole app reads a session log (docs/PLAN.md §2) — without this, every
 * component test would exercise the worker's error path instead of its happy
 * one. Chunked rather than one buffer, so the parser's line splitting and the
 * progress messages behave as they do in a browser.
 */
const CHUNK_BYTES = 64 * 1024

function installBlobStream(): void {
  const proto = globalThis.Blob?.prototype as (Blob & { stream?: unknown }) | undefined
  if (!proto || typeof proto.stream === 'function') return

  Object.defineProperty(proto, 'stream', {
    configurable: true,
    writable: true,
    value(this: Blob): ReadableStream<Uint8Array> {
      return chunkedStream(this, CHUNK_BYTES)
    },
  })
}

function chunkedStream(blob: Blob, chunkBytes: number): ReadableStream<Uint8Array> {
  let offset = 0
  let bytes: Uint8Array | null = null
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      bytes ??= new Uint8Array(await blob.arrayBuffer())
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.subarray(offset, offset + chunkBytes))
      offset += chunkBytes
    },
  })
}
