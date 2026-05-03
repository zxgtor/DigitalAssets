import React, { useCallback, useState } from 'react'
import styles from './VideoResultView.module.css'
import { PillButton } from '../components/PillButton'
import { PromptBox } from '../components/PromptBox'
import { FrameStrip } from '../components/FrameStrip'
import { toMediaUrl } from '../utils/mediaUrl'
import type { VideoAnalysisResult } from '../types'

export interface VideoResultViewProps {
  result: VideoAnalysisResult
  fileName: string
  onNew: () => void
  onWorkflow: () => void
}

type TabKey = 'master' | 'perFrame' | 'workflow'

function formatDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return '0s'
  if (secs < 60) return `${secs.toFixed(1)}s`
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}m ${s}s`
}

export function VideoResultView({
  result,
  fileName,
  onNew,
  onWorkflow
}: VideoResultViewProps): React.JSX.Element {
  const [tab, setTab] = useState<TabKey>('master')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [copied, setCopied] = useState(false)

  const selectedFrame = result.keyframes[selectedIndex] ?? result.keyframes[0]

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Copy failed', err)
    }
  }, [])

  const handleAnimateDiff = useCallback(() => {
    setTab('workflow')
    onWorkflow()
  }, [onWorkflow])

  const dims =
    result.width && result.height ? `${result.width}×${result.height}` : ''
  const subtitle = [formatDuration(result.duration), dims].filter(Boolean).join(' · ')

  return (
    <div className={styles.wrap}>
      <div className={styles.column}>
        <div className={styles.header}>
          <div className={styles.thumb} aria-hidden="true">
            <span>▶</span>
          </div>
          <div className={styles.headerText}>
            <div className={styles.fileName} title={fileName}>
              {fileName}
            </div>
            <div className={styles.subtitle}>{subtitle}</div>
          </div>
          <div className={styles.headerActions}>
            <PillButton variant="ghost" size="sm" onClick={onNew}>
              New
            </PillButton>
          </div>
        </div>

        {result.videoPath && (
          <video
            className={styles.videoPlayer}
            src={toMediaUrl(result.videoPath)}
            controls
            preload="metadata"
          />
        )}

        <div className={styles.label}>KEY FRAMES</div>
        <FrameStrip
          frames={result.keyframes.map((k) => ({
            timeSec: k.timeSec,
            thumbnailPath: k.thumbnailPath
          }))}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
        />

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'master'}
            className={[styles.tab, tab === 'master' ? styles.tabActive : null]
              .filter(Boolean)
              .join(' ')}
            onClick={() => setTab('master')}
          >
            Master
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'perFrame'}
            className={[styles.tab, tab === 'perFrame' ? styles.tabActive : null]
              .filter(Boolean)
              .join(' ')}
            onClick={() => setTab('perFrame')}
          >
            Per Frame
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'workflow'}
            className={[styles.tab, tab === 'workflow' ? styles.tabActive : null]
              .filter(Boolean)
              .join(' ')}
            onClick={() => setTab('workflow')}
          >
            Workflow
          </button>
        </div>

        {tab === 'master' && (
          <div className={styles.tabPanel}>
            <PromptBox text={result.masterPrompt} />
            <div className={styles.actions}>
              <PillButton variant="primary" onClick={() => copyText(result.masterPrompt)}>
                {copied ? 'Copied!' : 'Copy Prompt'}
              </PillButton>
              <PillButton variant="ghost" onClick={handleAnimateDiff}>
                AnimateDiff ↗
              </PillButton>
            </div>
          </div>
        )}

        {tab === 'perFrame' && selectedFrame && (
          <div className={styles.tabPanel}>
            <PromptBox text={selectedFrame.prompt} />
            <div className={styles.actions}>
              <PillButton variant="primary" onClick={() => copyText(selectedFrame.prompt)}>
                {copied ? 'Copied!' : 'Copy Prompt'}
              </PillButton>
            </div>
          </div>
        )}

        {tab === 'workflow' && (
          <div className={styles.tabPanel}>
            <div className={styles.workflowPlaceholder}>
              Workflow generation coming next
            </div>
            <div className={styles.actions}>
              <PillButton variant="ghost" onClick={() => setTab('master')}>
                Back
              </PillButton>
              <PillButton variant="primary" onClick={onWorkflow}>
                Generate
              </PillButton>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default VideoResultView
