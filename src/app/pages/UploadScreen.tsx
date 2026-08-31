/**
 * The landing screen: the question the tool answers, the way to hand it a
 * file, the captured samples, and — side by side below — where to find a log
 * and why handing one over is safe.
 *
 * Those last two sit at the same level on purpose: a user who has never seen
 * this tool needs both answers before they will use it.
 */

import { useTranslation } from 'react-i18next'

import { Sheet, SheetSection } from '../../ui/Sheet'
import { FindLogsPanel } from '../FindLogsPanel'
import { Dropzone } from '../upload/Dropzone'
import { PrivacyPanel } from '../upload/PrivacyPanel'
import { SampleList } from '../upload/SampleList'

export function UploadScreen({ onWhereAreLogs }: { onWhereAreLogs: () => void }) {
  const { t } = useTranslation()

  return (
    <div className="flex max-w-[940px] flex-col gap-4 px-4 pt-7 pb-8 sm:px-6 sm:pt-14 sm:pb-8">
      <div className="flex flex-col gap-2.5">
        <h1 className="text-[28px] leading-[1.12] font-semibold tracking-[-0.03em] text-balance sm:text-[38px] sm:leading-[1.1] sm:tracking-[-0.032em]">
          {t('upload.headline')}
        </h1>
        <p className="text-[14.5px] leading-[1.55] text-ink-2 sm:text-[15px]">
          {t('upload.subhead')}
        </p>
      </div>

      <Sheet>
        <Dropzone onWhereAreLogs={onWhereAreLogs} />
        <SampleList />
      </Sheet>

      <Sheet>
        <div className="flex flex-col lg:flex-row lg:items-stretch">
          <SheetSection className="min-w-0 flex-1">
            <FindLogsPanel />
          </SheetSection>
          <div className="h-px w-full shrink-0 bg-line-soft lg:h-auto lg:w-px" />
          <SheetSection className="lg:w-[372px] lg:shrink-0">
            <PrivacyPanel />
          </SheetSection>
        </div>
      </Sheet>
    </div>
  )
}
