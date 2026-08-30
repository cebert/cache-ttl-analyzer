/// <reference lib="webworker" />
/**
 * Analysis Web Worker entry. Wires the real engine (parser + cost engine +
 * simulator, WP-03/04/05) behind the frozen `AnalysisEngine` interface.
 */

import { createEngine } from '../engine/engine'
import type { AnalysisWorkerRequest } from '../engine/protocol'
import { createAnalysisWorkerHandler } from './handler'

declare const self: DedicatedWorkerGlobalScope

const handler = createAnalysisWorkerHandler(createEngine(), (message) => self.postMessage(message))

self.onmessage = (event: MessageEvent<AnalysisWorkerRequest>) => {
  handler.onMessage(event.data)
}
