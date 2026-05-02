import React, { useCallback, useState } from 'react'
import styles from './ImageResultView.module.css'
import { PillButton } from '../components/PillButton'
import { PromptBox } from '../components/PromptBox'
import type { ImageAnalysisResult } from '../types'

export interface ImageResultViewProps {
  result: ImageAnalysisResult
  fileName: string
  thumbnailUrl?: string
  onNew: () => void
  onWorkflow: () => void
}

export function ImageResultView({
  result,
  fileName,
  thumbnailUrl,
  onNew,
  onWorkflow
}: ImageResultViewProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const seconds = (result.durationMs / 1000).toFixed(1)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(result.prompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Copy failed', err)
    }
  }, [result.prompt])

  const handleWorkflow = useCallback(() => {
    console.log('[ImageResultView] Workflow not yet implemented')
    onWorkflow()
  }, [onWorkflow])

  return (
    <div className={styles.wrap}>
      <div className={styles.column}>
        <div className={styles.header}>
          <div className={styles.thumb} aria-hidden="true">
            {thumbnailUrl ? <img src={thumbnailUrl} alt="" /> : <span>▦</span>}
          </div>
          <div className={styles.headerText}>
            <div className={styles.fileName} title={fileName}>
              {fileName}
            </div>
            <div className={styles.subtitle}>
              Analysis complete · {result.model} · {seconds}s
            </div>
          </div>
          <div className={styles.headerActions}>
            <PillButton variant="ghost" size="sm" onClick={onNew}>
              New
            </PillButton>
          </div>
        </div>

        <div className={styles.label}>SD PROMPT</div>
        <PromptBox text={result.prompt} />

        <div className={styles.actions}>
          <PillButton variant="primary" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy Prompt'}
          </PillButton>
          <PillButton variant="ghost" onClick={handleWorkflow}>
            Workflow ↗
          </PillButton>
        </div>
      </div>
    </div>
  )
}

export default ImageResultView
