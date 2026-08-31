/**
 * What the tool does, how it does it, and — the part that matters most for
 * trust — what it approximates. The API-rates framing (decision D2) is stated
 * here in full; the results screen carries the one-line version.
 */

import { useTranslation } from 'react-i18next'

import { AUTHOR_BLOG_URL, AUTHOR_X_URL, ExternalLink, REPO_URL } from '../../ui/ExternalLink'
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
