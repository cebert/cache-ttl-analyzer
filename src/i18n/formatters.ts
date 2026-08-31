/**
 * Every number, currency amount, date, byte count and duration on screen goes
 * through here (docs/PLAN.md, D10) so switching locale changes separators,
 * currency placement and unit names without touching a component.
 *
 * `createFormatters` is a pure function of the locale, so the formatting rules
 * are unit-testable in Node against several locales; `useFormatters` is the
 * React binding that keys them to the active i18next language. Constructing
 * `Intl` objects is comparatively expensive, so each locale's set is built
 * once and memoized.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/** Binary units, because file managers report session-log sizes this way. */
const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const
const BYTES_PER_UNIT = 1024

const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE

export interface Formatters {
  locale: string
  /** Whole number with grouping, e.g. "112,000". */
  integer: (value: number) => string
  /**
   * A large count at a glance, e.g. "2.4M". Token totals run to seven
   * figures and sit in a six-across metric row, where the grouped form
   * neither fits nor reads; the exact figure goes in the `title`.
   */
  compact: (value: number) => string
  /** USD at published Anthropic API rates (decision D2). */
  currency: (usd: number) => string
  /** A 0–1 ratio as a percentage, e.g. 0.61 -> "61%". */
  percent: (ratio: number, fractionDigits?: number) => string
  /** A file size, e.g. "4.2 MB". */
  bytes: (value: number) => string
  /** An elapsed span, e.g. "1 hr, 20 min". Sub-minute spans read in seconds. */
  duration: (ms: number) => string
  /** An ISO timestamp as a date, e.g. "Aug 30, 2026". */
  date: (iso: string) => string
  /** An ISO timestamp as date and time of day. */
  dateTime: (iso: string) => string
  /** An ISO timestamp as a time of day alone, e.g. "6:20 PM". */
  time: (iso: string) => string
  /** A list joined the way the locale joins lists, e.g. "a, b, and c". */
  list: (items: readonly string[]) => string
}

function unitFormat(locale: string, unit: string, maximumFractionDigits: number) {
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits,
  })
}

export function createFormatters(locale: string): Formatters {
  const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const compact = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  const currency = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short' })
  const list = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' })
  const seconds = unitFormat(locale, 'second', 0)
  const minutes = unitFormat(locale, 'minute', 0)
  const hours = unitFormat(locale, 'hour', 0)

  function bytes(value: number): string {
    if (!Number.isFinite(value) || value < 0) return ''
    let scaled = value
    let unitIndex = 0
    while (scaled >= BYTES_PER_UNIT && unitIndex < BYTE_UNITS.length - 1) {
      scaled /= BYTES_PER_UNIT
      unitIndex += 1
    }
    // Whole bytes and kilobytes read better without a decimal; above that a
    // single decimal is what distinguishes a 4.2 MB log from a 4.9 MB one.
    const fractionDigits = unitIndex <= 1 || scaled >= 100 ? 0 : 1
    return unitFormat(locale, BYTE_UNITS[unitIndex], fractionDigits).format(scaled)
  }

  function duration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return ''
    if (ms < MS_PER_MINUTE) return seconds.format(Math.round(ms / MS_PER_SECOND))
    if (ms < MS_PER_HOUR) return minutes.format(Math.round(ms / MS_PER_MINUTE))
    const wholeHours = Math.floor(ms / MS_PER_HOUR)
    const remainderMinutes = Math.round((ms % MS_PER_HOUR) / MS_PER_MINUTE)
    if (remainderMinutes === 0) return hours.format(wholeHours)
    // Rounding can carry into the next hour ("1 hr, 60 min" is not a thing).
    if (remainderMinutes === 60) return hours.format(wholeHours + 1)
    return list.format([hours.format(wholeHours), minutes.format(remainderMinutes)])
  }

  return {
    locale,
    integer: (value) => (Number.isFinite(value) ? integer.format(value) : ''),
    // Below 1000 the compact form is the plain number, so this needs no
    // special case — `Intl` already returns "999" rather than "1.0K".
    compact: (value) => (Number.isFinite(value) ? compact.format(value) : ''),
    currency: (usd) => (Number.isFinite(usd) ? currency.format(usd) : ''),
    percent: (ratio, fractionDigits = 0) =>
      Number.isFinite(ratio)
        ? new Intl.NumberFormat(locale, {
            style: 'percent',
            maximumFractionDigits: fractionDigits,
          }).format(ratio)
        : '',
    bytes,
    duration,
    date: (iso) => formatInstant(iso, date),
    dateTime: (iso) => formatInstant(iso, dateTime),
    time: (iso) => formatInstant(iso, time),
    list: (items) => list.format(items),
  }
}

/** Log-derived timestamps are untrusted; an unparseable one renders empty. */
function formatInstant(iso: string, format: Intl.DateTimeFormat): string {
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? '' : format.format(parsed)
}

const cache = new Map<string, Formatters>()

export function getFormatters(locale: string): Formatters {
  let formatters = cache.get(locale)
  if (!formatters) {
    formatters = createFormatters(locale)
    cache.set(locale, formatters)
  }
  return formatters
}

export function useFormatters(): Formatters {
  const { i18n } = useTranslation()
  return useMemo(() => getFormatters(i18n.language), [i18n.language])
}
