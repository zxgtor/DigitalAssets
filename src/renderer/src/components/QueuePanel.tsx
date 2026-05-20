import React from 'react'
import styles from './QueuePanel.module.css'
import type { Job, Workstation } from '../types'

interface Props {
  jobs: Job[]
  workstations: Workstation[]
  selectedJobId: string | null
  open: boolean                       // controlled
  onToggle: (open: boolean) => void
  onSelect: (id: string) => void
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  onRemove: (id: string) => void
  onClearDone: () => void
}

function statusIcon(s: Job['status']): string {
  switch (s) {
    case 'queued': case 'submitting': return '◇'
    case 'pending': return '◐'
    case 'running': return '⬤'
    case 'done': return '✓'
    case 'error': return '✗'
    default: return '?'
  }
}

export function QueuePanel({
  jobs, workstations, selectedJobId, open, onToggle,
  onSelect, onCancel, onRetry, onRemove, onClearDone
}: Props): React.JSX.Element {
  const hasDone = jobs.some((j) => j.status === 'done')

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.header}
        onClick={() => onToggle(!open)}
      >
        <span>Queue</span>
        <span className={styles.summary}>{open ? '▼' : '▶'} {jobs.length} job{jobs.length === 1 ? '' : 's'}</span>
      </button>

      {open && (
        <div className={styles.list}>
          {jobs.length === 0 && <div className={styles.empty}>No jobs yet. Send one with the button below.</div>}
          {jobs.map((j) => {
            const ws = workstations.find((w) => w.id === j.workstationId)
            const selected = j.id === selectedJobId
            return (
              <div
                key={j.id}
                className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
                onClick={() => onSelect(j.id)}
              >
                <div className={styles.row1}>
                  <span className={`${styles.icon} ${styles[`status_${j.status}`]}`}>{statusIcon(j.status)}</span>
                  <span className={styles.id}>#{j.id.slice(0, 4)}</span>
                  <span className={styles.statusText}>
                    {j.status}
                    {j.status === 'pending' && j.queuePosition != null ? ` #${j.queuePosition}` : ''}
                  </span>
                  <span className={styles.wsName}>{ws?.name ?? '—'}</span>
                </div>
                {j.promptPreview && <div className={styles.preview}>"{j.promptPreview}"</div>}
                {j.error && <div className={styles.error}>{j.error}</div>}
                <div className={styles.actions}>
                  {(j.status === 'pending' || j.status === 'running') && (
                    <button onClick={(e) => { e.stopPropagation(); onCancel(j.id) }}>Cancel</button>
                  )}
                  {j.status === 'error' && (
                    <button onClick={(e) => { e.stopPropagation(); onRetry(j.id) }}>Retry</button>
                  )}
                  {(j.status === 'done' || j.status === 'error') && (
                    <button onClick={(e) => { e.stopPropagation(); onRemove(j.id) }}>Remove</button>
                  )}
                </div>
              </div>
            )
          })}
          {hasDone && (
            <button type="button" className={styles.clearDone} onClick={onClearDone}>
              Clear done
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default QueuePanel
