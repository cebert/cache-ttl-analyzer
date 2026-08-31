/**
 * The seam WP-08 fills in. The engine has already produced a complete
 * `AnalysisResult` by the time this renders; the shell's job was to get it
 * here, and the results view — identification card, verdict band, cost
 * comparison, cache timeline — is the next work package.
 *
 * It shows the one thing the shell can honestly show without pre-empting that
 * design: the verdict the engine reached, the parse warnings, and the
 * "prices as of" date every dollar figure has to carry (decision D5).
 */

import { useTranslation } from 'react-i18next'

import type { AnalysisResult } from '../../engine/contract'
import { useFormatters } from '../../i18n/formatters'
import { Micro, Sheet, SheetRule, SheetSection } from '../../ui/Sheet'
import { bucketOf } from '../session-display'
import { WarningsBanner } from './WarningsBanner'

export function ResultPlaceholder({ result }: { result: AnalysisResult }) {
  const { t } = useTranslation()
  const fmt = useFormatters()

  const main = bucketOf(result, 'main')
  const verdict =
    !main || main.verdictSuppressed || main.recommendation === 'no-verdict'
      ? t('results.recommendationNone')
      : main.recommendation === '1h'
        ? t('results.recommendation1h')
        : t('results.recommendation5m')

  return (
    <div className="flex flex-col gap-3.5 px-4 py-5 sm:px-6 sm:pb-8">
      <WarningsBanner warnings={result.parseWarnings} />

      <Sheet>
        <div className="border-b border-[#E1E9F8] bg-verdict px-5 py-6 sm:px-7">
          <p className="text-[32px] leading-[1.08] font-semibold tracking-[-0.032em] text-balance sm:text-[42px]">
            {verdict}
          </p>
          <Micro className="pt-2">
            {t('results.pricesAsOf', { date: fmt.date(result.pricesAsOf) })}
          </Micro>
        </div>
        <SheetRule />
        <SheetSection className="flex flex-col gap-1">
          <h2 className="text-[12.5px] font-semibold">{t('results.pendingTitle')}</h2>
          <Micro>{t('results.pendingBody')}</Micro>
        </SheetSection>
      </Sheet>
    </div>
  )
}
