/**
 * The six headline totals (WP-D): hit rate, reads, writes, input, output,
 * errors. Every figure is mono and tabular so the row reads as a table
 * without being one, and each carries a note saying what it costs or means.
 *
 * The grid wraps to two and three columns rather than shrinking the labels,
 * which are the part a translation lengthens most.
 */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { BucketAnalysis, ParseStats } from '../../engine/contract'
import { useFormatters } from '../../i18n/formatters'
import { Micro } from '../../ui/Sheet'
import { cacheHitRate, errorRate, observedScenario, writesAreUniform } from './results-model'

/** Above this many tokens the exact count stops being informative. */
const COMPACT_FROM = 100_000

export function MetricsRow({ bucket, stats }: { bucket: BucketAnalysis; stats: ParseStats }) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const totals = bucket.tokenTotals
  const hitRate = cacheHitRate(bucket)
  const errors = errorRate(stats)

  return (
    <div className="grid grid-cols-2 gap-5 px-5 py-4 sm:grid-cols-3 sm:px-7 lg:grid-cols-6">
      <Metric
        value={hitRate === null ? '—' : fmt.percent(hitRate)}
        label={t('results.metricHitRate')}
        note={t('results.metricHitRateNote', {
          reads: fmt.integer(observedScenario(bucket).warmReadRequests),
          requests: fmt.integer(bucket.requestCount),
        })}
      />
      <Metric
        value={compactTokens(totals.cacheReadTokens, fmt)}
        label={t('results.metricReads')}
        note={t('results.metricReadsNote')}
      />
      <Metric
        value={compactTokens(totals.cacheWriteTokens, fmt)}
        label={t('results.metricWrites')}
        note={t(writeNoteKey(bucket))}
      />
      <Metric
        value={compactTokens(totals.inputTokens, fmt)}
        label={t('results.metricInput')}
        note={t('results.metricInputNote')}
      />
      <Metric
        value={compactTokens(totals.outputTokens, fmt)}
        label={t('results.metricOutput')}
        note={t('results.metricOutputNote')}
      />
      <Metric
        value={errors === null ? '—' : fmt.percent(errors, 1)}
        label={t('results.metricErrors')}
        note={t('results.metricErrorsNote', { count: stats.syntheticRowsExcluded })}
        // Red is the app's one failure accent; a clean session stays neutral
        // so the color means something when it appears.
        emphasis={errors !== null && errors > 0 ? 'red' : 'neutral'}
      />
    </div>
  )
}

function Metric({
  value,
  label,
  note,
  emphasis = 'neutral',
}: {
  value: ReactNode
  label: string
  note: string
  emphasis?: 'neutral' | 'red'
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={`font-mono text-[23px] leading-tight font-medium tracking-[-0.02em] ${
          emphasis === 'red' ? 'text-red' : 'text-ink'
        }`}
      >
        {value}
      </span>
      <Micro>{label}</Micro>
      <span className="font-mono text-[10.5px] text-slate-400">{note}</span>
    </div>
  )
}

/** "2.41M" rather than "2,410,000" — the magnitude is the point. */
function compactTokens(tokens: number, fmt: { integer: (n: number) => string }): string {
  if (tokens < COMPACT_FROM) return fmt.integer(tokens)
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`
  return `${(tokens / 1_000_000).toFixed(2)}M`
}

/** Which note the cache-writes figure carries, as a catalog key. */
function writeNoteKey(bucket: BucketAnalysis) {
  if (bucket.tokenTotals.cacheWriteTokens === 0) return 'results.metricWritesNoteNone' as const
  if (!writesAreUniform(bucket)) return 'results.metricWritesNoteMixed' as const
  return bucket.observedTtl === '1h'
    ? ('results.metricWritesNote1h' as const)
    : ('results.metricWritesNote5m' as const)
}
