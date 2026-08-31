/**
 * The main pane. Which of the five states it shows is a function of the
 * selected session's status alone — there is no separate screen-level state to
 * drift out of sync with the worker.
 *
 * Nothing selected is the upload screen, which is also the landing page.
 */

import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'

import { useFormatters } from '../../i18n/formatters'
import { useSessions } from '../../state/sessions-context'
import { BackButton, MainPane, TopBar } from '../Shell'
import { AnalyzingPanel } from '../analysis/AnalyzingPanel'
import { RejectionPanel } from '../analysis/RejectionPanel'
import { ResultsView } from '../results/ResultsView'
import { CancelledPanel, FailurePanel } from '../analysis/StatusPanel'
import { ROUTES } from '../routes'
import { sessionTitle, shortSessionId } from '../session-display'
import { useGoHome } from '../use-go-home'
import { UploadScreen } from './UploadScreen'

export function AnalyzePage() {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const navigate = useNavigate()
  const { selected } = useSessions()
  const goHome = useGoHome()

  if (!selected) {
    return (
      <>
        <TopBar title={t('app.title')} />
        <MainPane>
          <UploadScreen onWhereAreLogs={() => void navigate(ROUTES.findLogs)} />
        </MainPane>
      </>
    )
  }

  const title =
    selected.status.phase === 'analyzing'
      ? t('analyzing.title')
      : (sessionTitle(selected) ?? shortSessionId(selected))
  // Opening a session pushes no history entry, so the browser's Back button
  // leaves the site. Every width gets an explicit way back instead: in the
  // top bar on desktop, and above the content where there is no top bar.
  const back = { label: t('nav.backToUpload'), onClick: goHome }

  return (
    <>
      <TopBar
        title={title}
        meta={t('analyzing.fileMeta', {
          name: selected.fileName,
          size: fmt.bytes(selected.fileSizeBytes),
        })}
        back={back}
      />
      <MainPane>
        <div className="border-b border-line bg-surface px-3 py-1.5 md:hidden">
          <BackButton {...back} />
        </div>
        {selected.status.phase === 'analyzing' && <AnalyzingPanel entry={selected} />}
        {selected.status.phase === 'rejected' && <RejectionPanel entry={selected} />}
        {selected.status.phase === 'cancelled' && <CancelledPanel />}
        {selected.status.phase === 'failed' && <FailurePanel code={selected.status.code} />}
        {selected.status.phase === 'complete' && <ResultsView result={selected.status.result} />}
      </MainPane>
    </>
  )
}
