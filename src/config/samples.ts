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

export const SAMPLES: readonly SampleSession[] = []

export const SAMPLES_BASE_PATH = '/samples/'
