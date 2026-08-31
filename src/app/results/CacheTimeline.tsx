/**
 * What the cache did over the session: which model and effort were in force,
 * where entries were read warm and where they lapsed, what reset the cache,
 * and how the gaps between requests fell out.
 *
 * The plotted expiries are the FIVE-MINUTE scenario's. That is the shorter
 * TTL, so its lapses are a superset of the hour-long one's — plotting it
 * shows every point where the choice could possibly bite, and the caption
 * says so rather than leaving the reader to guess which run they are seeing.
 *
 * The track is bucketed into a fixed number of columns rather than drawn one
 * mark per request (see `timelineColumns`), so a nine-request sample and a
 * four-thousand-request session both render a readable, bounded chart.
 */

import { useTranslation } from 'react-i18next'

import type { AnalysisResult, BucketAnalysis, HardResetCause } from '../../engine/contract'
import { useFormatters } from '../../i18n/formatters'
import { Eyebrow, Micro, SectionTitle } from '../../ui/Sheet'
import {
  barShare,
  configSegments,
  gapBands,
  isSameCalendarDay,
  resetPoints,
  sessionSpan,
  shortModelName,
  timelineColumns,
  totalGaps,
  type ResetPoint,
} from './derive'

const GAP_LABEL_KEY = {
  under5m: 'results.timeline.gapUnder5m',
  band: 'results.timeline.gapBand',
  over1h: 'results.timeline.gapOver1h',
} as const

const RESET_CAUSE_KEY = {
  'model-change': 'results.timeline.resetCauseModel',
  'effort-change': 'results.timeline.resetCauseEffort',
  'version-change': 'results.timeline.resetCauseVersion',
} as const satisfies Record<HardResetCause, string>

export function CacheTimeline({
  result,
  bucket,
}: {
  result: AnalysisResult
  bucket: BucketAnalysis
}) {
  const { t } = useTranslation()
  const fmt = useFormatters()

  const span = sessionSpan(result.metadata)
  const events = bucket.scenarios.fiveMinute.events
  const resets = span ? resetPoints(events, span) : []

  // A session inside one day needs only clock times under its track; one that
  // ran past midnight needs the date to say so.
  const { firstTimestamp = '', lastTimestamp = '' } = result.metadata
  const edge = isSameCalendarDay(firstTimestamp, lastTimestamp) ? fmt.time : fmt.dateTime

  return (
    <div className="flex flex-col gap-5 px-5 py-5 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <SectionTitle>{t('results.timeline.title')}</SectionTitle>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
          <LegendItem swatch="bg-[#B9C6DA]" label={t('results.timeline.legendWarm')} />
          <LegendItem swatch="bg-indigo" label={t('results.timeline.legendExpiry')} />
          <LegendItem swatch="w-[2px] h-[10px] bg-ink" label={t('results.timeline.legendReset')} />
        </div>
      </div>

      {span ? (
        <div className="flex flex-col gap-3">
          <ConfigStrip result={result} resets={resets} />
          <Track events={events} span={span} resets={resets} />
          <div className="flex items-baseline justify-between font-mono text-[10.5px] text-slate-400">
            <span>{edge(firstTimestamp)}</span>
            <span>{edge(lastTimestamp)}</span>
          </div>
          <Micro className="text-[11px]">{t('results.timeline.caption')}</Micro>
        </div>
      ) : (
        <Micro className="text-[11.5px]">{t('results.timeline.unavailable')}</Micro>
      )}

      <div className="flex flex-col gap-6 border-t border-line-soft pt-4 lg:flex-row lg:gap-10">
        <ResetList resets={resets} formatTime={edge} />
        <GapHistogram bucket={bucket} />
      </div>
    </div>
  )
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`shrink-0 rounded-[2px] ${swatch.includes('w-') ? swatch : `size-[7px] ${swatch}`}`}
      />
      <span className="text-[11px] leading-none text-slate-500">{label}</span>
    </span>
  )
}

/** The run of model-and-effort settings, drawn to scale across the session. */
function ConfigStrip({ result, resets }: { result: AnalysisResult; resets: ResetPoint[] }) {
  const { t } = useTranslation()
  const segments = configSegments(result.metadata, resets)
  if (segments.length === 0) return null

  return (
    <div
      className="flex h-[22px] gap-[3px]"
      role="img"
      aria-label={t('results.timeline.configStripLabel')}
    >
      {segments.map((segment, index) => (
        <span
          key={`${segment.model}-${segment.effort ?? ''}-${index}`}
          style={{ width: `${segment.width * 100}%` }}
          title={[segment.model, segment.effort].filter(Boolean).join(' · ')}
          className={`flex items-center overflow-hidden rounded-[2px] px-2 font-mono text-[10px] whitespace-nowrap ${
            index === 0 ? 'bg-primary-tint text-primary' : 'bg-[#EDF1F7] text-slate-500'
          }`}
        >
          {[shortModelName(segment.model), segment.effort].filter(Boolean).join(' · ')}
        </span>
      ))}
    </div>
  )
}

