/**
 * The session identification card (docs/PLAN.md §3): enough content-free
 * metadata for the user to confirm they loaded the session they meant.
 *
 * Every value here is log-derived and therefore untrusted — rendered as text
 * nodes only, already control-character-stripped and length-clamped by the
 * parser. A field the log did not carry says so rather than being omitted,
 * so the card never implies a session had no branch when it simply was not
 * recorded.
 */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { AnalysisResult, BucketAnalysis } from '../../engine/contract'
import { NON_BILLING_RECORD_TYPES } from '../../engine/parser'
import { useFormatters, type Formatters } from '../../i18n/formatters'
import { subagentBucket, writesAreUniform } from './results-model'

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
  const subagents = subagentBucket(result)
  const observedTtl = useObservedTtlLabel(bucket)

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-3.5 px-5 py-4 sm:grid-cols-2 sm:px-7 lg:grid-cols-4">
      <Field label={t('results.detailDirectory')} value={metadata.cwd} />
      <Field label={t('results.detailBranch')} value={metadata.gitBranch} />
      <Field label={t('results.detailSpan')} value={span(metadata, fmt)} />
      <Field label={t('results.detailObservedTtl')} value={observedTtl} />
      <Field
        label={t('results.detailModel')}
        value={metadata.models.join(' → ')}
        changed={metadata.models.length > 1}
      />
      <Field
        label={t('results.detailEffort')}
        value={metadata.efforts.join(' → ')}
        changed={metadata.efforts.length > 1}
      />
      <Field
        label={t('results.detailVersion')}
        value={metadata.versions.join(' → ')}
        changed={metadata.versions.length > 1}
      />
      <Field
        label={t('results.detailRequests')}
        value={
          skippedCount(result) === 0
            ? // A plural form needs `count`; the formatter still owns how the
              // number is written, so both are passed.
              t('results.requestsCountNoSkips', {
                count: parseStats.dedupedRequests,
                formattedCount: fmt.integer(parseStats.dedupedRequests),
              })
            : t('results.requestsCount', {
                priced: fmt.integer(parseStats.dedupedRequests),
                skipped: fmt.integer(skippedCount(result)),
              })
        }
      />
      <Field
        label={t('results.detailSubagents')}
        value={
          subagents
            ? t('results.subagentThreads', {
                count: subagents.threadCount,
                requests: fmt.integer(subagents.requestCount),
              })
            : t('results.detailNone')
        }
      />
    </div>
  )
}

function Field({
  label,
  value,
  changed = false,
}: {
  label: string
  value: string | undefined
  changed?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] font-medium tracking-[0.07em] text-slate-400 uppercase">
          {label}
        </span>
        {changed && (
          <span className="inline-flex h-3.5 items-center rounded-[3px] bg-indigo-tint px-1 font-mono text-[8.5px] font-semibold text-indigo-600">
            {t('results.detailChanged')}
          </span>
        )}
      </span>
      <Value>{value}</Value>
    </div>
  )
}

function Value({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const empty = children === undefined || children === null || children === ''
  return (
    <span
      className={`font-mono text-[12.5px] leading-[1.45] break-words ${empty ? 'text-slate-400' : 'text-ink'}`}
    >
      {empty ? t('results.detailUnknown') : children}
    </span>
  )
}

function span(metadata: AnalysisResult['metadata'], fmt: Formatters): string | undefined {
  const { firstTimestamp, lastTimestamp } = metadata
  if (!firstTimestamp) return undefined
  return lastTimestamp
    ? fmt.dateTimeRange(firstTimestamp, lastTimestamp)
    : fmt.dateTime(firstTimestamp)
}

/**
 * "1 hour, every write" — the TTL the log shows, and whether it shows it for
 * everything. A hook rather than a plain function so it reads the same
 * translation instance as the rest of the card.
 */
function useObservedTtlLabel(bucket: BucketAnalysis): string {
  const { t } = useTranslation()
  if (bucket.observedTtl === null) return t('results.observedTtlNone')
  const ttl = t(bucket.observedTtl === '1h' ? 'results.ttl1h' : 'results.ttl5m')
  return writesAreUniform(bucket)
    ? t('results.observedTtlUniform', { ttl })
    : t('results.observedTtlMixed', { ttl })
}

/**
 * Rows the user should know were dropped — not every row that was not a
 * request. Claude Code writes hundreds of bookkeeping records per session
 * (`mode`, `queue-operation`, …) that never carried billing data, and
 * counting those as "skipped" reads as data loss; the parser already draws
 * that line for the warnings banner, so the card draws it the same way.
 */
function skippedCount(result: AnalysisResult): number {
  const { parseStats } = result
  let unrecognized = 0
  for (const [type, count] of Object.entries(parseStats.skippedRecordTypes)) {
    if (!NON_BILLING_RECORD_TYPES.has(type)) unrecognized += count
  }
  return unrecognized + parseStats.malformedLines + parseStats.invalidUsageRowsSkipped
}
