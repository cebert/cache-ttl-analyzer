import { describe, expect, it } from 'vitest'

import { createFormatters } from './formatters'

/**
 * The point of routing every figure through `Intl` is that a second locale is
 * a translation task, not a refactor (docs/PLAN.md, D10). These assert the
 * behaviour that claim rests on: the same call produces German separators,
 * German unit names and a trailing currency symbol without any caller change.
 */
describe('createFormatters', () => {
  const en = createFormatters('en-US')
  const de = createFormatters('de-DE')

  describe('integer', () => {
    it('groups thousands per locale', () => {
      expect(en.integer(112_000)).toBe('112,000')
      expect(de.integer(112_000)).toBe('112.000')
    })

    it('renders nothing for a non-finite value rather than "NaN"', () => {
      expect(en.integer(Number.NaN)).toBe('')
      expect(en.integer(Number.POSITIVE_INFINITY)).toBe('')
    })
  })

  describe('currency', () => {
    it('always shows two decimals, so a column of costs aligns', () => {
      expect(en.currency(2.1)).toBe('$2.10')
      expect(en.currency(0)).toBe('$0.00')
    })

    it('places the symbol where the locale places it', () => {
      // Non-breaking space before the German symbol.
      expect(de.currency(2.14).replace(/ /g, ' ')).toBe('2,14 $')
    })
  })

  describe('percent', () => {
    it('renders a 0-1 ratio as whole percent by default', () => {
      expect(en.percent(0.61)).toBe('61%')
      expect(en.percent(1)).toBe('100%')
    })

    it('honours a requested precision', () => {
      expect(en.percent(0.0412, 1)).toBe('4.1%')
    })
  })

  describe('bytes', () => {
    it('scales through binary units', () => {
      expect(en.bytes(0)).toBe('0 byte')
      expect(en.bytes(900)).toBe('900 byte')
      expect(en.bytes(4 * 1024)).toBe('4 kB')
      expect(en.bytes(100 * 1024 * 1024)).toBe('100 MB')
    })

    it('keeps one decimal in the range where it distinguishes files', () => {
      expect(en.bytes(4.2 * 1024 * 1024)).toBe('4.2 MB')
    })

    it('drops the decimal once the number is large enough not to need it', () => {
      expect(en.bytes(512.4 * 1024 * 1024)).toBe('512 MB')
    })

    it('renders nothing for a nonsense size', () => {
      expect(en.bytes(-1)).toBe('')
      expect(en.bytes(Number.NaN)).toBe('')
    })
  })

  describe('duration', () => {
    it('reads in seconds below a minute', () => {
      expect(en.duration(11_000)).toBe('11 sec')
    })

    it('reads in minutes below an hour', () => {
      expect(en.duration(11 * 60_000)).toBe('11 min')
    })

    it('combines hours and minutes above an hour', () => {
      expect(en.duration(80.2 * 60_000)).toBe('1 hr and 20 min')
    })

    it('drops a zero minute remainder', () => {
      expect(en.duration(2 * 3_600_000)).toBe('2 hr')
    })

    it('carries a remainder that rounds to a full hour', () => {
      // 1h 59m 45s rounds the remainder to 60 minutes, which must not render
      // as "1 hr and 60 min".
      expect(en.duration(3_600_000 + 59 * 60_000 + 45_000)).toBe('2 hr')
    })

    it('uses the locale unit names', () => {
      expect(de.duration(11 * 60_000)).toBe('11 Min.')
    })
  })

  describe('date', () => {
    it('formats an ISO instant in the locale order', () => {
      expect(en.date('2026-08-30T12:00:00.000Z')).toMatch(/Aug 30, 2026|Aug 29, 2026/)
    })

    it('renders nothing for an unparseable timestamp, since logs are untrusted', () => {
      expect(en.date('not-a-date')).toBe('')
      expect(en.dateTime('')).toBe('')
    })
  })

  describe('dateTimeRange', () => {
    // The tests run in whatever zone the machine is in, so they assert the
    // shape of the range rather than a wall-clock time.
    const morning = '2026-08-30T12:00:00.000Z'
    const later = '2026-08-30T13:20:00.000Z'

    it('states the date once for a span inside one day', () => {
      const range = en.dateTimeRange(morning, later)
      expect(range).toContain('·')
      expect(range).toContain('–')
      expect(range).toBe(`${en.date(morning)} · ${en.timeOfDay(morning)} – ${en.timeOfDay(later)}`)
    })

    it('states both dates when the span crosses a day', () => {
      const nextWeek = '2026-09-06T13:20:00.000Z'
      expect(en.dateTimeRange(morning, nextWeek)).toBe(
        `${en.dateTime(morning)} – ${en.dateTime(nextWeek)}`,
      )
    })

    it('follows the locale, not a hard-coded order', () => {
      expect(de.dateTimeRange(morning, later)).toContain(de.date(morning))
      expect(de.timeOfDay(morning)).not.toBe(en.timeOfDay(morning))
    })

    it('degrades to what it can parse, since logs are untrusted', () => {
      expect(en.dateTimeRange('not-a-date', later)).toBe('')
      expect(en.dateTimeRange(morning, 'not-a-date')).toBe(en.dateTime(morning))
      expect(en.timeOfDay('not-a-date')).toBe('')
    })
  })

  describe('list', () => {
    it('joins with the locale conjunction', () => {
      expect(en.list(['a', 'b', 'c'])).toBe('a, b, and c')
      expect(de.list(['a', 'b'])).toBe('a und b')
    })
  })
})
