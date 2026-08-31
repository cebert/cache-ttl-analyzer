/**
 * The "valid with warnings" verdict, surfaced above the results rather than
 * buried in them: a skipped record or an unpriced model changes what the
 * numbers mean, so the user has to see it without going looking.
 *
 * Each `ParseWarning` variant gets its own sentence — a generic "there were
 * warnings" would tell the user nothing they can act on.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ParseWarning } from '../../engine/contract'
import { useFormatters } from '../../i18n/formatters'
import { AlertCircleIcon } from '../../ui/Icon'

export function WarningsBanner({ warnings }: { warnings: readonly ParseWarning[] }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const sentences = useWarningSentences(warnings)
  if (sentences.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5 rounded-[7px] border border-[#F0DFC2] bg-amber-tint px-[13px] py-2 text-[12px] text-amber-ink">
      <div className="flex items-center gap-2.5">
        <AlertCircleIcon size={14} className="shrink-0 text-amber" />
        <span className="min-w-0 flex-1">{sentences[0]}</span>
        {sentences.length > 1 && (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="shrink-0 text-[12px] text-[#B4830E] hover:underline"
          >
            {expanded ? t('warnings.hide') : t('warnings.details')}
          </button>
        )}
      </div>
      {expanded && sentences.length > 1 && (
        <ul className="flex list-disc flex-col gap-1 pl-[38px]">
          {sentences.slice(1).map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function useWarningSentences(warnings: readonly ParseWarning[]): string[] {
  const { t } = useTranslation()
  const fmt = useFormatters()

  return warnings.map((warning) => {
    switch (warning.kind) {
      case 'skipped-record-types': {
        const count = Object.values(warning.types).reduce((sum, n) => sum + n, 0)
        return t('warnings.skippedRecordTypes', { count })
      }
      case 'malformed-lines':
        return t('warnings.malformedLines', { count: warning.count })
      case 'invalid-usage-rows':
        return t('warnings.invalidUsageRows', { count: warning.count })
      case 'line-length-cap-exceeded':
        return t('warnings.lineLengthCap', { count: warning.count })
      case 'version-out-of-range':
        return t('warnings.versionOutOfRange', { versions: fmt.list(warning.versions) })
      case 'unknown-models':
        return t('warnings.unknownModels', { models: fmt.list(warning.models) })
    }
  })
}
