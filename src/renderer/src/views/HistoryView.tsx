import React, { useCallback, useEffect, useState } from 'react'
import styles from './HistoryView.module.css'
import { PillButton } from '../components/PillButton'

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

function HistoryCard({ entry }: { entry: HistoryEntry }): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(entry.prompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Copy failed', err)
    }
  }, [entry.prompt])

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.kindBadge}>{entry.kind}</span>
        <span className={styles.fileName} title={entry.filePath}>{entry.fileName}</span>
        <span className={styles.meta}>{formatMeta(entry)}</span>
        <span className={styles.meta}>{formatDate(entry.createdAt)}</span>
      </div>
      <div className={styles.prompt}>{entry.prompt}</div>
      <div className={styles.cardActions}>
        <PillButton variant="ghost" size="sm" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy Prompt'}
        </PillButton>
      </div>
    </div>
  )
}

export function HistoryView(): React.JSX.Element {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    window.api.history.list()
      .then(setEntries)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleClear = useCallback(async () => {
    await window.api.history.clear()
    setEntries([])
  }, [])

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.heading}>History</span>
        <div className={styles.headerActions}>
          {entries.length > 0 && (
            <span className={styles.count}>{entries.length} entries</span>
          )}
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
          <span>No history yet</span>
          <span>Analyzed files will appear here</span>
        </div>
      ) : (
        <div className={styles.list}>
          {entries.map((entry) => (
            <HistoryCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}

export default HistoryView
