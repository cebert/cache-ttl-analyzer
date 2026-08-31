/**
 * The bundled sample sessions offered on the landing page. WP-06 captures the
 * real ones, scrubs them, and drops the files into `public/samples/`; adding a
 * row here is all the UI needs — the "Or start with a captured session"
 * region renders only when this list has entries, so the shell ships honestly
 * empty until then.
 *
 * A sample is fetched from our own origin (`connect-src 'self'` permits that
 * and nothing else) and handed to the same worker as an uploaded file, so
 * samples exercise exactly the path a user's own log takes.
 */

import type { en } from '../i18n/en'

/** Which of the three lessons the sample was captured to teach. */
export type SampleLesson = 'five-minute-wins' | 'one-hour-wins' | 'hard-resets'

/** A sample's display name is catalog copy, so it is a checked i18n key. */
export type SampleNameKey = `samples.names.${keyof typeof en.samples.names}`

export interface SampleSession {
  /** Stable id, used as the React key and in the sample's URL. */
  id: string
  /** File name under `public/samples/`. */
  file: string
  nameKey: SampleNameKey
  lesson: SampleLesson
  /** Headline numbers shown on the card, from the captured session. */
  requestCount: number
  spanMs: number
  cacheHitRate: number
  /** Only meaningful for the `hard-resets` lesson. */
  hardResets?: number
}

export const SAMPLES: readonly SampleSession[] = [
  // Captures from fixtures/captured/ (WP-06). The numbers are checked against
  // the fixture and its golden by src/engine/golden.test.ts.
  {
    // The default: a real 85-minute build session at ordinary human pacing,
    // not a scenario enacted to make a point.
    id: 'parallel-subagents',
    file: 'real-session.jsonl',
    nameKey: 'samples.names.realSession',
    lesson: 'one-hour-wins',
    requestCount: 126,
    spanMs: 5_080_750,
    cacheHitRate: 0.9865,
  },
  {
    id: 'tight-loop-5m',
    file: 'tight-loop-5m.jsonl',
    nameKey: 'samples.names.tightLoop',
    lesson: 'five-minute-wins',
    requestCount: 13,
    spanMs: 93_361,
    cacheHitRate: 0.9467,
  },
  {
    id: 'gap-heavy-1h',
    file: 'gap-heavy-1h.jsonl',
    nameKey: 'samples.names.gapHeavy',
    lesson: 'one-hour-wins',
    requestCount: 9,
    spanMs: 1_607_031,
    cacheHitRate: 0.9335,
  },
  {
    // The same prompts and gaps as `gap-heavy-1h`, recorded with the TTL set
    // to 5m: three lapses, two of them partial. 1h wins here only because the
    // simulator restores partially lapsed prefixes.
    id: 'gap-heavy-5m',
    file: 'gap-heavy-5m.jsonl',
    nameKey: 'samples.names.gapHeavy5m',
    lesson: 'one-hour-wins',
    requestCount: 8,
    spanMs: 1_607_199,
    cacheHitRate: 0.6563,
  },
  {
    id: 'model-switch',
    file: 'model-switch.jsonl',
    nameKey: 'samples.names.modelSwitch',
    lesson: 'hard-resets',
    requestCount: 10,
    spanMs: 46_204,
    cacheHitRate: 0.8325,
    hardResets: 2,
  },
]

export const SAMPLES_BASE_PATH = '/samples/'
