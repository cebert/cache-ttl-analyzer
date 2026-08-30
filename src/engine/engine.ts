/**
 * WP-05 — the real `AnalysisEngine`: streams the file through the parser
 * (WP-03), applies the validation verdict, and runs the simulator (WP-05)
 * with the cost engine (WP-04). Replaces the WP-02 stub behind the same
 * interface, so the worker protocol and its tests are unchanged.
 */

import type { AnalysisEngine, EngineOutcome } from './contract'
import { knownModelIds } from './cost'
import { parseSession, rejectionReason } from './parser'
import { analyzeSession } from './simulator'

export function createEngine(): AnalysisEngine {
  return {
    async analyze(input, { onProgress, signal }) {
      const parsed = await parseSession(input.stream, {
        fileName: input.fileName,
        fileSizeBytes: input.fileSizeBytes,
        knownModels: knownModelIds(input.pricing),
        onProgress,
        signal,
      })
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      if (parsed.verdict === 'not-a-session-log') {
        const outcome: EngineOutcome = {
          kind: 'rejected',
          verdict: 'not-a-session-log',
          stats: parsed.stats,
          reason: rejectionReason(parsed),
        }
        return outcome
      }
      onProgress({
        phase: 'analyzing',
        bytesProcessed: input.fileSizeBytes,
        totalBytes: input.fileSizeBytes,
        requestsSeen: parsed.requests.length,
      })
      // Yield a macrotask so a cancel posted while the file was being read
      // is dispatched before the CPU-bound analysis starts.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      const result = analyzeSession(parsed, input.pricing)
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      return { kind: 'analysis', result }
    },
  }
}
