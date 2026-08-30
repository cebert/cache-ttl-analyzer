/// <reference lib="webworker" />
/**
 * Analysis Web Worker entry point. Currently wires the WP-02 stub engine;
 * WP-05 swaps in the real engine behind the same `AnalysisEngine` interface
 * without touching the protocol.
 */

import { createStubEngine } from '../engine/stub'
import type { AnalysisWorkerRequest } from '../engine/protocol'
import { createAnalysisWorkerHandler } from './handler'

declare const self: DedicatedWorkerGlobalScope

const handler = createAnalysisWorkerHandler(createStubEngine(), (message) =>
  self.postMessage(message),
)

self.onmessage = (event: MessageEvent<AnalysisWorkerRequest>) => {
  handler.onMessage(event.data)
}
