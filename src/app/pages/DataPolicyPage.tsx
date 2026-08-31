/**
 * The data policy page (docs/PLAN.md, D11). It is a first-class page rather
 * than a footer line because the privacy claim is a core product value, and
 * because it pre-commits the disclosure standard any future API-powered
 * feature would have to meet.
 *
 * Every claim here is one a reader can check: the CSP is visible in devtools,
 * the parser is in the repository, and the content-poison test that proves the
 * parser never reads message bodies runs in CI.
 */

import { useTranslation } from 'react-i18next'

import { ExternalLink } from '../../ui/ExternalLink'
import { REPO_URL } from '../../ui/links'
import { ContentPage, Prose } from './ContentPage'

export function DataPolicyPage() {
  const { t } = useTranslation()
  return (
    <ContentPage title={t('dataPolicy.title')} lead={t('dataPolicy.lead')}>
      <Prose heading={t('dataPolicy.localTitle')} first>
        <p>{t('dataPolicy.localBody')}</p>
      </Prose>
      <Prose heading={t('dataPolicy.cspTitle')}>
        <p>{t('dataPolicy.cspBody')}</p>
      </Prose>
      <Prose heading={t('dataPolicy.contentTitle')}>
        <p>{t('dataPolicy.contentBody')}</p>
      </Prose>
      <Prose heading={t('dataPolicy.memoryTitle')}>
        <p>{t('dataPolicy.memoryBody')}</p>
      </Prose>
      <Prose heading={t('dataPolicy.analyticsTitle')}>
        <p>{t('dataPolicy.analyticsBody')}</p>
      </Prose>
      <Prose heading={t('dataPolicy.debugTitle')}>
        <p>{t('dataPolicy.debugBody')}</p>
      </Prose>
      <Prose heading={t('dataPolicy.futureTitle')}>
        <p>{t('dataPolicy.futureBody')}</p>
      </Prose>
      <Prose heading={t('dataPolicy.verifyTitle')}>
        <p>{t('dataPolicy.verifyBody')}</p>
        <p>
          <ExternalLink href={REPO_URL}>{t('dataPolicy.verifyLink')}</ExternalLink>
        </p>
      </Prose>
    </ContentPage>
  )
}
