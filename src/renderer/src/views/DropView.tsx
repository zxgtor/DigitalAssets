import React, { useCallback, useState } from 'react'
import styles from './DropView.module.css'
import { PillButton } from '../components/PillButton'
import type { MediaKind } from '../types'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'webm', 'avi']

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
  const [pickError, setPickError] = useState<string | null>(null)

  const acceptPath = useCallback(
    (filePath: string, displayName: string, file?: File): void => {
      const kind = detectKind(displayName)
      if (!kind) {
        setPickError(`Unsupported file type: ${displayName}`)
        return
      }
      setPickError(null)
      onFileSelected(filePath, kind, file)
    },
    [onFileSelected]
  )

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
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
      if (!file) return
      // Electron 32+ removed the non-standard File.path. Use webUtils
      // (exposed via preload) to recover the absolute path.
      const absPath = window.api.getFilePath(file)
      if (!absPath) {
        setPickError(
          `Could not read the file path for "${file.name}". Try the Upload File button instead.`
        )
        return
      }
      acceptPath(absPath, file.name, file)
    },
    [acceptPath]
  )

  // Open a native file picker through the main process. Returns the
  // absolute path directly — no dependency on the deprecated File.path.
  const openPicker = useCallback(
    async (e?: React.SyntheticEvent) => {
      e?.stopPropagation()
      try {
        const filePath = await window.api.dialog.openMedia()
        if (!filePath) return
        const name = filePath.split(/[\\/]/).pop() ?? filePath
        acceptPath(filePath, name)
      } catch (err) {
        console.error('openMedia failed', err)
        setPickError(`Could not open file picker: ${(err as Error).message}`)
      }
    },
    [acceptPath]
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
        onClick={() => void openPicker()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') void openPicker(e)
        }}
      >
        <div className={styles.iconCircle} aria-hidden="true">
          ↑
        </div>
        <div className={styles.title}>Analyze Your Media</div>
        <div className={styles.subtitle}>
          Drop an image or video here, or click to choose a file
        </div>
        <div className={styles.actions}>
          <PillButton variant="primary" onClick={(e) => void openPicker(e)}>
            + Upload File
          </PillButton>
        </div>
        {pickError && <div className={styles.urlError}>{pickError}</div>}

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
      </div>
    </div>
  )
}

export default DropView
