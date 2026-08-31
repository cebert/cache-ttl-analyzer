/**
 * Where session logs live, one block per platform.
 *
 * The earlier version stacked two bare paths and then explained the macOS
 * hidden-folder problem, the Finder shortcut and the Windows caveat in a run
 * of footnotes below both — so a Windows reader had to skip macOS advice and
 * a macOS reader had to find the one keystroke that matters inside a
 * paragraph. Each platform now owns its path, its way in, and its caveat, and
 * every keystroke is drawn as a key (`Kbd`) rather than written inline.
 *
 * The subagent note matters more than it looks: on Claude Code 2.1.251 a
 * subagent's traffic is in a separate file (contract finding F2), so a user
 * who wants those analyzed has to upload them individually — and a user who
 * does not know that would read "no subagent traffic" as a bug.
 */

import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { createLogger } from '../lib/logger'
import { CLAUDE_CODE_DOCS_URL, ExternalLink } from '../ui/ExternalLink'
import { CheckCircleIcon, CopyIcon } from '../ui/Icon'
import { Kbd } from '../ui/Kbd'
import { Eyebrow, Micro, SectionTitle } from '../ui/Sheet'

const log = createLogger('find-logs')

/**
 * Keystrokes come from the catalog as `<kbd>` tags inside a `<keys>` run.
 *
 * The `<keys>` wrapper is what stops a chord splitting across a line break —
 * without it a narrow column renders "press ⌘" and leaves "⇧ G" on the next
 * line, which is exactly the sequence the reader has to type as one thing.
 */
const KBD_COMPONENTS = {
  kbd: <Kbd />,
  keys: <span className="inline-flex items-center whitespace-nowrap" />,
}

const PLATFORMS = ['mac', 'linux', 'windows'] as const
type Platform = (typeof PLATFORMS)[number]

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
    <div className="flex flex-col gap-5">
      {!hideTitle && <SectionTitle>{t('findLogs.title')}</SectionTitle>}

      <div className="grid gap-5 lg:grid-cols-3 lg:gap-0">
        {PLATFORMS.map((platform, index) => (
          <div
            key={platform}
            className={`border-line-soft ${
              index > 0 ? 'border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6' : ''
            } ${index < PLATFORMS.length - 1 ? 'lg:pr-6' : ''}`}
          >
            <PlatformBlock platform={platform} />
          </div>
        ))}
      </div>

      {detailed && (
        <div className="flex flex-col gap-4 border-t border-line-soft pt-4">
          <Note title={t('findLogs.fileNameTitle')}>{t('findLogs.fileNameBody')}</Note>
          <Note title={t('findLogs.subagentsTitle')}>{t('findLogs.subagentsNote')}</Note>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1.5 border-t border-line-soft pt-3.5">
        <Micro className="text-[12px]">{t('findLogs.retentionNote')}</Micro>
        <p className="text-[13px]">
          <ExternalLink href={CLAUDE_CODE_DOCS_URL}>{t('findLogs.docs')}</ExternalLink>
        </p>
      </div>
    </div>
  )
}

function Note({ title, children }: { title: string; children: string }) {
  return (
    <div className="flex flex-col gap-1">
      <SectionTitle>{title}</SectionTitle>
      <Micro className="text-[13px]">{children}</Micro>
    </div>
  )
}

function PlatformBlock({ platform }: { platform: Platform }) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col gap-2.5">
      <SectionTitle>{t(`findLogs.${platform}.name`)}</SectionTitle>

      <PathRow path={t(`findLogs.${platform}.path`)} />

      <ol className="flex flex-col gap-1.5">
        {(['step1', 'step2'] as const).map((step, index) => (
          <li key={step} className="flex gap-2 text-[13.5px] leading-[1.8] text-ink-2">
            <span
              aria-hidden="true"
              className="mt-[3px] flex size-[17px] shrink-0 items-center justify-center rounded-full bg-line-soft font-mono text-[11px] font-semibold text-slate-500"
            >
              {index + 1}
            </span>
            <span className="min-w-0">
              <Trans i18nKey={`findLogs.${platform}.${step}`} components={KBD_COMPONENTS} />
            </span>
          </li>
        ))}
      </ol>

      <Micro className="mt-auto pt-0.5 text-[12px] leading-[1.8]">
        <Trans i18nKey={`findLogs.${platform}.note`} components={KBD_COMPONENTS} />
      </Micro>
    </div>
  )
}

function PathRow({ path }: { path: string }) {
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
      <Eyebrow>{t('findLogs.pathEyebrow')}</Eyebrow>
      <div className="flex items-center gap-1.5 rounded-[6px] border border-line-soft bg-ground px-2.5 py-[7px]">
        <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[12.5px] whitespace-nowrap text-ink">
          {path}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className={`shrink-0 rounded-[4px] p-1 transition-colors ${
            copied ? 'text-green' : 'text-slate-400 hover:text-ink'
          }`}
        >
          {copied ? <CheckCircleIcon size={13} /> : <CopyIcon size={13} />}
          <span className="sr-only">{copied ? t('findLogs.copied') : t('findLogs.copyPath')}</span>
        </button>
      </div>
      <span aria-live="polite" className="sr-only">
        {copied ? t('findLogs.copied') : ''}
      </span>
    </div>
  )
}
