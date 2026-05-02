import React from 'react'
import styles from './AnalyzingView.module.css'

export interface AnalyzingViewProps {
  fileName: string
  thumbnailUrl?: string
  subStatus?: string
  status?: string
}

export function AnalyzingView({
  fileName,
  thumbnailUrl,
  subStatus = 'Extracting visual features',
  status = 'Analyzing with LLaVA...'
}: AnalyzingViewProps): React.JSX.Element {
  return (
    <div className={styles.wrap}>
      <div className={styles.column}>
        <div className={styles.thumb} aria-hidden="true">
          {thumbnailUrl ? <img src={thumbnailUrl} alt="" /> : <span>▦</span>}
        </div>
        <div className={styles.status}>{status}</div>
        <div className={styles.fileName} title={fileName}>
          {fileName}
        </div>
        <div className={styles.progressTrack} role="progressbar" aria-label="Analyzing">
          <div className={styles.progressFill} />
        </div>
        <div className={styles.subStatus}>{subStatus}</div>
      </div>
    </div>
  )
}

export default AnalyzingView
