/**
 * One row in the sidebar's session list. There is no separate history table —
 * the sidebar is the history (WP-D), so a row has to carry the whole summary:
 * which session, which project, the verdict, and — while it is running — its
 * progress.
 *
 * The active row is tinted rather than given a left accent bar, so the list
 * stays a flat column of equal-width rows at any translation length.
 */

import { useTranslation } from 'react-i18next'

import { useFormatters } from '../i18n/formatters'
import type { SessionEntry } from '../state/session-store'
import { headlineVerdict, progressRatio, projectLabel, shortSessionId } from './session-display'

export function SessionRow({
  entry,
  active,
  onSelect,
}: {
  entry: SessionEntry
  active: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const fmt = useFormatters()

  const ratio = progressRatio(entry)
  const verdict = headlineVerdict(entry)
  const project = projectLabel(entry)
  const analyzing = entry.status.phase === 'analyzing'

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={`flex w-full flex-col gap-1 rounded-[6px] px-[10px] py-2 text-left transition-colors ${
          active ? 'bg-primary-tint' : 'hover:bg-ground'
        }`}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate font-mono text-[13.5px] ${
              active ? 'font-medium text-primary' : 'text-ink'
            }`}
          >
            {shortSessionId(entry)}
          </span>
          <span className="shrink-0 font-mono text-[11.5px] font-semibold">
            {analyzing ? (
              <span className={active ? 'text-primary' : 'text-slate-500'}>
                {ratio === null ? '' : fmt.percent(ratio)}
              </span>
            ) : verdict ? (
              <span className="text-green">{fmt.currency(verdict.savingsUsd)}</span>
            ) : (
              <StatusMark entry={entry} />
            )}
          </span>
        </span>

        {analyzing ? (
          <span
            className="block h-[3px] overflow-hidden rounded-[2px] bg-[#D6E3FB]"
            role="progressbar"
            aria-label={t('status.analyzing')}
            aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span
              className="block h-full bg-primary transition-[width] duration-200"
              style={{ width: `${(ratio ?? 0) * 100}%` }}
            />
          </span>
        ) : (
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={`truncate font-mono text-[11.5px] ${
                active ? 'text-[#6B87B8]' : 'text-slate-400'
              }`}
            >
              {project ?? entry.fileName}
            </span>
            {verdict && (
              <span
                className={`shrink-0 font-mono text-[11.5px] ${
                  active ? 'text-primary' : 'text-slate-500'
                }`}
              >
                {verdict.ttl}
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  )
}

/**
 * What the money column shows when there is no saving to show. The column is
 * about 40px wide, so a state is a mark plus a screen-reader label rather than
 * a word no translation would fit.
 */
function StatusMark({ entry }: { entry: SessionEntry }) {
  const { t } = useTranslation()
  switch (entry.status.phase) {
    case 'rejected':
      return <Mark symbol="!" tone="text-red" label={t('rejected.title')} />
    case 'failed':
      return <Mark symbol="!" tone="text-red" label={t('status.failed')} />
    case 'cancelled':
      return <Mark symbol="—" tone="text-slate-400" label={t('status.cancelled')} />
    default:
      return null
  }
}

function Mark({ symbol, tone, label }: { symbol: string; tone: string; label: string }) {
  return (
    <span className={tone}>
      <span aria-hidden="true">{symbol}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}
