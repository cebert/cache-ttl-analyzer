/**
 * What the tool does, how it does it, and — the part that matters most for
 * trust — what it approximates. The API-rates framing (decision D2) is stated
 * here in full; the results screen carries the one-line version.
 */

import { useTranslation } from 'react-i18next'

import { ExternalLink, REPO_URL } from '../../ui/ExternalLink'
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
      <Prose heading={t('app.name')}>
        <p>
          <ExternalLink href={REPO_URL}>{t('about.sourceLink')}</ExternalLink>
        </p>
      </Prose>
    </ContentPage>
  )
}
