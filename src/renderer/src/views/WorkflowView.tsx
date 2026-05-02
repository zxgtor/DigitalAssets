import React, { useCallback, useRef, useState } from 'react'
import styles from './WorkflowView.module.css'
import { PillButton } from '../components/PillButton'

type JobStatus = 'pending' | 'running' | 'done' | 'error'

interface Job {
  id: string
  filePath: string
  fileName: string
  kind: 'image' | 'video'
  status: JobStatus
  prompt?: string
  error?: string
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi'])

function detectKind(name: string): 'image' | 'video' | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  return null
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function WorkflowView(): React.JSX.Element {
  const [jobs, setJobs] = useState<Job[]>([])
  const [running, setRunning] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef(false)

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files)
    const newJobs: Job[] = arr
      .map((f) => {
        const kind = detectKind(f.name)
        if (!kind) return null
        const anyFile = f as File & { path?: string }
        return {
          id: makeId(),
          filePath: anyFile.path ?? f.name,
          fileName: f.name,
          kind,
          status: 'pending' as JobStatus
        }
      })
      .filter((j): j is Job => j !== null)
    setJobs((prev) => [...prev, ...newJobs])
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
    },
    [addFiles]
  )

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) addFiles(e.target.files)
      e.target.value = ''
    },
    [addFiles]
  )

  const removeJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    setJobs([])
  }, [])

  const runAll = useCallback(async () => {
    const pending = jobs.filter((j) => j.status === 'pending')
    if (pending.length === 0) return
    setRunning(true)
    abortRef.current = false

    for (const job of pending) {
      if (abortRef.current) break

      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, status: 'running' } : j))
      )

      try {
        let prompt: string
        if (job.kind === 'image') {
          const result = await window.api.analyze.image(job.filePath)
          prompt = result.prompt
          void window.api.history.add({
            kind: 'image',
            filePath: job.filePath,
            fileName: job.fileName,
            prompt: result.prompt,
            model: result.model,
            durationMs: result.durationMs,
            createdAt: Date.now()
          })
        } else {
          const result = await window.api.analyze.video(job.filePath)
          prompt = result.masterPrompt
          void window.api.history.add({
            kind: 'video',
            filePath: job.filePath,
            fileName: job.fileName,
            prompt: result.masterPrompt,
            model: result.model,
            durationSec: result.duration,
            frameCount: result.keyframes.length,
            durationMs: result.durationMs,
            createdAt: Date.now()
          })
        }
        setJobs((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, status: 'done', prompt } : j))
        )
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        setJobs((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, status: 'error', error } : j))
        )
      }
    }

    setRunning(false)
  }, [jobs])

  const stopAll = useCallback(() => {
    abortRef.current = true
  }, [])

  const copyAll = useCallback(async () => {
    const done = jobs.filter((j) => j.status === 'done' && j.prompt)
    const text = done.map((j) => `# ${j.fileName}\n${j.prompt}`).join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      console.error('Copy failed', err)
    }
  }, [jobs])

  const pendingCount = jobs.filter((j) => j.status === 'pending').length
  const doneCount = jobs.filter((j) => j.status === 'done').length
  const hasResults = doneCount > 0
  const hasJobs = jobs.length > 0

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <div className={styles.heading}>Batch Workflow</div>
          <div className={styles.subheading}>Analyze multiple files at once</div>
        </div>
        <div className={styles.headerActions}>
          {hasResults && (
            <PillButton variant="ghost" size="sm" onClick={copyAll}>
              Copy All Prompts
            </PillButton>
          )}
          {hasJobs && !running && (
            <PillButton variant="ghost" size="sm" onClick={clearAll}>
              Clear
            </PillButton>
          )}
        </div>
      </div>

      {/* Drop bar */}
      <div
        className={[styles.dropBar, isDragOver ? styles.dropBarOver : null]
          .filter(Boolean)
          .join(' ')}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <span className={styles.dropIcon}>↑</span>
        <span>Drop files here or click to add — images &amp; videos</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.webp,.mp4,.mov,.mkv,image/*,video/*"
          style={{ display: 'none' }}
          onChange={onInputChange}
        />
      </div>

      {/* Queue */}
      {hasJobs ? (
        <div className={styles.queue}>
          {jobs.map((job) => (
            <div key={job.id} className={styles.item}>
              <span className={styles.kindBadge}>{job.kind}</span>
              <span className={styles.itemName} title={job.filePath}>
                {job.fileName}
              </span>
              {job.status === 'pending' && (
                <span className={styles.statusPending}>Pending</span>
              )}
              {job.status === 'running' && (
                <span className={styles.statusRunning}>Analyzing…</span>
              )}
              {job.status === 'done' && job.prompt && (
                <span className={styles.promptPreview} title={job.prompt}>
                  {job.prompt}
                </span>
              )}
              {job.status === 'done' && (
                <span className={styles.statusDone}>✓</span>
              )}
              {job.status === 'error' && (
                <span className={styles.statusError} title={job.error}>
                  {job.error}
                </span>
              )}
              {job.status !== 'running' && !running && (
                <button
                  type="button"
                  className={styles.removeBtn}
                  onClick={() => removeJob(job.id)}
                  aria-label="Remove"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>↑</span>
          <span>No files queued</span>
          <span>Add images or videos above to get started</span>
        </div>
      )}

      {/* Footer actions */}
      <div className={styles.footer}>
        {!running ? (
          <PillButton
            variant="primary"
            onClick={runAll}
            disabled={pendingCount === 0}
          >
            {pendingCount > 0 ? `Analyze ${pendingCount} file${pendingCount !== 1 ? 's' : ''}` : 'No pending files'}
          </PillButton>
        ) : (
          <PillButton variant="ghost" onClick={stopAll}>
            Stop
          </PillButton>
        )}
        {running && (
          <span className={styles.progress}>
            {doneCount} / {jobs.length} done
          </span>
        )}
      </div>
    </div>
  )
}

export default WorkflowView
