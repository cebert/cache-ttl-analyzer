/**
 * What this analysis does not know, stated on the same page as the verdict
 * rather than behind a link.
 *
 * Two of these are required disclosures: the all-or-nothing expiry
 * approximation and its direction (feasibility §7, read from
 * `result.approximation` rather than restated here), and — when the file
 * carried no sidechain traffic, which is every modern main-session upload —
 * the fact that `subagentPromptCacheTtl` was not evaluated at all. WP-08's
 * plan is explicit that silence there reads as a claim the tool never made.
 */

import { useTranslation } from 'react-i18next'

import type { AnalysisResult } from '../../engine/contract'
import { useFormatters } from '../../i18n/formatters'
import { Eyebrow } from '../../ui/Sheet'
import { bucketFor } from './derive'

export function LimitsPanel({ result }: { result: AnalysisResult }) {
  const { t } = useTranslation()
  const fmt = useFormatters()

  const main = bucketFor(result, 'main')
  const hasSubagent = bucketFor(result, 'subagent') !== null
  const { unknownModels } = result

  const limits: string[] = []
  if (!hasSubagent) limits.push(t('results.limits.noSidechain'))
  limits.push(
    main?.configExplicitness === 'provably-explicit'
      ? t('results.limits.provablyExplicit')
      : t('results.limits.observedNotConfigured'),
  )
  limits.push(t('results.limits.allOrNothing'))
  if (unknownModels.models.length > 0) {
    limits.push(
      t('results.limits.unknownModels', {
        count: unknownModels.excludedRequests,
        formatted: fmt.integer(unknownModels.excludedRequests),
        models: fmt.list(unknownModels.models),
      }),
    )
  }

  return (
    <div className="flex flex-col gap-2 bg-[#FBFCFE] px-5 py-4 sm:px-7">
      <Eyebrow>{t('results.limits.title')}</Eyebrow>
      <ul className="flex flex-col gap-1.5">
        {limits.map((limit) => (
          <li key={limit} className="text-[11.5px] leading-[1.55] text-slate-500">
            {limit}
          </li>
        ))}
      </ul>
    </div>
  )
}
