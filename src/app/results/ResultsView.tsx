/**
 * WP-08 — the results view. One sheet per region, in the order WP-D fixed:
 * verdict → totals → identification → cache behaviour → limits.
 *
 * The headline speaks for the main conversation bucket (`promptCacheTtl`),
 * which is what a session upload actually contains (contract F2). A file that
 * is itself a subagent transcript has an empty main bucket, so the view falls
 * back to the bucket that has the traffic rather than showing an empty
 * verdict for the one that does not.
 */

import { useTranslation } from 'react-i18next'

import type { AnalysisResult } from '../../engine/contract'
import { Sheet, SheetRule } from '../../ui/Sheet'
import { ExternalLink } from '../../ui/ExternalLink'
import { REPO_URL } from '../../ui/links'
import { WarningsBanner } from '../analysis/WarningsBanner'
import { ROUTES } from '../routes'
import { CacheTimeline } from './CacheTimeline'
import { LimitsPanel } from './LimitsPanel'
import { MetricsRow } from './MetricsRow'
import { SessionDetails } from './SessionDetails'
import { VerdictBand } from './VerdictBand'
import { mainBucket, subagentBucket } from './results-model'
import { useNavigate } from 'react-router'

/** Where the "how do I set this?" link goes. */
const PROMPT_CACHE_TTL_DOCS =
  'https://docs.claude.com/en/docs/claude-code/settings#environment-variables'

export function ResultsView({ result }: { result: AnalysisResult }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const main = mainBucket(result)
  const subagents = subagentBucket(result)
  // A subagent transcript uploaded on its own: the traffic is all sidechain,
  // so the headline speaks for that bucket instead of an empty main one.
  const headline = main && main.requestCount > 0 ? main : (subagents ?? main)

  return (
    <div className="flex flex-col gap-3.5 px-4 py-5 sm:px-6 sm:pb-8">
      <WarningsBanner warnings={result.parseWarnings} />

      <Sheet>
        {headline && (
          <>
            <VerdictBand
              bucket={headline}
              pricesAsOf={result.pricesAsOf}
              onWhy={() => void navigate(ROUTES.dataPolicy)}
            />
            <MetricsRow bucket={headline} stats={result.parseStats} />
            <SheetRule />
          </>
        )}
        <SessionDetails result={result} bucket={headline ?? result.buckets[0]} />
        {headline && (
          <>
            <SheetRule />
            <CacheTimeline result={result} bucket={headline} />
          </>
        )}
        <SheetRule />
        <LimitsPanel result={result} />
      </Sheet>

      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-0.5">
        <p className="text-[12.5px] leading-[1.5] text-slate-500">{t('results.footerPrivacy')}</p>
        <div className="flex flex-wrap items-center gap-4 text-[13px]">
          <ExternalLink href={PROMPT_CACHE_TTL_DOCS}>{t('results.footerHowTo')}</ExternalLink>
          <ExternalLink href={REPO_URL}>{t('results.footerSource')}</ExternalLink>
        </div>
      </div>
    </div>
  )
}
