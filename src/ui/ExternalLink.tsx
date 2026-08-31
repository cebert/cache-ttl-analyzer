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

export const REPO_URL = 'https://github.com/cebert/cache-ttl-analyzer'
export const AUTHOR_BLOG_URL = 'https://chrisebert.net'
export const AUTHOR_X_URL = 'https://x.com/realchrisebert'
export const CLAUDE_CODE_DOCS_URL = 'https://docs.claude.com/en/docs/claude-code'

/**
 * Vendor documentation on prompt-cache TTL, for the About page's references.
 * Every URL was fetched and returned 200 on 2026-08-30; the legacy hosts
 * (docs.anthropic.com, cloud.google.com/vertex-ai, platform.openai.com) all
 * redirect to these, so these are the destinations, not the old paths.
 */
export const VENDOR_DOCS = {
  claudeCodeCaching: 'https://code.claude.com/docs/en/prompt-caching',
  anthropicCaching: 'https://platform.claude.com/docs/en/build-with-claude/prompt-caching',
  anthropicPricing: 'https://platform.claude.com/docs/en/about-claude/pricing',
  bedrockCaching: 'https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html',
  googleCaching:
    'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/prompt-caching',
  openaiCaching: 'https://developers.openai.com/api/docs/guides/prompt-caching',
} as const
