/**
 * What the cache did, over time (docs/PLAN.md §3): the model/effort segments
 * the session ran in, a marker per request positioned in real time, the hard
 * resets that emptied the cache, and the gap histogram that explains why the
 * TTL choice mattered or did not.
 *
 * The marker rail is decorative in the accessibility sense — every fact it
 * draws is also stated in the lists beneath it and in the metrics row — so it
 * is hidden from assistive technology rather than narrated tick by tick.
 * Below ~700px the segment strip drops its inline labels to a legend, which
 * is what WP-D's mobile artboard does.
 */

import { useTranslation } from 'react-i18next'

import type { BucketAnalysis, AnalysisResult, HardResetCause } from '../../engine/contract'
import { useFormatters } from '../../i18n/formatters'
import { Eyebrow, Micro, SectionTitle } from '../../ui/Sheet'
import {
  configSegments,
  orderedResets,
  resetPositions,
  resetWastedTokens,
  timelineMarkers,
  type MarkerKind,
} from './results-model'

const MARKER_STYLE: Record<MarkerKind, { className: string; heightPx: number }> = {
  // Height carries the same ordering as the legend: an expiry is the tallest
  // because it is the event that cost money.
  'warm-read': { className: 'bg-[#b9c6da]', heightPx: 13 },
  'write-only': { className: 'bg-[#8fa3c0]', heightPx: 22 },
  expiry: { className: 'bg-indigo', heightPx: 31 },
}

