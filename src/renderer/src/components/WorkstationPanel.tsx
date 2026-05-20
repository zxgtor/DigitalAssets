import React from 'react'
import styles from './WorkstationPanel.module.css'
import type { Workstation } from '../types'

interface Props {
  workstations: Workstation[]
  open: boolean                       // controlled
  onToggle: (open: boolean) => void
  onRefresh: (id: string) => void
}

function statusDot(s: Workstation['status']): string {
  switch (s) {
    case 'online': return styles.dotOnline
    case 'busy':   return styles.dotBusy
    case 'offline': return styles.dotOffline
    default:        return styles.dotUnknown
  }
}

function bytesToGB(n: number): string {
  return (n / 1_000_000_000).toFixed(1)
}

export function WorkstationPanel({ workstations, open, onToggle, onRefresh }: Props): React.JSX.Element {
  const total = workstations.length
  const online = workstations.filter((w) => w.status === 'online' || w.status === 'busy').length

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.header}
        onClick={() => onToggle(!open)}
      >
        <span>Workstations</span>
        <span className={styles.summary}>{open ? '▼' : '▶'} {online}/{total} online</span>
      </button>

      {open && (
        <div className={styles.list}>
          {workstations.length === 0 && (
            <div className={styles.empty}>No workstations added. Open Settings to add or discover.</div>
          )}
          {workstations.map((w) => (
            <div key={w.id} className={styles.card} title={`${w.url} • added ${new Date(w.lastSeenAt ?? 0).toLocaleString()}`}>
              <div className={styles.row1}>
                <span className={`${styles.dot} ${statusDot(w.status)}`} />
                <span className={styles.name}>{w.name}</span>
                <span className={styles.statusText}>
                  {w.status === 'busy' ? `Busy ${w.queueDepth}` : w.status === 'online' ? 'Idle' : w.status}
                </span>
                <button type="button" className={styles.refreshBtn} onClick={() => onRefresh(w.id)} title="Refresh models">↻</button>
              </div>
              <div className={styles.row2}>
                <span className={styles.url}>{w.url}</span>
              </div>
              {w.gpu && (
                <div className={styles.vram}>
                  <span className={styles.vramLabel}>VRAM</span>
                  <span className={styles.vramBar}>
                    <span
                      className={styles.vramFill}
                      style={{ width: `${w.gpu.vramTotal ? (1 - w.gpu.vramFree / w.gpu.vramTotal) * 100 : 0}%` }}
                    />
                  </span>
                  <span className={styles.vramText}>
                    {bytesToGB(w.gpu.vramTotal - w.gpu.vramFree)} / {bytesToGB(w.gpu.vramTotal)} GB
                  </span>
                </div>
              )}
              <div className={styles.models}>
                {w.models.checkpoints.length} checkpoints, {w.models.loras.length} LoRAs, {w.models.vae.length} VAEs
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default WorkstationPanel
