/**
 * Guards the plural forms in the catalog.
 *
 * Two kinds of check. The *invariants* are mechanical and catch the class of
 * bug rather than an instance: a string that interpolates a bare count
 * without plural forms renders "1 resets", and one half of an `_one` /
 * `_other` pair going missing renders the key itself. Neither fails any
 * existing test, because both produce something that still looks like copy.
 *
 * The *rendered forms* then pin the specific strings, at the counts where
 * English changes: 0, 1 and 2. Multi-count sentences are asserted whole, so a
 * regression in fragment assembly shows up as the sentence a user would read.
 */

import { describe, expect, it } from 'vitest'

import i18n from './index'
import { en } from './en'
import { createFormatters } from './formatters'

const t = i18n.getFixedT('en')
const fmt = createFormatters('en-US')

/** Every leaf string in the catalog, keyed by its dotted path. */
function leaves(node: unknown, prefix = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[prefix, node]]
  if (typeof node !== 'object' || node === null) return []
  return Object.entries(node).flatMap(([key, value]) =>
    leaves(value, prefix ? `${prefix}.${key}` : key),
  )
}

const ALL = leaves(en)
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other']

/** A fragment resolved the way `useCounted` resolves it. */
const counted = (noun: string, value: number) =>
  t(`counts.${noun}` as 'counts.requests', {
    count: value,
    formattedCount: fmt.integer(value),
  })

