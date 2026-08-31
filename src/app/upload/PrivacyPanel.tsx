/**
 * The privacy statement that sits on the landing screen (docs/PLAN.md §1). It
 * makes the claim in three lines and then points at the two things that let a
 * reader check it rather than trust it: the data policy, and the source.
 */

import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'

import { ExternalLink } from '../../ui/ExternalLink'
import { REPO_URL } from '../../ui/links'
import { ShieldCheckIcon } from '../../ui/Icon'
import { Micro, SectionTitle } from '../../ui/Sheet'
import { ROUTES } from '../routes'

export function PrivacyPanel() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ShieldCheckIcon size={15} className="shrink-0 text-green" />
        <SectionTitle>{t('privacy.title')}</SectionTitle>
      </div>
      <div className="flex flex-col gap-1.5">
        <Micro>{t('privacy.inBrowser')}</Micro>
        <Micro>{t('privacy.metadataOnly')}</Micro>
        <Micro>{t('privacy.csp')}</Micro>
      </div>
      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1 text-[13px]">
        <Link to={ROUTES.dataPolicy} className="text-primary hover:underline">
          {t('nav.dataPolicy')}
        </Link>
        <ExternalLink href={REPO_URL}>{t('privacy.source')}</ExternalLink>
      </div>
    </div>
  )
}