/**
 * The event track. A column with any expiry is drawn as an expiry — a lapse
 * is the thing worth seeing, and averaging it away with the warm reads around
 * it would hide exactly what the page is for.
 */
function Track({
  events,
  span,
  resets,
}: {
  events: BucketAnalysis['scenarios']['fiveMinute']['events']
  span: NonNullable<ReturnType<typeof sessionSpan>>
  resets: ResetPoint[]
}) {
  const columns = timelineColumns(events, span)

  return (
    <div
      aria-hidden="true"
      className="relative flex h-[46px] items-end gap-[1px] overflow-hidden rounded-[6px] border border-line-soft bg-[#FAFCFE] px-1 pb-1.5"
    >
      {columns.map((column, index) => {
        const expired = column.expiries > 0
        const warm = column.warmReads > 0
        if (!expired && !warm) return <span key={index} className="flex-1" />
        return (
          <span
            key={index}
            className={`flex-1 rounded-[1.5px] ${expired ? 'h-[31px] bg-indigo' : 'h-[13px] bg-[#B9C6DA]'}`}
          />
        )
      })}
      {resets.map((reset) => (
        <span
          key={`${reset.timestamp}-${reset.cause}`}
          style={{ left: `${reset.position * 100}%` }}
          className="absolute inset-y-0 w-[2px] bg-ink"
        />
      ))}
    </div>
  )
}

function ResetList({
  resets,
  formatTime,
}: {
  resets: ResetPoint[]
  /** Same same-day rule as the track's edge labels, so the two agree. */
  formatTime: (iso: string) => string
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2 lg:w-[380px] lg:shrink-0">
      <Eyebrow>{t('results.timeline.resetsTitle')}</Eyebrow>
      {resets.length === 0 ? (
        <Micro className="text-[11.5px]">{t('results.timeline.resetsNone')}</Micro>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {resets.map((reset) => (
              <li
                key={`${reset.timestamp}-${reset.cause}-${reset.to}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"
              >
                <span className="shrink-0 font-mono text-[11px] text-indigo-600">
                  {formatTime(reset.timestamp)}
                </span>
                <span className="min-w-0 text-[12.5px] text-ink-2">
                  {t(RESET_CAUSE_KEY[reset.cause])}{' '}
                  <span className="font-mono text-[11.5px] break-all text-ink">
                    {shortModelName(reset.from)} → {shortModelName(reset.to)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <Micro className="text-[11px]">{t('results.timeline.resetNote')}</Micro>
        </>
      )}
    </div>
  )
}

function GapHistogram({ bucket }: { bucket: BucketAnalysis }) {
  const { t } = useTranslation()
  const fmt = useFormatters()

  const total = totalGaps(bucket)
  const bands = gapBands(bucket)
  const largest = Math.max(...bands.map((band) => band.count))

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <Eyebrow>{t('results.timeline.gapsTitle')}</Eyebrow>
      {total === 0 ? (
        <Micro className="text-[11.5px]">{t('results.timeline.gapsNone')}</Micro>
      ) : (
        bands.map((band) => (
          <div key={band.id} className="flex items-center gap-3">
            <span
              className={`w-[118px] shrink-0 text-[12.5px] ${
                band.decisive ? 'font-semibold text-ink' : 'text-slate-500'
              }`}
            >
              {t(GAP_LABEL_KEY[band.id])}
            </span>
            <span
              aria-hidden="true"
              className="h-[5px] flex-1 overflow-hidden rounded-[3px] bg-[#EDF1F7]"
            >
              <span
                className={`block h-full rounded-[3px] ${band.decisive ? 'bg-primary' : 'bg-[#B9C6DA]'}`}
                style={{
                  // A band with gaps in it must not render as an empty track:
                  // 4 against a scale of 121 is a sliver, and the row below
                  // it really is zero.
                  width: band.count === 0 ? 0 : `max(3px, ${barShare(band.count, largest) * 100}%)`,
                }}
              />
            </span>
            <span
              className={`w-[34px] shrink-0 text-right font-mono text-[12px] ${
                band.decisive ? 'font-semibold text-ink' : 'text-ink-2'
              }`}
            >
              {fmt.integer(band.count)}
            </span>
          </div>
        ))
      )}
    </div>
  )
}
