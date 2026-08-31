/**
 * Resolves the `counts.*` fragments — the "number + noun" pieces that strings
 * carrying more than one count are assembled from.
 *
 * i18next picks a plural form from one variable per key (`count`), so
 * "3 threads, 45 requests" cannot be a single pluralized string: at
 * `count: 1` the library would choose `_one` for the whole sentence and the
 * other number would still read "45 request". Each count is therefore its own
 * fragment, and the sentence interpolates the finished strings.
 *
 * `count` selects the form and `formattedCount` carries the number as the
 * active locale writes it, so grouping separators survive the round trip.
 */

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useFormatters } from './formatters'
import type { en } from './en'

/**
 * The fragment names, minus i18next's plural suffixes — derived from the
 * catalog rather than restated, so adding a `counts.foo_one` / `foo_other`
 * pair is all a new fragment needs, and deleting one is a compile error at
 * every call site.
 */
export type CountNoun = keyof (typeof en)['counts'] extends infer K
  ? K extends `${infer Noun}_one`
    ? Noun
    : never
  : never

export type Counted = (noun: CountNoun, value: number) => string

export function useCounted(): Counted {
  const { t } = useTranslation()
  const fmt = useFormatters()

  return useCallback(
    (noun: CountNoun, value: number) =>
      t(`counts.${noun}`, { count: value, formattedCount: fmt.integer(value) }),
    [t, fmt],
  )
}
