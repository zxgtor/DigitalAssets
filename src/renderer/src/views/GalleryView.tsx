import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './GalleryView.module.css'
import { PillButton } from '../components/PillButton'
import { toMediaUrlAsync } from '../utils/mediaUrl'
import type { HistoryEntry } from '../types'

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
  onOpenGenerate: (entry: HistoryEntry) => void
  onDelete: (id: string) => void
}

function GalleryCard({ entry, onOpenGenerate, onDelete }: GalleryCardProps): React.JSX.Element {
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

  const handleOpenGenerate = useCallback(() => {
    onOpenGenerate(entry)
  }, [entry, onOpenGenerate])

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
            onClick={handleOpenGenerate}
            title="Generate in ComfyUI"
            aria-label="Generate in ComfyUI"
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

interface GalleryViewProps {
  onOpenGenerate: (entry: HistoryEntry) => void
}

export function GalleryView({ onOpenGenerate }: GalleryViewProps): React.JSX.Element {
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

  const handleDelete = useCallback(
    async (id: string) => {
      // eslint-disable-next-line no-alert
      if (!window.confirm('Delete this entry from gallery? This cannot be undone.')) {
        return
      }
      try {
        await window.api.history.remove(id)
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
      {entries.length > 0 && (
        <div className={styles.toolbar}>
          <span className={styles.count}>{entries.length} items</span>
          <PillButton variant="ghost" size="sm" onClick={handleClear}>
            Clear all
          </PillButton>
        </div>
      )}

      {loading ? (
        <div className={styles.empty}>
          <div className={styles.emptyRing} />
          <span className={styles.emptyLabel}>Loading…</span>
        </div>
      ) : entries.length === 0 ? (
        <div className={styles.empty}>
          <svg className={styles.emptyIcon} viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <rect x="4" y="10" width="40" height="28" rx="3" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M4 22l10-8 8 7 7-5 15 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="15" cy="18" r="2.5" fill="currentColor" opacity="0.5"/>
          </svg>
          <span className={styles.emptyLabel}>Your gallery is empty</span>
          <span className={styles.emptyHint}>Analyze an image or video to get started</span>
        </div>
      ) : (
        <div className={styles.grid}>
          {entries.map((entry) => (
            <GalleryCard
              key={entry.id}
              entry={entry}
              onOpenGenerate={onOpenGenerate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default GalleryView