const RESET_LABEL_KEY = {
  'model-change': 'results.resetModel',
  'effort-change': 'results.resetEffort',
  'version-change': 'results.resetVersion',
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

  const markers = timelineMarkers(bucket)
  const segments = configSegments(result, bucket)
  const resets = orderedResets(bucket)
  const resetRules = resetPositions(bucket)
  const resetTokens = resetWastedTokens(bucket)
  const first = markers.at(0)
  const last = markers.at(-1)

  return (
    <div className="flex flex-col gap-4 px-5 py-4 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <SectionTitle>{t('results.timelineTitle')}</SectionTitle>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
          <LegendSwatch className="bg-[#b9c6da]" label={t('results.legendWarmRead')} />
          <LegendSwatch className="bg-[#8fa3c0]" label={t('results.legendWrite')} />
          <LegendSwatch className="bg-indigo" label={t('results.legendExpiry')} />
          {resets.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-0.5 bg-ink" aria-hidden="true" />
              <Micro>{t('results.legendReset')}</Micro>
            </span>
          )}
        </div>
      </div>

      {markers.length === 0 ? (
        <Micro>{t('results.timelineEmpty')}</Micro>
      ) : (
        <>
          <div className="flex h-[22px] gap-[3px]" aria-hidden="true">
            {segments.map((segment, index) => (
              <div
                key={`${segment.model}-${segment.effort ?? ''}-${index}`}
                className={`flex items-center overflow-hidden rounded-[2px] px-2 ${
                  index === 0 ? 'bg-[#e3ecfd] text-primary' : 'bg-[#edf1f7] text-slate-500'
                }`}
                style={{ width: `${(segment.end - segment.start) * 100}%` }}
              >
                <span className="hidden truncate font-mono text-[10px] whitespace-nowrap sm:inline">
                  {segment.effort ? `${segment.model} · ${segment.effort}` : segment.model}
                </span>
              </div>
            ))}
          </div>
          {/* The labels the strip hides on narrow screens. */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 sm:hidden">
            {segments.map((segment, index) => (
              <span
                key={`legend-${segment.model}-${segment.effort ?? ''}-${index}`}
                className="font-mono text-[10px] text-slate-500"
              >
                {segment.effort ? `${segment.model} · ${segment.effort}` : segment.model}
              </span>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <div
              className="relative h-[46px] overflow-hidden rounded-md border border-line-soft bg-[#fafcfe]"
              aria-hidden="true"
            >
              {resetRules.map((position) => (
                <div
                  key={`reset-${position}`}
                  className="absolute top-0 bottom-0 w-0.5 bg-ink"
                  style={{ left: `${position * 100}%` }}
                />
              ))}
              {markers.map((marker) => (
                <div
                  key={marker.messageId}
                  className={`absolute bottom-[7px] w-[3px] rounded-[1.5px] ${MARKER_STYLE[marker.kind].className}`}
                  style={{
                    left: `${marker.position * 100}%`,
                    height: `${MARKER_STYLE[marker.kind].heightPx}px`,
                  }}
                />
              ))}
            </div>
            <div className="flex justify-between font-mono text-[10.5px] text-slate-400">
              <span>{first ? fmt.timeOfDay(first.timestamp) : ''}</span>
              <span>{last ? fmt.timeOfDay(last.timestamp) : ''}</span>
            </div>
          </div>
        </>
      )}

      <div className="flex flex-col gap-6 border-t border-line-soft pt-3.5 lg:flex-row lg:gap-10">
        <div className="flex flex-col gap-2 lg:w-[380px] lg:shrink-0">
          <Eyebrow>{t('results.resetsTitle')}</Eyebrow>
          {resets.length === 0 ? (
            <Micro>{t('results.resetsNone')}</Micro>
          ) : (
            <>
              {resets.map((reset) => (
                <div
                  key={`${reset.timestamp}-${reset.cause}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"
                >
                  <span className="shrink-0 font-mono text-[11px] text-indigo-600">
                    {t('results.resetRequest', {
                      time: fmt.timeOfDay(reset.timestamp),
                      number: reset.requestNumber,
                    })}
                  </span>
                  <span className="text-[12.5px] text-ink-2">
                    {t(RESET_LABEL_KEY[reset.cause])}{' '}
                    <span className="font-mono text-[11.5px] text-ink">
                      {reset.from || '—'} → {reset.to || '—'}
                    </span>
                  </span>
                </div>
              ))}
              {resetTokens !== null && (
                <Micro>{t('results.resetsWaste', { tokens: fmt.integer(resetTokens) })}</Micro>
              )}
            </>
          )}
        </div>

        <div className="flex grow flex-col gap-2">
          <Eyebrow>{t('results.gapsTitle')}</Eyebrow>
          <GapBar
            label={t('results.gapsUnder5m')}
            count={bucket.shape.gapsUnder5m}
            max={maxGapBand(bucket)}
          />
          <GapBar
            label={t('results.gapsBand')}
            count={bucket.shape.gapsIn5mTo1hBand}
            max={maxGapBand(bucket)}
            highlighted
          />
          <GapBar
            label={t('results.gapsOver1h')}
            count={bucket.shape.gapsOver1h}
            max={maxGapBand(bucket)}
          />
        </div>
      </div>
    </div>
  )
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-[7px] w-[7px] rounded-[2px] ${className}`} aria-hidden="true" />
      <Micro>{label}</Micro>
    </span>
  )
}

function GapBar({
  label,
  count,
  max,
  highlighted = false,
}: {
  label: string
  count: number
  max: number
  highlighted?: boolean
}) {
  const fmt = useFormatters()
  return (
    <div className="flex items-center gap-3">
      <span
        className={`w-[124px] shrink-0 text-[12.5px] ${highlighted ? 'font-semibold text-ink' : 'text-slate-500'}`}
      >
        {label}
      </span>
      <div className="h-[5px] grow overflow-hidden rounded-[3px] bg-[#edf1f7]">
        <div
          className={`h-full ${highlighted ? 'bg-primary' : 'bg-[#b9c6da]'}`}
          style={{ width: `${max > 0 ? (count / max) * 100 : 0}%` }}
        />
      </div>
      <span
        className={`w-8 shrink-0 text-right font-mono text-[12px] ${highlighted ? 'font-semibold text-ink' : 'text-ink-2'}`}
      >
        {fmt.integer(count)}
      </span>
    </div>
  )
}

function maxGapBand(bucket: BucketAnalysis): number {
  const { gapsUnder5m, gapsIn5mTo1hBand, gapsOver1h } = bucket.shape
  return Math.max(gapsUnder5m, gapsIn5mTo1hBand, gapsOver1h)
}
