/**
 * What the user sees when a pre-flight check stops a file. A blocking issue
 * states the limit and the file's actual size, because "too large" without a
 * number leaves the user guessing; an advisory issue offers to proceed.
 */

import { useTranslation } from 'react-i18next'

import { useFormatters } from '../../i18n/formatters'
import { useSessions } from '../../state/sessions-context'
import { Button } from '../../ui/Button'
import { AlertCircleIcon } from '../../ui/Icon'

export function FileIssueNotice() {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const { fileIssue, acceptFileIssue, dismissFileIssue } = useSessions()

  if (!fileIssue) return null
  const { issue } = fileIssue

  const message =
    issue.kind === 'too-large'
      ? t('uploadError.tooLarge', {
          size: fmt.bytes(issue.sizeBytes),
          limit: fmt.bytes(issue.limitBytes),
        })
      : issue.kind === 'empty'
        ? t('uploadError.empty')
        : t('uploadError.wrongType', { name: issue.fileName })

  const tone =
    issue.severity === 'blocking'
      ? 'border-[#F3CFCF] bg-red-tint text-red-ink'
      : 'border-[#F0DFC2] bg-amber-tint text-amber-ink'

  return (
    <div
      role="alert"
      className={`mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-[7px] border px-[13px] py-2 text-[12px] ${tone}`}
    >
      <AlertCircleIcon size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      {issue.severity === 'advisory' && (
        <Button size="sm" onClick={acceptFileIssue}>
          {t('uploadError.addAnyway')}
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={dismissFileIssue}>
        {t('uploadError.dismiss')}
      </Button>
    </div>
  )
}
