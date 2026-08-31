/**
 * What this analysis does not claim (docs/PLAN.md §3, §7). The sidechain line
 * is the load-bearing one: on modern Claude Code every main-session upload
 * contains no subagent traffic (contract F2), so the tool has to say it
 * evaluated `promptCacheTtl` only — silently omitting a subagent section
 * would let the page imply it had checked.
 */

import { useTranslation } from 'react-i18next'

import type { AnalysisResult } from '../../engine/contract'
import { useFormatters } from '../../i18n/formatters'
import { Eyebrow, Micro } from '../../ui/Sheet'
import { mainBucket, subagentBucket } from './results-model'

export function LimitsPanel({ result }: { result: AnalysisResult }) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const subagents = subagentBucket(result)
  // A subagent transcript uploaded on its own has no main traffic at all, and
  // the view headlines its bucket — so it is fully analyzed, and saying
  // "the main conversation only" would be wrong.
  const subagentOnly = subagents !== null && (mainBucket(result)?.requestCount ?? 0) === 0
  const { unknownModels } = result

  return (
    <div className="flex flex-col gap-1.5 bg-[#fbfcfe] px-5 py-4 sm:px-7">
      <Eyebrow>{t('results.limitsTitle')}</Eyebrow>
      <Micro>
        {subagents
          ? t(subagentOnly ? 'results.limitSubagentsOnly' : 'results.limitSubagentsPresent', {
              requests: fmt.integer(subagents.requestCount),
              threads: fmt.integer(subagents.threadCount),
            })
          : t('results.limitNoSidechains')}
      </Micro>
      <Micro>{t('results.limitObservedOnly')}</Micro>
      <Micro>{t('results.limitApproximation')}</Micro>
      {unknownModels.models.length > 0 && (
        <Micro>
          {t('results.limitUnknownModels', {
            models: fmt.list(unknownModels.models),
            requests: fmt.integer(unknownModels.excludedRequests),
          })}
        </Micro>
      )}
    </div>
  )
}
