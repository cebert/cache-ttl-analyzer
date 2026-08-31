/**
 * The two terminal states that are neither a result nor a rejection: the user
 * cancelled, or the run failed. Both say what happened and offer the way back
 * to the upload screen — an analysis that ends with no explanation and no next
 * step is the worst version of either.
 */

import { useTranslation } from 'react-i18next'

import type { AnalysisFailureCode } from '../../state/session-store'
import { useSessions } from '../../state/sessions-context'
import { Button } from '../../ui/Button'
import { AlertCircleIcon } from '../../ui/Icon'
import { Micro, Sheet } from '../../ui/Sheet'

export function CancelledPanel() {
  const { t } = useTranslation()
  return <StatusSheet title={t('status.cancelled')} body={t('status.cancelledHint')} />
}

export function FailurePanel({ code }: { code: AnalysisFailureCode }) {
  const { t } = useTranslation()
  const body =
    code === 'file-too-large'
      ? t('status.errorFileTooLarge')
      : code === 'read-failure'
        ? t('status.errorReadFailure')
        : t('status.errorInternal')
  // The underlying error message is deliberately not rendered: it can quote
  // file content, and the logger's sensitive-data rule applies to the screen
  // as much as to the console. It is in the debug log for troubleshooting.
  return <StatusSheet title={t('status.failed')} body={body} tone="error" />
}

function StatusSheet({
  title,
  body,
  tone = 'neutral',
}: {
  title: string
  body: string
  tone?: 'neutral' | 'error'
}) {
  const { t } = useTranslation()
  const { select } = useSessions()
  return (
    <div className="flex justify-center px-4 py-8 sm:px-6 sm:py-14">
      <Sheet className="w-full max-w-[560px]">
        <div className="flex flex-col gap-3 p-5 sm:px-[26px] sm:py-6">
          <div className="flex items-center gap-2.5">
            {tone === 'error' && <AlertCircleIcon size={18} className="shrink-0 text-red" />}
            <h2 className="text-[18px] font-semibold tracking-[-0.015em]">{title}</h2>
          </div>
          <Micro className="text-[13.5px]">{body}</Micro>
          <div>
            <Button variant="primary" size="sm" onClick={() => select(null)}>
              {t('status.startOver')}
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  )
}
