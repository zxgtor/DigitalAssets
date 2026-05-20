import React, { useEffect, useState } from 'react'
import styles from './DiscoverDialog.module.css'
import type { DiscoveryCandidate } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onDiscover: (onCandidate: (c: DiscoveryCandidate) => void) => Promise<DiscoveryCandidate[]>
  onAdd: (candidates: DiscoveryCandidate[]) => Promise<void>
}

function bytesToGB(n: number): string {
  return n ? (n / 1_000_000_000).toFixed(1) + ' GB' : '—'
}

export function DiscoverDialog({ open, onClose, onDiscover, onAdd }: Props): React.JSX.Element | null {
  const [scanning, setScanning] = useState(false)
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) {
      setCandidates([]); setSelected(new Set()); setScanning(false)
      return
    }
    setScanning(true)
    const run = async (): Promise<void> => {
      try {
        await onDiscover((c) => setCandidates((prev) => prev.some((p) => p.url === c.url) ? prev : [...prev, c]))
      } finally {
        setScanning(false)
      }
    }
    void run()
  }, [open, onDiscover])

  if (!open) return null

  const toggle = (url: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url); else next.add(url)
      return next
    })
  }

  const addSelected = async (): Promise<void> => {
    const toAdd = candidates.filter((c) => selected.has(c.url))
    await onAdd(toAdd)
    onClose()
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>Discover ComfyUI servers on LAN</div>
        <div className={styles.status}>
          {scanning ? 'Scanning…' : `Done. Found ${candidates.length}.`}
        </div>

        <div className={styles.list}>
          {candidates.map((c) => (
            <label key={c.url} className={styles.item}>
              <input type="checkbox" checked={selected.has(c.url)} onChange={() => toggle(c.url)} />
              <div className={styles.info}>
                <div className={styles.url}>{c.url}</div>
                <div className={styles.gpu}>{c.gpu} · {bytesToGB(c.vramTotal)}</div>
              </div>
            </label>
          ))}
          {!scanning && candidates.length === 0 && (
            <div className={styles.empty}>
              No ComfyUI servers found. Make sure ComfyUI is running with --listen,
              or use Add manually.
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button onClick={onClose}>Cancel</button>
          <button
            disabled={selected.size === 0}
            onClick={addSelected}
            className={styles.primary}
          >
            Add selected ({selected.size})
          </button>
        </div>
      </div>
    </div>
  )
}

export default DiscoverDialog
