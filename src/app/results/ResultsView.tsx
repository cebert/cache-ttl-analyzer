/**
 * The results screen (WP-08), one sheet per WP-D: verdict band, headline
 * metrics, identification, cache behaviour, limits.
 *
 * The sheet is built per bucket. "main" (`promptCacheTtl`) is always there;
 * a file that also carried sidechain traffic gets a second, identically
 * shaped sheet for `subagentPromptCacheTtl`, because the two settings are
 * configured separately and a reader who has both needs both verdicts.
 *
 * If the engine produced no main bucket at all there is nothing honest to
 * render, so the warnings stand alone rather than being framed by an empty
 * verdict.
 */

import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'

import type { AnalysisResult, BucketAnalysis } from '../../engine/contract'
import { ExternalLink, REPO_URL } from '../../ui/ExternalLink'
import { Micro, Sheet, SheetRule } from '../../ui/Sheet'
import { ROUTES } from '../routes'
import { WarningsBanner } from '../analysis/WarningsBanner'
import { CacheTimeline } from './CacheTimeline'
import { LimitsPanel } from './LimitsPanel'
import { MetricsRow } from './MetricsRow'
import { SessionDetails } from './SessionDetails'
import { VerdictBand } from './VerdictBand'
import { bucketFor } from './derive'

export function ResultsView({ result }: { result: AnalysisResult }) {
  const { t } = useTranslation()

  const main = bucketFor(result, 'main')
  const subagent = bucketFor(result, 'subagent')

  return (
    <div className="flex flex-col gap-3.5 px-4 py-5 sm:px-6 sm:pb-8">
      <WarningsBanner warnings={result.parseWarnings} />

      {main && <BucketSheet result={result} bucket={main} />}

      {subagent && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[13px] font-semibold">{t('results.subagentTitle')}</h2>
            <Micro>{t('results.subagentLead')}</Micro>
          </div>
          <BucketSheet result={result} bucket={subagent} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-0.5">
        <Micro className="text-[11px]">{t('results.footer.privacy')}</Micro>
        <div className="flex items-center gap-4 text-[12px]">
          <Link to={ROUTES.about} className="text-primary hover:underline">
            {t('results.footer.about')}
          </Link>
          <ExternalLink href={REPO_URL}>{t('results.footer.source')}</ExternalLink>
        </div>
      </div>
    </div>
  )
}

function BucketSheet({ result, bucket }: { result: AnalysisResult; bucket: BucketAnalysis }) {
  return (
    <Sheet>
      <VerdictBand result={result} bucket={bucket} />
      <MetricsRow result={result} bucket={bucket} />
      <SheetRule />
      <SessionDetails result={result} bucket={bucket} />
      <SheetRule />
      <CacheTimeline result={result} bucket={bucket} />
      <SheetRule />
      <LimitsPanel result={result} />
    </Sheet>
  )
}
