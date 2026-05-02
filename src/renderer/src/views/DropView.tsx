import React, { useCallback, useRef, useState } from 'react'
import styles from './DropView.module.css'
import { PillButton } from '../components/PillButton'
import type { MediaKind } from '../types'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'webm', 'avi']
const ACCEPT = '.png,.jpg,.jpeg,.webp,.mp4,.mov,.mkv,image/*,video/*'

function detectKind(name: string): MediaKind | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTS.includes(ext)) return 'image'
  if (VIDEO_EXTS.includes(ext)) return 'video'
  return null
}

export interface DropViewProps {
  onFileSelected: (filePath: string, kind: MediaKind, file?: File) => void
  onYouTubeUrl: (url: string) => void
}

export function DropView({
  onFileSelected,
  onYouTubeUrl
}: DropViewProps): React.JSX.Element {
  const [isDragOver, setIsDragOver] = useState(false)
  const [urlValue, setUrlValue] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(
    (file: File): void => {
      const kind = detectKind(file.name)
      if (!kind) return
      // Electron exposes the absolute path on File objects via the non-standard `path` field.
      const anyFile = file as File & { path?: string }
      const filePath = anyFile.path ?? file.name
      onFileSelected(filePath, kind, file)
    },
    [onFileSelected]
  )

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const openPicker = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    inputRef.current?.click()
  }, [])

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
      // reset so the same file can be reselected
      e.target.value = ''
    },
    [handleFile]
  )

  const submitUrl = useCallback(
    (e?: React.SyntheticEvent) => {
      e?.stopPropagation()
      const trimmed = urlValue.trim()
      if (!trimmed) {
        setUrlError('Please paste a YouTube link')
        return
      }
      setUrlError(null)
      onYouTubeUrl(trimmed)
      setUrlValue('')
    },
    [onYouTubeUrl, urlValue]
  )

  const onUrlKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        submitUrl(e)
      }
    },
    [submitUrl]
  )

  const stopProp = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation()
  }, [])

  const cls = [styles.dropZone, isDragOver ? styles.dragOver : null].filter(Boolean).join(' ')

  return (
    <div className={styles.wrap}>
      <div
        className={cls}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => openPicker()}
        role="button"
        tabIndex={0}
      >
        <div className={styles.iconCircle} aria-hidden="true">
          ↑
        </div>
        <div className={styles.title}>Analyze Your Media</div>
        <div className={styles.subtitle}>
          Drop an image or video to generate a Stable Diffusion prompt
        </div>
        <div className={styles.actions}>
          <PillButton variant="primary" onClick={openPicker}>
            + Upload File
          </PillButton>
        </div>

        <div
          className={styles.urlSection}
          onClick={stopProp}
          onMouseDown={stopProp}
          role="presentation"
        >
          <div className={styles.divider} aria-hidden="true">
            <span className={styles.dividerLine} />
            <span className={styles.dividerText}>OR</span>
            <span className={styles.dividerLine} />
          </div>
          <div className={styles.urlRow}>
            <input
              type="text"
              className={styles.urlInput}
              placeholder="Paste a YouTube link…"
              value={urlValue}
              onChange={(e) => {
                setUrlValue(e.target.value)
                if (urlError) setUrlError(null)
              }}
              onKeyDown={onUrlKeyDown}
              onClick={stopProp}
            />
            <PillButton variant="ghost" onClick={submitUrl}>
              Analyze URL
            </PillButton>
          </div>
          {urlError ? <div className={styles.urlError}>{urlError}</div> : null}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className={styles.hiddenInput}
          onChange={onInputChange}
        />
      </div>
    </div>
  )
}

export default DropView
