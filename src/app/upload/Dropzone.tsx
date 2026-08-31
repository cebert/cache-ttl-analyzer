/**
 * Drag-and-drop plus a file picker. Both land in the same `analyze` call, so
 * the pre-flight checks and the worker handoff cannot diverge between them.
 *
 * Drag counting rather than a boolean: `dragleave` fires when the pointer
 * crosses into a child element, so a naive flag flickers off while the pointer
 * is still over the zone.
 */

import { useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { MAX_FILE_SIZE_BYTES } from '../../engine/contract'
import { useFormatters } from '../../i18n/formatters'
import { SESSION_LOG_EXTENSION } from '../../state/file-validation'
import { useSessions } from '../../state/sessions-context'
import { Button } from '../../ui/Button'
import { FileUpIcon } from '../../ui/Icon'
import { Micro } from '../../ui/Sheet'
import { FileIssueNotice } from './FileIssueNotice'

export function Dropzone({ onWhereAreLogs }: { onWhereAreLogs: () => void }) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const { analyze, busy } = useSessions()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragDepth, setDragDepth] = useState(0)

  const dragging = dragDepth > 0 && !busy

  function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (file) analyze(file)
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragDepth(0)
    if (busy) return
    handleFiles(event.dataTransfer.files)
  }

  return (
    <div className="p-2.5 sm:p-3">
      <div
        onDragEnter={(event) => {
          event.preventDefault()
          setDragDepth((depth) => depth + 1)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-3 rounded-[8px] border-[1.5px] border-dashed px-4 py-7 text-center transition-colors sm:gap-3.5 sm:px-6 sm:py-10 ${
          dragging ? 'border-primary bg-primary-tint' : 'border-[#C6D3E3] bg-[#FAFCFE]'
        }`}
      >
        <FileUpIcon size={30} className="text-primary" strokeWidth={1.4} />

        <div className="flex flex-col items-center gap-1">
          <p className="text-[16px] font-semibold tracking-[-0.015em] sm:text-[17px]">
            {busy
              ? t('upload.busyTitle')
              : dragging
                ? t('upload.dropTitleActive')
                : t('upload.dropTitle')}
          </p>
          <Micro>
            {busy
              ? t('upload.busyHint')
              : t('upload.dropHint', { size: fmt.bytes(MAX_FILE_SIZE_BYTES) })}
          </Micro>
        </div>

        <div className="flex w-full flex-col items-stretch gap-2.5 pt-0.5 sm:w-auto sm:flex-row sm:items-center">
          <Button
            variant="primary"
            size="lg"
            className="sm:h-[36px] sm:px-[17px] sm:text-[13.5px]"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {t('upload.choose')}
          </Button>
          <Button
            size="lg"
            className="sm:h-[36px] sm:px-[15px] sm:text-[13.5px]"
            onClick={onWhereAreLogs}
          >
            {t('upload.whereAreLogs')}
          </Button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={`${SESSION_LOG_EXTENSION},application/jsonl,application/x-ndjson`}
          className="sr-only"
          aria-label={t('upload.fileInputLabel')}
          onChange={(event) => {
            handleFiles(event.target.files)
            // Reset so picking the same file twice re-fires `change`.
            event.target.value = ''
          }}
        />
      </div>

      <FileIssueNotice />
    </div>
  )
}
