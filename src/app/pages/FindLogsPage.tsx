/**
 * The full "find your logs" instructions. The landing screen carries a
 * compact version of the same panel; this page adds the subagent-transcript
 * note and the introduction, for a reader who arrived not knowing that Claude
 * Code writes session logs at all.
 */

import { useTranslation } from 'react-i18next'

import { FindLogsPanel } from '../FindLogsPanel'
import { ContentPage } from './ContentPage'
import { SheetSection } from '../../ui/Sheet'

export function FindLogsPage() {
  const { t } = useTranslation()
  return (
    <ContentPage title={t('findLogs.title')}>
      <SheetSection>
        <FindLogsPanel detailed />
      </SheetSection>
    </ContentPage>
  )
}
