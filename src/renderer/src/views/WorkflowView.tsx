import React, { useCallback, useEffect, useMemo, useState } from 'react'
import styles from './WorkflowView.module.css'
import { PillButton } from '../components/PillButton'
import type { WorkflowJSON, WorkflowKind } from '../types'

export interface WorkflowViewProps {
  kind: WorkflowKind
  workflow: WorkflowJSON
  fileName: string
  onBack: () => void
}

const IMAGE_CHAIN = [
  'CheckpointLoaderSimple',
  'CLIPTextEncode',
  'KSampler',
  'VAEDecode',
  'SaveImage'
]

const VIDEO_CHAIN = [
  'CheckpointLoaderSimple',
  'AnimateDiffLoader',
  'CLIPTextEncode',
  'KSampler',
  'VAEDecode',
  'VideoCombine'
]

function defaultJsonName(fileName: string, kind: WorkflowKind): string {
  const stem = fileName.replace(/\.[^.]+$/, '') || 'workflow'
  const suffix = kind === 'image' ? '_workflow' : '_animatediff'
  return `${stem}${suffix}.json`
}

export function WorkflowView({
  kind,
  workflow,
  fileName,
  onBack
}: WorkflowViewProps): React.JSX.Element {
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const jsonText = useMemo(() => JSON.stringify(workflow, null, 2), [workflow])
  const chain = kind === 'image' ? IMAGE_CHAIN : VIDEO_CHAIN
  const heading = kind === 'image' ? 'ComfyUI Workflow' : 'AnimateDiff Workflow'
  const defaultName = defaultJsonName(fileName, kind)

  useEffect(() => {
    if (!savedPath) return
    const t = window.setTimeout(() => setSavedPath(null), 3000)
    return () => window.clearTimeout(t)
  }, [savedPath])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const result = await window.api.workflow.save({
        workflow,
        defaultFileName: defaultName
      })
      if (result.saved) {
        setSavedPath(result.path)
      }
    } catch (err) {
      console.error('Save failed', err)
      // eslint-disable-next-line no-alert
      alert(`Save failed:\n\n${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }, [workflow, defaultName])

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <div className={styles.heading}>{heading}</div>
          <div className={styles.subheading} title={fileName}>
            {fileName} · {Object.keys(workflow).length} nodes
          </div>
        </div>
      </div>

      <div className={styles.label}>NODE CHAIN</div>
      <div className={styles.chain}>
        {chain.map((node, i) => (
          <React.Fragment key={`${node}-${i}`}>
            <span className={styles.node}>{node}</span>
            {i < chain.length - 1 && <span className={styles.arrow}>→</span>}
          </React.Fragment>
        ))}
      </div>

      <div className={styles.label}>WORKFLOW JSON</div>
      <div className={styles.jsonWrap}>
        <pre className={styles.jsonBox}>{jsonText}</pre>
      </div>

      <div className={styles.footer}>
        <PillButton variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save .json'}
        </PillButton>
        <PillButton variant="ghost" onClick={onBack}>
          ← Back
        </PillButton>
        {savedPath && (
          <span className={styles.savedNote} title={savedPath}>
            Saved to {savedPath}
          </span>
        )}
      </div>
    </div>
  )
}

export default WorkflowView