describe('catalog plural invariants', () => {
  it('pairs every plural form with an _other', () => {
    const suffixed = ALL.map(([key]) => key).filter((key) =>
      PLURAL_SUFFIXES.some((suffix) => key.endsWith(suffix)),
    )
    const stems = new Set(suffixed.map((key) => key.slice(0, key.lastIndexOf('_'))))
    expect(suffixed.length).toBeGreaterThan(0)
    for (const stem of stems) {
      // `_other` is the form i18next falls back to; without it a locale with
      // an unlisted category renders the raw key.
      expect(ALL.map(([key]) => key)).toContain(`${stem}_other`)
    }
  })

  it('never interpolates {{count}} from a key that has no plural forms', () => {
    // `count` is i18next's plural selector. A key using it without suffixed
    // forms is a string that will read "1 resets" at count 1.
    const offenders = ALL.filter(
      ([key, value]) =>
        value.includes('{{count}}') && !PLURAL_SUFFIXES.some((suffix) => key.endsWith(suffix)),
    )
    expect(offenders).toEqual([])
  })

  it('never places a non-selector variable directly before a plural noun', () => {
    // The shape of the bug this suite was written for: "{{requests}} requests"
    // in a key with no plural forms renders "1 requests", and no other test
    // notices because it still looks like copy.
    //
    // The rule: if an interpolation sits immediately before a word in a
    // plural-sensitive noun position, that variable has to BE the plural
    // selector of a pluralized key (`count`, or `formattedCount` alongside
    // it). Anything else means the noun cannot agree with the number in
    // front of it. A second count is fixed by making it a `counts.*`
    // fragment, which moves the noun inside the pluralized key.
    //
    // Words that are not nouns get past the "ends in s" screen, so they are
    // named rather than left to widen the rule.
    const notNouns = new Set(['less', 'across', 'is', 'was', 'has'])
    const offenders: string[] = []

    for (const [key, value] of ALL) {
      for (const match of value.matchAll(/\{\{(\w+)\}\}\s+([A-Za-z]+)/g)) {
        const [, variable, follower] = match
        const nounPosition = follower.endsWith('s') && !notNouns.has(follower)
        if (!nounPosition) continue

        const isSelector = variable === 'count' || variable === 'formattedCount'
        const isPluralized = PLURAL_SUFFIXES.some((suffix) => key.endsWith(suffix))
        if (!isSelector || !isPluralized) {
          offenders.push(`${key}: "{{${variable}}} ${follower}"`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('never interpolates a second bare count into a pluralized string', () => {
    // A key can pluralize on `count` only, so any *other* count-ish variable
    // in the same string has to arrive already pluralized — as a `counts.*`
    // fragment, not as a raw number. These are the names the catalog used to
    // interpolate as bare integers, which is exactly the bug this guards.
    const rawCountVariables = ['{{requests}}', '{{threads}}', '{{resets}}', '{{lines}}']
    const offenders = ALL.filter(
      ([key, value]) =>
        PLURAL_SUFFIXES.some((suffix) => key.endsWith(suffix)) &&
        rawCountVariables.some((variable) => value.includes(variable)),
    )
    expect(offenders).toEqual([])
  })
})

describe('counts.* fragments', () => {
  it.each([
    ['requests', 0, '0 requests'],
    ['requests', 1, '1 request'],
    ['requests', 2, '2 requests'],
    ['sidechainRequests', 1, '1 sidechain request'],
    ['sidechainRequests', 2, '2 sidechain requests'],
    ['threads', 1, '1 thread'],
    ['threads', 2, '2 threads'],
  ])('%s at %i', (noun, value, expected) => {
    expect(counted(noun, value)).toBe(expected)
  })

  it('writes the number through the locale formatter', () => {
    expect(counted('requests', 12_345)).toBe('12,345 requests')
  })
})

describe('rendered plural forms', () => {
  it('pluralizes the sample reset badge', () => {
    const badge = (value: number) =>
      t('samples.badgeResets', { count: value, formattedCount: fmt.integer(value) })
    expect(badge(1)).toBe('1 reset')
    expect(badge(2)).toBe('2 resets')
  })

  it('pluralizes both counts in the subagent detail independently', () => {
    const detail = (threads: number, requests: number) =>
      t('results.subagentThreads', {
        threads: counted('threads', threads),
        requests: counted('requests', requests),
      })
    // The case the old single-key form got wrong: one thread, many requests.
    expect(detail(1, 45)).toBe('1 thread, 45 requests')
    expect(detail(3, 1)).toBe('3 threads, 1 request')
    expect(detail(1, 1)).toBe('1 thread, 1 request')
  })

  it('pluralizes both counts in the subagent limits lines', () => {
    const only = (requests: number, threads: number) =>
      t('results.limitSubagentsOnly', {
        requests: counted('sidechainRequests', requests),
        threads: counted('threads', threads),
      })
    expect(only(1, 1)).toContain('1 sidechain request across 1 thread,')
    expect(only(45, 3)).toContain('45 sidechain requests across 3 threads,')

    const present = (requests: number, threads: number) =>
      t('results.limitSubagentsPresent', {
        requests: counted('sidechainRequests', requests),
        threads: counted('threads', threads),
      })
    expect(present(1, 1)).toContain('carries 1 sidechain request across 1 thread.')
    expect(present(45, 3)).toContain('carries 45 sidechain requests across 3 threads.')
  })

  it('agrees the verb with the excluded-request count', () => {
    const line = (value: number) =>
      t('results.limitUnknownModels', {
        models: 'claude-x',
        count: value,
        formattedCount: fmt.integer(value),
      })
    expect(line(1)).toBe(
      'No published rate for claude-x, so 1 request is excluded from every dollar figure.',
    )
    expect(line(4)).toBe(
      'No published rate for claude-x, so 4 requests are excluded from every dollar figure.',
    )
  })

  it('pluralizes the existing count-bearing strings it already had', () => {
    expect(t('analyzing.requestsSeen', { count: 1 })).toBe('1 request so far')
    expect(t('analyzing.requestsSeen', { count: 2 })).toBe('2 requests so far')
    expect(t('results.metricErrorsNote', { count: 1 })).toBe('1 failed row')
    expect(t('results.metricErrorsNote', { count: 2 })).toBe('2 failed rows')
    expect(t('warnings.malformedLines', { count: 1 })).toBe(
      '1 line was not readable and was skipped.',
    )
    expect(t('warnings.malformedLines', { count: 2 })).toBe(
      '2 lines were not readable and were skipped.',
    )
  })
})
