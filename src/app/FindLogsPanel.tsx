/**
 * Where session logs live. Shown compactly on the landing screen and in full
 * on its own page, from one source so the two can never disagree.
 *
 * The subagent note matters more than it looks: on Claude Code 2.1.251 a
 * subagent's traffic is in a separate file (contract finding F2), so a user
 * who wants those analyzed has to upload them individually — and a user who
 * does not know that would read "no subagent traffic" as a bug.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { createLogger } from '../lib/logger'
import { CLAUDE_CODE_DOCS_URL, ExternalLink } from '../ui/ExternalLink'
import { CopyIcon } from '../ui/Icon'
import { Micro, SectionTitle } from '../ui/Sheet'

const log = createLogger('find-logs')

export function FindLogsPanel({
  detailed = false,
  hideTitle = false,
}: {
  detailed?: boolean
  /** Set when the panel *is* the page, whose own heading already names it. */
  hideTitle?: boolean
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3">
      {!hideTitle && <SectionTitle>{t('findLogs.title')}</SectionTitle>}

      <div className="flex flex-col gap-2">
        <PathRow label={t('findLogs.macos')} path={t('findLogs.macosPath')} />
        <PathRow label={t('findLogs.windows')} path={t('findLogs.windowsPath')} />
      </div>

      <div className="flex flex-col gap-1">
        <Micro className="text-[11px]">{t('findLogs.projectNote')}</Micro>
        <Micro className="text-[11px]">{t('findLogs.configDirNote')}</Micro>
      </div>

      {detailed && (
        <div className="flex flex-col gap-1 border-t border-line-soft pt-3">
          <SectionTitle>{t('findLogs.subagentsTitle')}</SectionTitle>
          <Micro className="text-[12px]">{t('findLogs.subagentsNote')}</Micro>
        </div>
      )}

      <p className="text-[12px]">
        <ExternalLink href={CLAUDE_CODE_DOCS_URL}>{t('findLogs.docs')}</ExternalLink>
      </p>
    </div>
  )
}

function PathRow({ label, path }: { label: string; path: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      // Clipboard access can be denied outright; the path is on screen to be
      // selected by hand, so this is not worth an error state.
      log.warn('clipboard write failed', error instanceof Error ? error.name : typeof error)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] font-medium tracking-[0.07em] text-slate-400 uppercase">
        {label}
      </span>
      <div className="flex items-center gap-2 rounded-[6px] border border-line-soft bg-ground px-2.5 py-[7px]">
        <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[11.5px] whitespace-nowrap text-ink">
          {path}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="shrink-0 rounded-[4px] p-0.5 text-slate-400 hover:text-ink"
        >
          <CopyIcon size={13} />
          <span className="sr-only">{copied ? t('findLogs.copied') : t('findLogs.copyPath')}</span>
        </button>
        {copied && (
          <span aria-live="polite" className="shrink-0 text-[11px] text-green">
            {t('findLogs.copied')}
          </span>
        )}
      </div>
    </div>
  )
}
