/**
 * The one tinted region on the page (WP-D): what to set, what it saves, and
 * the two costs side by side. Order follows what matters — recommendation and
 * dollars first, evidence after.
 *
 * The bars are proportional to cost and carry no text, because their width is
 * data-driven and a translated label could not be guaranteed to fit.
 */

import { useTranslation } from 'react-i18next'

import type { BucketAnalysis, CacheTtl } from '../../engine/contract'
import { useCounted } from '../../i18n/counted'
import { useFormatters } from '../../i18n/formatters'
import { Eyebrow, Micro } from '../../ui/Sheet'

const TTL_LABEL_KEY: Record<CacheTtl, 'results.ttl5m' | 'results.ttl1h'> = {
  '5m': 'results.ttl5m',
  '1h': 'results.ttl1h',
}

export function VerdictBand({
  bucket,
  pricesAsOf,
  onWhy,
}: {
  bucket: BucketAnalysis
  pricesAsOf: string
  onWhy: () => void
}) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const counted = useCounted()

  const decided = !bucket.verdictSuppressed && bucket.recommendation !== 'no-verdict'
  const fiveMinuteUsd = bucket.scenarios.fiveMinute.cost.totalUsd
  const oneHourUsd = bucket.scenarios.oneHour.cost.totalUsd
  const worst = Math.max(fiveMinuteUsd, oneHourUsd)

  return (
    <div className="border-b border-[#e1e9f8] bg-verdict px-5 py-6 sm:px-7">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <Eyebrow>{t('results.recommendationLabel')}</Eyebrow>
              <span className="inline-flex h-[19px] items-center rounded-[4px] bg-[#e3ecfd] px-1.5 font-mono text-[11.5px] text-primary">
                {bucket.bucket === 'subagent' ? 'subagentPromptCacheTtl' : 'promptCacheTtl'}
              </span>
            </div>
            <h2 className="text-[32px] leading-[1.05] font-semibold tracking-[-0.032em] text-balance sm:text-[46px]">
              {decided ? (
                <Verdict ttl={bucket.recommendation as CacheTtl} />
              ) : (
                t('results.recommendationNone')
              )}
            </h2>
          </div>

          {decided ? (
            <div className="flex flex-col gap-1 sm:items-end">
              <Eyebrow>{t('results.savedLabel')}</Eyebrow>
              <span className="font-mono text-[34px] leading-none font-medium tracking-[-0.035em] text-green sm:text-[44px]">
                {fmt.currency(bucket.savingsUsd)}
              </span>
              {worst > 0 && (
                <span className="text-[13.5px] text-ink-2">
                  {t('results.savedComparison', {
                    percent: fmt.percent(bucket.savingsUsd / worst),
                    other: t(
                      TTL_LABEL_KEY[bucket.recommendation === '1h' ? '5m' : '1h'],
                    ).toLowerCase(),
                  })}
                </span>
              )}
            </div>
          ) : null}
        </div>

        {decided ? (
          <div className="flex flex-col gap-2.5">
            <CostBar
              label={t('results.ttl5m')}
              usd={fiveMinuteUsd}
              worstUsd={worst}
              highlighted={bucket.recommendation === '5m'}
            />
            <CostBar
              label={t('results.ttl1h')}
              usd={oneHourUsd}
              worstUsd={worst}
              highlighted={bucket.recommendation === '1h'}
            />
          </div>
        ) : (
          <Micro className="max-w-prose">
            {bucket.requestCount === 0 ? t('results.noVerdictEmpty') : t('results.noVerdictBody')}
          </Micro>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
          <p className="text-[14px] text-ink-2">
            {bucket.shape.gapsIn5mTo1hBand === 0
              ? t('results.bandSentenceNone')
              : t('results.bandSentence', {
                  count: bucket.shape.gapsIn5mTo1hBand,
                  formattedCount: fmt.integer(bucket.shape.gapsIn5mTo1hBand),
                  total: counted('gaps', totalGaps(bucket)),
                })}
          </p>
          <Micro>
            {t('results.notional', { date: fmt.date(pricesAsOf) })}{' '}
            <button
              type="button"
              onClick={onWhy}
              className="text-primary hover:text-primary-strong hover:underline"
            >
              {t('results.whyLink')}
            </button>
          </Micro>
        </div>
      </div>
    </div>
  )
}

/** The recommendation, with the TTL itself in the interaction accent. */
function Verdict({ ttl }: { ttl: CacheTtl }) {
  const { t } = useTranslation()
  const sentence = t(ttl === '1h' ? 'results.recommendation1h' : 'results.recommendation5m')
  const ttlPhrase = t(TTL_LABEL_KEY[ttl])
  // The catalog owns the sentence; highlight the TTL inside it when the
  // phrase appears verbatim, and leave the sentence alone when a translation
  // words it differently rather than splicing markup into it blindly.
  const at = sentence.indexOf(ttlPhrase)
  if (at < 0) return <>{sentence}</>
  return (
    <>
      {sentence.slice(0, at)}
      <span className="text-primary">{sentence.slice(at, at + ttlPhrase.length)}</span>
      {sentence.slice(at + ttlPhrase.length)}
    </>
  )
}

function CostBar({
  label,
  usd,
  worstUsd,
  highlighted,
}: {
  label: string
  usd: number
  worstUsd: number
  highlighted: boolean
}) {
  const fmt = useFormatters()
  const width = worstUsd > 0 ? Math.max(0, Math.min(1, usd / worstUsd)) : 0
  return (
    <div className="flex items-center gap-3.5">
      <span
        className={`w-[93px] shrink-0 text-[13.5px] ${highlighted ? 'font-semibold text-ink' : 'text-slate-500'}`}
      >
        {label}
      </span>
      <div className="h-2.5 grow overflow-hidden rounded-[3px] bg-[#e3e9f3]">
        <div
          className={`h-full ${highlighted ? 'bg-primary' : 'bg-[#b9c6da]'}`}
          style={{ width: `${width * 100}%` }}
        />
      </div>
      <span
        className={`w-[74px] shrink-0 text-right font-mono text-[15px] ${highlighted ? 'font-semibold text-ink' : 'text-ink-2'}`}
      >
        {fmt.currency(usd)}
      </span>
    </div>
  )
}

function totalGaps(bucket: BucketAnalysis): number {
  const { gapsUnder5m, gapsIn5mTo1hBand, gapsOver1h } = bucket.shape
  return gapsUnder5m + gapsIn5mTo1hBand + gapsOver1h
}
