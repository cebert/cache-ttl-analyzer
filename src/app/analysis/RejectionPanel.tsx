/**
 * The third validation verdict: this file is not a session log (docs/PLAN.md
 * §2). It gets a plain-language explanation and a way forward, never a
 * garbage analysis — which is the whole point of the verdict existing.
 *
 * The engine's `reason` is a code, not prose, so the copy stays translatable.
 * An unrecognized code falls back to the more general of the two messages
 * rather than rendering the raw code at the user.
 */

import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { useFormatters } from '../../i18n/formatters'
import type { SessionEntry } from '../../state/session-store'
import { useSessions } from '../../state/sessions-context'
import { Button } from '../../ui/Button'
import { AlertCircleIcon } from '../../ui/Icon'
import { Micro, Sheet, SheetRule } from '../../ui/Sheet'
import { ROUTES } from '../routes'

export function RejectionPanel({ entry }: { entry: SessionEntry }) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const { select } = useSessions()

  if (entry.status.phase !== 'rejected') return null
  const { reason, stats } = entry.status

  const explanation =
    reason === 'malformed-lines-exceed-threshold'
      ? t('rejected.malformedLines')
      : t('rejected.noAssistantUsage')

  return (
    <div className="flex justify-center px-4 py-8 sm:px-6 sm:py-14">
      <Sheet className="w-full max-w-[560px]">
        <div className="flex flex-col gap-3 p-5 sm:px-[26px] sm:pt-6">
          <div className="flex items-center gap-2.5">
            <AlertCircleIcon size={18} className="shrink-0 text-red" />
            <h2 className="text-[17px] font-semibold tracking-[-0.015em]">{t('rejected.title')}</h2>
          </div>
          <p className="text-[13.5px] leading-[1.55] text-ink-2">{explanation}</p>
          <Micro className="font-mono text-[11px]">
            {t('rejected.linesScanned', {
              lines: fmt.integer(stats.nonEmptyLines),
            })}
          </Micro>
        </div>

        <SheetRule />

        <div className="flex flex-wrap items-center gap-3 p-4 sm:px-[26px]">
          <Button variant="primary" size="sm" onClick={() => select(null)}>
            {t('rejected.tryAnother')}
          </Button>
          <Link to={ROUTES.findLogs} className="text-[12px] text-primary hover:underline">
            {t('rejected.whereAreLogs')}
          </Link>
        </div>
      </Sheet>
    </div>
  )
}
