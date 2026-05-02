import React from 'react'
import styles from './FrameStrip.module.css'

export interface FrameStripFrame {
  timeSec: number
  thumbnailPath: string
}

export interface FrameStripProps {
  frames: FrameStripFrame[]
  selectedIndex: number
  onSelect: (index: number) => void
}

function formatTime(secs: number): string {
  if (!Number.isFinite(secs)) return '0s'
  return `${Math.round(secs)}s`
}

export function FrameStrip({
  frames,
  selectedIndex,
  onSelect
}: FrameStripProps): React.JSX.Element {
  return (
    <div className={styles.strip} role="listbox" aria-label="Keyframes">
      {frames.map((frame, i) => {
        const isSel = i === selectedIndex
        const cls = [styles.frameWrap, isSel ? styles.selected : null]
          .filter(Boolean)
          .join(' ')
        return (
          <button
            key={`${frame.thumbnailPath}-${i}`}
            type="button"
            className={cls}
            role="option"
            aria-selected={isSel}
            onClick={() => onSelect(i)}
          >
            <span className={styles.thumb}>
              <img src={`file://${frame.thumbnailPath}`} alt={`Frame ${i + 1}`} />
            </span>
            <span className={styles.timeLabel}>{formatTime(frame.timeSec)}</span>
          </button>
        )
      })}
    </div>
  )
}

export default FrameStrip
