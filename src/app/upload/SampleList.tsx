/**
 * The captured sample sessions. A sample is fetched from our own origin and
 * wrapped in a `File`, so it goes through the identical pre-flight checks and
 * worker handoff as a log the user picked — the samples exercise the real
 * path, not a shortcut around it.
 *
 * Renders nothing while `SAMPLES` is empty (WP-06 fills it), so the shell
 * never advertises samples it cannot load.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SAMPLES, SAMPLES_BASE_PATH, type SampleSession } from '../../config/samples'
import { useFormatters } from '../../i18n/formatters'
import { createLogger } from '../../lib/logger'
import { useSessions } from '../../state/sessions-context'
import { Badge, type BadgeTone } from '../../ui/Badge'
import { SectionTitle, SheetRule, SheetSection } from '../../ui/Sheet'

const log = createLogger('samples')

export function SampleList() {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const { analyze, busy } = useSessions()
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  if (SAMPLES.length === 0) return null

  async function load(sample: SampleSession) {
    setLoadingId(sample.id)
    setFailed(false)
    try {
      const response = await fetch(`${SAMPLES_BASE_PATH}${sample.file}`)
      if (!response.ok) throw new Error(`sample responded ${response.status}`)
      const blob = await response.blob()
      analyze(new File([blob], sample.file, { type: 'application/jsonl' }))
    } catch (error) {
      log.error('sample load failed', error instanceof Error ? error.name : typeof error)
      setFailed(true)
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <>
      <SheetRule />
      <SheetSection className="flex flex-col gap-3">
        <SectionTitle>{t('samples.title')}</SectionTitle>
        <ul className="grid gap-0 sm:grid-cols-3">
          {SAMPLES.map((sample, index) => (
            <li
              key={sample.id}
              className={`border-line-soft ${
                index > 0 ? 'border-t pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-5' : ''
              } ${index < SAMPLES.length - 1 ? 'pb-3 sm:pr-5 sm:pb-0' : ''}`}
            >
              <button
                type="button"
                disabled={busy || loadingId !== null}
                onClick={() => void load(sample)}
                className="flex w-full flex-col gap-1.5 rounded-[6px] p-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex items-baseline justify-between gap-2.5">
                  <span className="text-[13.5px] font-semibold">{t(sample.nameKey)}</span>
                  <LessonBadge sample={sample} />
                </span>
                <span className="font-mono text-[10.5px] text-slate-400">
                  {t('samples.meta', {
                    requests: fmt.integer(sample.requestCount),
                    span: fmt.duration(sample.spanMs),
                    hitRate: fmt.percent(sample.cacheHitRate),
                  })}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {failed && (
          <p role="alert" className="text-[12px] text-red-ink">
            {t('samples.loadFailed')}
          </p>
        )}
      </SheetSection>
    </>
  )
}

const LESSON_TONES: Record<SampleSession['lesson'], BadgeTone> = {
  'five-minute-wins': 'neutral',
  'one-hour-wins': 'primary',
  'hard-resets': 'indigo',
}

function LessonBadge({ sample }: { sample: SampleSession }) {
  const { t } = useTranslation()
  const label =
    sample.lesson === 'five-minute-wins'
      ? t('samples.badge5m')
      : sample.lesson === 'one-hour-wins'
        ? t('samples.badge1h')
        : t('samples.badgeResets', { count: sample.hardResets ?? 0 })
  return <Badge tone={LESSON_TONES[sample.lesson]}>{label}</Badge>
}
