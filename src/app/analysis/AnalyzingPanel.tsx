/**
 * The in-flight screen: how far along, what stage, and a cancel that really
 * stops the work (the runner terminates the worker either way — see
 * `analysis-runner.ts`).
 *
 * The stage list is derived from the engine's own `phase`, not from a timer,
 * so it can never claim progress the engine has not made.
 */

import { useTranslation } from 'react-i18next'

import type { EngineProgress } from '../../engine/contract'
import { useFormatters } from '../../i18n/formatters'
import type { SessionEntry } from '../../state/session-store'
import { useSessions } from '../../state/sessions-context'
import { Button } from '../../ui/Button'
import { CheckCircleIcon, SpinnerIcon } from '../../ui/Icon'
import { Eyebrow, Micro, Sheet, SheetRule } from '../../ui/Sheet'

type StageState = 'done' | 'active' | 'pending'

export function AnalyzingPanel({ entry }: { entry: SessionEntry }) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const { cancel } = useSessions()

  const progress = entry.status.phase === 'analyzing' ? entry.status.progress : null
  const ratio = ratioOf(progress)
  const parsing = progress === null || progress.phase === 'parsing'

  return (
    <div className="flex justify-center px-4 py-8 sm:px-6 sm:py-14">
      <Sheet className="w-full max-w-[560px]">
        <div className="flex flex-col gap-4 p-5 sm:gap-[18px] sm:px-[26px] sm:pt-6">
          <div className="flex items-baseline justify-between gap-5">
            <Eyebrow>{parsing ? t('analyzing.stepDedup') : t('analyzing.stepReplay')}</Eyebrow>
            <span className="font-mono text-[26px] leading-none font-medium tracking-[-0.025em] text-primary">
              {ratio === null ? '' : fmt.percent(ratio)}
            </span>
          </div>

          <div className="flex flex-col gap-[7px]">
            <div
              className="h-1.5 overflow-hidden rounded-[3px] bg-line-soft"
              role="progressbar"
              aria-label={t('analyzing.title')}
              aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-[3px] bg-primary transition-[width] duration-200"
                style={{ width: `${(ratio ?? 0) * 100}%` }}
              />
            </div>
            <div className="flex items-baseline justify-between gap-4 font-mono text-[11px] text-slate-400">
              <span>
                {progress
                  ? t('analyzing.bytesProgress', {
                      done: fmt.bytes(progress.bytesProcessed),
                      total: fmt.bytes(progress.totalBytes),
                    })
                  : t('analyzing.starting')}
              </span>
              {progress && (
                <span>{t('analyzing.requestsSeen', { count: progress.requestsSeen })}</span>
              )}
            </div>
          </div>
        </div>

        <SheetRule />

        <ol className="flex flex-col gap-2.5 p-5 sm:px-[26px]">
          <Stage state={progress ? 'done' : 'active'} label={t('analyzing.stepStream')} />
          <Stage state={parsing ? 'active' : 'done'} label={t('analyzing.stepDedup')} />
          <Stage state={parsing ? 'pending' : 'active'} label={t('analyzing.stepPrice')} />
          <Stage state={parsing ? 'pending' : 'active'} label={t('analyzing.stepReplay')} />
        </ol>

        <SheetRule />

        <div className="flex flex-wrap items-center justify-between gap-4 bg-[#FBFCFE] p-4 sm:px-[26px] sm:py-3">
          <Micro className="text-[11px]">{t('analyzing.workerNote')}</Micro>
          <Button size="sm" onClick={cancel}>
            {t('analyzing.cancel')}
          </Button>
        </div>
      </Sheet>
    </div>
  )
}

function Stage({ state, label }: { state: StageState; label: string }) {
  return (
    <li className="flex items-center gap-2.5">
      {state === 'done' ? (
        <CheckCircleIcon size={15} strokeWidth={2} className="shrink-0 text-green" />
      ) : state === 'active' ? (
        // The design bans decorative motion; this rotation is the one piece of
        // feedback that the stage is working, and it yields to reduced-motion.
        <SpinnerIcon
          size={15}
          strokeWidth={2}
          className="shrink-0 text-primary motion-safe:animate-spin"
        />
      ) : (
        <span className="size-[15px] shrink-0 rounded-full border-[1.6px] border-line" />
      )}
      <span
        className={`text-[12.5px] ${
          state === 'active'
            ? 'font-semibold text-ink'
            : state === 'done'
              ? 'text-ink-2'
              : 'text-slate-400'
        }`}
      >
        {label}
      </span>
    </li>
  )
}

function ratioOf(progress: EngineProgress | null): number | null {
  if (!progress || progress.totalBytes <= 0) return null
  return Math.min(1, Math.max(0, progress.bytesProcessed / progress.totalBytes))
}
