/**
 * WP-06 — publish the scenario captures the UI lists as bundled samples.
 *
 * `src/config/samples.ts` (WP-07) is the source of truth for WHICH captures
 * ship and what their cards say; this script copies each listed sample's
 * `fixtures/captured/scenarios/<id>/session.jsonl` to `public/samples/<file>`
 * and removes anything else there. `src/engine/golden.test.ts` asserts the
 * copies are byte-identical and that every number on a card matches the
 * fixture and its golden.
 *
 * Run: `node scripts/sync-samples.ts` (also `npm run samples:sync`).
 */

import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SAMPLES } from '../src/config/samples.ts'

export const SCENARIOS_DIR = join('fixtures', 'captured', 'scenarios')
export const SAMPLES_DIR = join('public', 'samples')

export function sampleSource(id: string): string {
  return join(SCENARIOS_DIR, id, 'session.jsonl')
}

function main(): void {
  mkdirSync(SAMPLES_DIR, { recursive: true })
  const wanted = new Set(SAMPLES.map((s) => s.file))
  for (const name of readdirSync(SAMPLES_DIR)) {
    if (name.endsWith('.jsonl') && !wanted.has(name)) {
      rmSync(join(SAMPLES_DIR, name))
      console.log(`removed ${join(SAMPLES_DIR, name)}`)
    }
  }
  for (const sample of SAMPLES) {
    copyFileSync(sampleSource(sample.id), join(SAMPLES_DIR, sample.file))
    console.log(`copied ${sampleSource(sample.id)} -> ${join(SAMPLES_DIR, sample.file)}`)
  }
}

// Only run when executed directly, so the test can import the helpers.
if (process.argv[1]?.endsWith('sync-samples.ts')) main()
