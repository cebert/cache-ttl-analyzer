/**
 * Which session this was: directory, branch, when it ran, and the settings in
 * force. WP-08 calls this the identification card — its job is to let someone
 * with four analyses in the sidebar tell which one they are looking at.
 *
 * Every value here is log-derived and therefore untrusted (docs/PLAN.md §2):
 * each is rendered as a text node, never as markup, and the parser has already
 * stripped control characters and clamped length.
 *
 * A field the log did not record says so rather than disappearing, so the card
 * keeps the same shape between sessions and an absence is legible as one.
 */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { AnalysisResult, BucketAnalysis } from '../../engine/contract'
import { useFormatters } from '../../i18n/formatters'
import { Badge } from '../../ui/Badge'
import { isSameCalendarDay, shortModelName, writeMix } from './derive'

export function SessionDetails({
  result,
  bucket,
}: {
  result: AnalysisResult
  bucket: BucketAnalysis
}) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const { metadata, parseStats } = result

  const subagent = result.buckets.find((candidate) => candidate.bucket === 'subagent')

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-5 sm:grid-cols-3 sm:px-7 lg:grid-cols-4">
      <Field label={t('results.details.directory')} value={metadata.cwd} />
      <Field label={t('results.details.branch')} value={metadata.gitBranch} />
      <Field label={t('results.details.span')} value={spanValue(result, fmt, t)} />
      <Field label={t('results.details.observedTtl')} value={observedTtlValue(bucket, fmt, t)} />

      <ChangingField
        label={t('results.details.model')}
        values={metadata.models.map(shortModelName)}
      />
      <ChangingField label={t('results.details.effort')} values={metadata.efforts} />
      <ChangingField label={t('results.details.version')} values={metadata.versions} />

      <Field
        label={t('results.details.requests')}
        value={requestsValue(bucket, parseStats.syntheticRowsExcluded, fmt, t)}
      />
      <Field
        label={t('results.details.subagents')}
        value={
          subagent
            ? t('results.details.subagentsCount', {
                count: subagent.threadCount,
                formatted: fmt.integer(subagent.threadCount),
              })
            : t('results.details.subagentsNone')
        }
      />
    </dl>
  )
}

type Translate = ReturnType<typeof useTranslation>['t']
type Format = ReturnType<typeof useFormatters>

function spanValue(result: AnalysisResult, fmt: Format, t: Translate): string | undefined {
  const { firstTimestamp, lastTimestamp } = result.metadata
  if (!firstTimestamp || !lastTimestamp) return undefined

  // Nearly every session begins and ends on one day, and saying that date
  // twice is what overran this field's width.
  if (isSameCalendarDay(firstTimestamp, lastTimestamp)) {
    const date = fmt.date(firstTimestamp)
    const start = fmt.time(firstTimestamp)
    const end = fmt.time(lastTimestamp)
    if (date && start && end) return t('results.details.spanSameDay', { date, start, end })
  }

  const start = fmt.dateTime(firstTimestamp)
  const end = fmt.dateTime(lastTimestamp)
  if (!start || !end) return undefined
  return t('results.details.spanValue', { start, end })
}

function observedTtlValue(bucket: BucketAnalysis, fmt: Format, t: Translate): string {
  const mix = writeMix(bucket)
  if (mix === 'none') return t('results.details.observedNone')
  if (mix === 'all-1h') return t('results.details.observedAll1h')
  if (mix === 'all-5m') return t('results.details.observedAll5m')
  const { fiveMinuteWriteTokens, oneHourWriteTokens } = bucket.observedWriteSplit
  return t('results.details.observedMixed', {
    share: fmt.percent(oneHourWriteTokens / (fiveMinuteWriteTokens + oneHourWriteTokens)),
  })
}

function requestsValue(bucket: BucketAnalysis, failed: number, fmt: Format, t: Translate): string {
  const priced = t('results.details.requestsValue', {
    count: bucket.requestCount,
    formatted: fmt.integer(bucket.requestCount),
  })
  if (failed === 0) return priced
  return t('results.details.requestsSkipped', { priced, skipped: fmt.integer(failed) })
}

/**
 * A field whose value changed mid-session. The badge is the point: a change
 * of model, effort or version is a hard cache reset, and the reset list below
 * explains what it cost.
 */
function ChangingField({ label, values }: { label: string; values: readonly string[] }) {
  const { t } = useTranslation()
  const changed = values.length > 1

  return (
    <Field
      label={label}
      badge={changed ? <Badge tone="indigo">{t('results.details.changed')}</Badge> : undefined}
      value={
        changed
          ? t('results.details.changedFromTo', { from: values[0], to: values[values.length - 1] })
          : values[0]
      }
    />
  )
}

function Field({ label, value, badge }: { label: string; value?: string; badge?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="flex items-center gap-1.5 font-mono text-[10px] font-medium tracking-[0.07em] text-slate-400 uppercase">
        {label}
        {badge}
      </dt>
      {/*
        Wrapping, not truncating. These columns are half a phone screen wide,
        where an ellipsis hides the end of the span and of the request counts
        — and a `title` tooltip is not reachable by touch.
      */}
      <dd
        className={`font-mono text-[12.5px] leading-[1.45] break-words ${
          value ? 'text-ink' : 'text-slate-400 italic'
        }`}
      >
        {value ?? t('results.details.notRecorded')}
      </dd>
    </div>
  )
}
