/**
 * What the tool does, how it does it, and — the part that matters most for
 * trust — what it approximates. The API-rates framing (decision D2) is stated
 * here in full; the results screen carries the one-line version.
 */

import { useTranslation } from 'react-i18next'

import {
  AUTHOR_BLOG_URL,
  AUTHOR_X_URL,
  ExternalLink,
  REPO_URL,
  VENDOR_DOCS,
} from '../../ui/ExternalLink'
import { ContentPage, Prose } from './ContentPage'

export function AboutPage() {
  const { t } = useTranslation()
  return (
    <ContentPage title={t('about.title')} lead={t('about.lead')}>
      <Prose heading={t('about.whyTitle')} first>
        <p>{t('about.whyBody')}</p>
      </Prose>
      <Prose heading={t('about.howTitle')}>
        <p>{t('about.howBody')}</p>
      </Prose>
      <Prose heading={t('about.costTitle')}>
        <p>{t('about.costBody')}</p>
      </Prose>
      <Prose heading={t('about.limitsTitle')}>
        <p>{t('about.limitsBody')}</p>
      </Prose>
      <Prose heading={t('about.monitorTitle')}>
        <p>{t('about.monitorBody')}</p>
      </Prose>
      <Prose heading={t('about.referencesTitle')}>
        <p>{t('about.referencesBody')}</p>
        <ul className="flex flex-col gap-3">
          <Reference href={VENDOR_DOCS.claudeCodeCaching} label={t('about.refClaudeCode')}>
            {t('about.refClaudeCodeNote')}
          </Reference>
          <Reference href={VENDOR_DOCS.anthropicCaching} label={t('about.refAnthropic')}>
            {t('about.refAnthropicNote')}
          </Reference>
          <Reference href={VENDOR_DOCS.anthropicPricing} label={t('about.refAnthropicPricing')}>
            {t('about.refAnthropicPricingNote')}
          </Reference>
          <Reference href={VENDOR_DOCS.bedrockCaching} label={t('about.refBedrock')}>
            {t('about.refBedrockNote')}
          </Reference>
          <Reference href={VENDOR_DOCS.googleCaching} label={t('about.refGoogle')}>
            {t('about.refGoogleNote')}
          </Reference>
          <Reference href={VENDOR_DOCS.openaiCaching} label={t('about.refOpenai')}>
            {t('about.refOpenaiNote')}
          </Reference>
        </ul>
      </Prose>
      <Prose heading={t('about.authorTitle')}>
        <p>{t('about.authorBody')}</p>
        <p className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <ExternalLink href={AUTHOR_BLOG_URL}>{t('about.authorBlog')}</ExternalLink>
          <ExternalLink href={AUTHOR_X_URL}>{t('about.authorX')}</ExternalLink>
          <ExternalLink href={REPO_URL}>{t('about.sourceLink')}</ExternalLink>
        </p>
      </Prose>
    </ContentPage>
  )
}

/**
 * One vendor reference: the link, then what that page actually says about TTL.
 * The note is the useful half — a bare list of links makes the reader go find
 * out whether the verdict above even applies to their provider.
 */
function Reference({
  href,
  label,
  children,
}: {
  href: string
  label: string
  children: React.ReactNode
}) {
  return (
    <li className="flex flex-col gap-0.5">
      <ExternalLink href={href}>{label}</ExternalLink>
      <span className="text-slate-500">{children}</span>
    </li>
  )
}
