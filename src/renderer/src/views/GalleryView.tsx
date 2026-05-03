import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './GalleryView.module.css'
import { PillButton } from '../components/PillButton'
import { toMediaUrlAsync } from '../utils/mediaUrl'

interface HistoryEntry {
  id: string
  kind: 'image' | 'video'
  filePath: string
  fileName: string
  prompt: string
  model?: string
  durationSec?: number
  frameCount?: number
  durationMs?: number
  createdAt: number
  thumbnailPath?: string
  videoPath?: string
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatMeta(entry: HistoryEntry): string {
  if (entry.kind === 'video') {
    const parts: string[] = []
    if (entry.frameCount) parts.push(`${entry.frameCount} frames`)
    if (entry.durationSec) parts.push(`${Math.round(entry.durationSec)}s`)
    return parts.join(' · ')
  }
  const parts: string[] = []
  if (entry.model) parts.push(entry.model)
  if (entry.durationMs) parts.push(`${(entry.durationMs / 1000).toFixed(1)}s`)
  return parts.join(' · ')
}

interface GalleryCardProps {
  entry: HistoryEntry
  onOpenComfy: (entry: HistoryEntry) => void
  onDelete: (id: string) => void
}

function GalleryCard({ entry, onOpenComfy, onDelete }: GalleryCardProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const [bgImage, setBgImage] = useState<string>('')
  const [videoSrc, setVideoSrc] = useState<string>('')
  const videoRef = useRef<HTMLVideoElement>(null)

  // Load media URLs asynchronously
  useEffect(() => {
    const loadUrls = async () => {
      try {
        if (entry.thumbnailPath) {
          const url = await toMediaUrlAsync(entry.thumbnailPath)
          setBgImage(url)
        }
        if (entry.videoPath) {
          const url = await toMediaUrlAsync(entry.videoPath)
          setVideoSrc(url)
        }
      } catch (err) {
        console.error('Failed to load media URLs', err)
      }
    }
    void loadUrls()
  }, [entry.thumbnailPath, entry.videoPath])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(entry.prompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Copy failed', err)
    }
  }, [entry.prompt])

  const handleMouseEnter = useCallback(() => {
    if (entry.kind === 'video' && videoRef.current && videoSrc) {
      videoRef.current.play().catch(() => {
        // play may fail if media isn't ready
      })
    }
  }, [entry.kind, videoSrc])

  const handleMouseLeave = useCallback(() => {
    if (entry.kind === 'video' && videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }, [entry.kind])

  const handleOpenComfy = useCallback(() => {
    onOpenComfy(entry)
  }, [entry, onOpenComfy])

  const handleDelete = useCallback(() => {
    onDelete(entry.id)
  }, [entry.id, onDelete])

  return (
    <div
      className={styles.card}
      style={bgImage ? { backgroundImage: `url(${bgImage})` } : {}}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Video overlay (hidden by default, shown on hover) */}
      {entry.kind === 'video' && videoSrc && (
        <video
          ref={videoRef}
          className={styles.videoOverlay}
          src={videoSrc}
          poster={bgImage}
          muted
          loop
        />
      )}

      {/* Content overlay */}
      <div className={styles.cardContent}>
        <div className={styles.cardHeader}>
          <span className={styles.kindBadge}>{entry.kind}</span>
          <span className={styles.fileName} title={entry.filePath}>
            {entry.fileName}
          </span>
        </div>

        <div className={styles.cardMeta}>
          <span className={styles.metaText}>{formatMeta(entry)}</span>
          <span className={styles.metaText}>{formatDate(entry.createdAt)}</span>
        </div>

        <div className={styles.cardActions}>
          <button
            type="button"
            className={styles.actionIcon}
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy prompt'}
            aria-label="Copy prompt"
          >
            {copied ? '✓' : '⎘'}
          </button>
          <button
            type="button"
            className={styles.actionIcon}
            onClick={handleOpenComfy}
            title="Open in ComfyUI"
            aria-label="Open in ComfyUI"
          >
            ⊕
          </button>
          <button
            type="button"
            className={styles.actionIcon}
            onClick={handleDelete}
            title="Delete from gallery"
            aria-label="Delete from gallery"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

export function GalleryView(): React.JSX.Element {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    window.api.history
      .list()
      .then(setEntries)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleClear = useCallback(async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Clear all gallery entries? This cannot be undone.')) {
      return
    }
    await window.api.history.clear()
    setEntries([])
  }, [])

  const handleOpenComfy = useCallback(
    async (entry: HistoryEntry) => {
      try {
        // Build workflow from the entry's prompt
        const workflow = await window.api.workflow.buildImage({
          prompt: entry.prompt
        })
        // Open in ComfyUI (saves JSON + opens folder + browser)
        await (window.api as any).comfy?.open?.({
          workflow,
          fileName: entry.fileName
        })
      } catch (err) {
        console.error('ComfyUI open failed', err)
        // eslint-disable-next-line no-alert
        alert(`Failed to open ComfyUI:\n\n${err instanceof Error ? err.message : String(err)}`)
      }
    },
    []
  )

  const handleDelete = useCallback(
    async (id: string) => {
      // eslint-disable-next-line no-alert
      if (!window.confirm('Delete this entry from gallery? This cannot be undone.')) {
        return
      }
      try {
        await window.api.history.delete(id)
        setEntries((prev) => prev.filter((e) => e.id !== id))
      } catch (err) {
        console.error('Delete failed', err)
        // eslint-disable-next-line no-alert
        alert(`Failed to delete:\n\n${err instanceof Error ? err.message : String(err)}`)
      }
    },
    []
  )

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.heading}>Gallery</span>
        <div className={styles.headerActions}>
          {entries.length > 0 && <span className={styles.count}>{entries.length} entries</span>}
          {entries.length > 0 && (
            <PillButton variant="ghost" size="sm" onClick={handleClear}>
              Clear all
            </PillButton>
          )}
        </div>
      </div>

      {loading ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>⊞</span>
          <span>Loading…</span>
        </div>
      ) : entries.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>⊞</span>
          <span>No gallery yet</span>
          <span>Analyzed files will appear here</span>
        </div>
      ) : (
        <div className={styles.grid}>
          {entries.map((entry) => (
            <GalleryCard
              key={entry.id}
              entry={entry}
              onOpenComfy={handleOpenComfy}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default GalleryView
