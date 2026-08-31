/**
 * The six headline figures, in the order WP-D put them: what the cache did,
 * then what it moved, then what went wrong.
 *
 * Every figure is abbreviated ("2.4M") because six of them share a row, and
 * every abbreviated figure carries the exact count in its `title` and in
 * screen-reader text — the row is a summary, not a place to lose precision.
 *
 * The error-rate column is dropped entirely when nothing failed, rather than
 * shown as a green "0%": a column that can only ever read zero is noise.
 */

import { useTranslation } from 'react-i18next'

import type { AnalysisResult, BucketAnalysis } from '../../engine/contract'
import { useFormatters } from '../../i18n/formatters'
import { cacheHitRate, errorRate, writeMix } from './derive'

export function MetricsRow({ result, bucket }: { result: AnalysisResult; bucket: BucketAnalysis }) {
  const { t } = useTranslation()
  const fmt = useFormatters()

  const usage = bucket.actualUsage
  const failures = errorRate(result.parseStats)
  const mix = writeMix(bucket)

  const writesDetail =
    mix === 'none'
      ? t('results.metrics.writesNone')
      : mix === 'all-1h'
        ? t('results.metrics.writesAll1h')
        : mix === 'all-5m'
          ? t('results.metrics.writesAll5m')
          : t('results.metrics.writesMixed', {
              share: fmt.percent(
                bucket.observedWriteSplit.oneHourWriteTokens / usage.cacheWriteTokens,
              ),
            })

  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-5 px-5 py-5 sm:grid-cols-3 sm:px-7 lg:grid-cols-6">
      <Metric
        value={fmt.percent(cacheHitRate(usage))}
        label={t('results.metrics.hitRate')}
        detail={t('results.metrics.hitRateDetail', {
          warm: fmt.integer(bucket.warmReadRequestCount),
          total: fmt.integer(bucket.requestCount),
        })}
      />
      <TokenMetric
        tokens={usage.cacheReadTokens}
        label={t('results.metrics.reads')}
        detail={t('results.metrics.readsDetail')}
      />
      <TokenMetric
        tokens={usage.cacheWriteTokens}
        label={t('results.metrics.writes')}
        detail={writesDetail}
      />
      <TokenMetric
        tokens={usage.inputTokens}
        label={t('results.metrics.input')}
        detail={t('results.metrics.inputDetail')}
      />
      <TokenMetric
        tokens={usage.outputTokens}
        label={t('results.metrics.output')}
        detail={t('results.metrics.outputDetail')}
      />
      {failures && (
        <Metric
          value={fmt.percent(failures.rate, 1)}
          label={t('results.metrics.errorRate')}
          detail={t('results.metrics.errorRateDetail', {
            count: failures.failed,
            formatted: fmt.integer(failures.failed),
          })}
          tone="text-red"
        />
      )}
    </div>
  )
}

function TokenMetric({ tokens, label, detail }: { tokens: number; label: string; detail: string }) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const exact = t('results.metrics.exactTokens', {
    count: tokens,
    formatted: fmt.integer(tokens),
  })
  return <Metric value={fmt.compact(tokens)} exact={exact} label={label} detail={detail} />
}

function Metric({
  value,
  exact,
  label,
  detail,
  tone = 'text-ink',
}: {
  value: string
  /** The unabbreviated figure, when the displayed one is rounded. */
  exact?: string
  label: string
  detail: string
  tone?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span
        title={exact}
        className={`font-mono text-[21px] leading-tight font-medium tracking-[-0.02em] sm:text-[23px] ${tone}`}
      >
        <span aria-hidden={exact ? 'true' : undefined}>{value}</span>
        {exact && <span className="sr-only">{exact}</span>}
      </span>
      <span className="text-[11.5px] leading-[1.4] text-slate-500">{label}</span>
      <span className="font-mono text-[10.5px] leading-[1.4] text-slate-400">{detail}</span>
    </div>
  )
}
