/**
 * The one tinted region on the page (WP-D): the recommendation, what taking
 * it would have saved, the two costs side by side, and the sentence that says
 * why. Everything below this band is evidence for it.
 *
 * The two cost bars share one scale, so the shorter bar is the cheaper option
 * at a glance without reading either figure.
 */

import { Link } from 'react-router'
import { Trans, useTranslation } from 'react-i18next'

import type { AnalysisResult, BucketAnalysis } from '../../engine/contract'
import { useFormatters } from '../../i18n/formatters'
import { Badge } from '../../ui/Badge'
import { Eyebrow, Micro } from '../../ui/Sheet'
import { ROUTES } from '../routes'
import { barShare, costComparison, settingKey, totalGaps } from './derive'

const TTL_EMPHASIS = { em: <span className="text-primary" /> }

export function VerdictBand({
  result,
  bucket,
}: {
  result: AnalysisResult
  bucket: BucketAnalysis
}) {
  const { t } = useTranslation()
  const fmt = useFormatters()

  const comparison = costComparison(bucket)
  const decided = !bucket.verdictSuppressed && bucket.recommendation !== 'no-verdict'
  const headlineKey = !decided
    ? 'results.recommendationNone'
    : bucket.recommendation === '1h'
      ? 'results.recommendation1h'
      : 'results.recommendation5m'

  return (
    <div className="flex flex-col gap-6 border-b border-[#E1E9F8] bg-verdict px-5 py-6 sm:px-7">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Eyebrow>{t('results.recommendationEyebrow')}</Eyebrow>
            <Badge tone="primary">{settingKey(bucket)}</Badge>
          </div>
          <h2 className="text-[30px] leading-[1.06] font-semibold tracking-[-0.032em] text-balance sm:text-[42px]">
            <Trans i18nKey={headlineKey} components={TTL_EMPHASIS} />
          </h2>
        </div>

        {decided && comparison.savingsRatio !== null && (
          <div className="flex shrink-0 flex-col gap-1 sm:items-end">
            <Eyebrow>{t('results.savedEyebrow')}</Eyebrow>
            <span className="font-mono text-[34px] leading-none font-medium tracking-[-0.035em] text-green sm:text-[42px]">
              {fmt.currency(bucket.savingsUsd)}
            </span>
            <span className="text-[12.5px] text-ink-2">
              {t('results.savedComparison', {
                percent: fmt.percent(comparison.savingsRatio),
                other: t(comparison.cheaper === '1h' ? 'results.ttl5m' : 'results.ttl1h'),
              })}
            </span>
          </div>
        )}
      </div>

      {bucket.verdictSuppressed && (
        <div className="flex flex-col gap-0.5 rounded-[6px] border border-[#F0DFC2] bg-amber-tint px-3.5 py-2.5">
          <p className="text-[12.5px] font-semibold text-amber-ink">
            {t('results.suppressedTitle')}
          </p>
          <p className="text-[12px] leading-[1.5] text-amber-ink">{t('results.suppressedBody')}</p>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <CostBar
          label={t('results.ttl5m')}
          usd={comparison.fiveMinuteUsd}
          share={barShare(comparison.fiveMinuteUsd, comparison.maxUsd)}
          winner={decided && bucket.recommendation === '5m'}
        />
        <CostBar
          label={t('results.ttl1h')}
          usd={comparison.oneHourUsd}
          share={barShare(comparison.oneHourUsd, comparison.maxUsd)}
          winner={decided && bucket.recommendation === '1h'}
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
        <p className="text-[13px] leading-[1.5] text-ink-2">
          <BandSentence bucket={bucket} />
        </p>
        <Micro className="shrink-0 text-[11px]">
          {t('results.ratesNote', { date: fmt.date(result.pricesAsOf) })}{' '}
          <Link to={ROUTES.about} className="text-primary hover:underline">
            {t('results.ratesWhy')}
          </Link>
        </Micro>
      </div>
    </div>
  )
}

/**
 * `aria-hidden` on the bar and a real figure beside it: the bar restates the
 * number visually, so announcing both would read every row twice.
 */
function CostBar({
  label,
  usd,
  share,
  winner,
}: {
  label: string
  usd: number
  share: number
  winner: boolean
}) {
  const fmt = useFormatters()
  return (
    <div className="flex items-center gap-3 sm:gap-3.5">
      <span
        className={`w-[74px] shrink-0 text-[12.5px] sm:w-[84px] ${
          winner ? 'font-semibold text-ink' : 'text-slate-500'
        }`}
      >
        {label}
      </span>
      <span
        aria-hidden="true"
        className="h-[10px] flex-1 overflow-hidden rounded-[3px] bg-[#E3E9F3]"
      >
        <span
          className={`block h-full rounded-[3px] ${winner ? 'bg-primary' : 'bg-[#B9C6DA]'}`}
          style={{ width: `${share * 100}%` }}
        />
      </span>
      <span
        className={`w-[64px] shrink-0 text-right font-mono text-[13.5px] sm:text-[14px] ${
          winner ? 'font-semibold text-ink' : 'text-ink-2'
        }`}
      >
        {fmt.currency(usd)}
      </span>
    </div>
  )
}

/** The single sentence of reasoning WP-D allowed the page (design README). */
function BandSentence({ bucket }: { bucket: BucketAnalysis }) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const total = totalGaps(bucket)
  const inBand = bucket.shape.gapsIn5mTo1hBand

  if (total === 0) return t('results.timeline.gapsNone')
  if (inBand === 0) return t('results.bandSentenceNone')
  return t('results.bandSentence', {
    count: inBand,
    formatted: fmt.integer(inBand),
    total: fmt.integer(total),
  })
}
