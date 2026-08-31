/**
 * An outbound link. `noreferrer` is not just hygiene here: the app promises it
 * leaks nothing, and a referrer header would quietly tell the destination
 * which page of this tool the reader came from.
 */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary hover:text-primary-strong hover:underline"
    >
      {children}
      <span className="sr-only"> ({t('common.externalLink')})</span>
      <span aria-hidden="true"> ↗</span>
    </a>
  )
}
