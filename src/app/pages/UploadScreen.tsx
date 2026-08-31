/**
 * The landing screen: the question the tool answers, the way to hand it a
 * file, the captured samples, and the reason handing one over is safe.
 *
 * Finding a log is deliberately NOT explained here. It used to be, in a panel
 * beside the privacy note, which put the same three paths on screen as the
 * "Where are my logs?" button one row above it — two answers to one question,
 * competing for the same glance. The button owns it now; this screen stays a
 * drop target and a promise.
 */

import { useTranslation } from 'react-i18next'

import { Sheet, SheetSection } from '../../ui/Sheet'
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
        <p className="text-[15.5px] leading-[1.55] text-ink-2 sm:text-[16px]">
          {t('upload.subhead')}
        </p>
      </div>

      <Sheet>
        <Dropzone onWhereAreLogs={onWhereAreLogs} />
        <SampleList />
      </Sheet>

      <Sheet>
        <SheetSection>
          <PrivacyPanel />
        </SheetSection>
      </Sheet>
    </div>
  )
}
