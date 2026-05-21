import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './GenerateView.module.css'
import { PillButton } from '../components/PillButton'
import { toMediaUrlAsync } from '../utils/mediaUrl'
import { WorkstationPanel } from '../components/WorkstationPanel'
import { QueuePanel } from '../components/QueuePanel'
import { useWorkstationPool } from '../hooks/useWorkstationPool'
import { useProjects } from '../hooks/useProjects'
import type { HistoryEntry, SchedulerMode } from '../types'

interface GenerateViewProps {
  entry: HistoryEntry | null
  onBack: () => void
}

interface WorkflowParams {
  prompt: string
  negativePrompt: string
  checkpoint: string
  steps: number
  cfg: number
  seed: number
  width: number
  height: number
}

const SIZE_PRESETS = [
  { label: '512×512', w: 512, h: 512 },
  { label: '768×768', w: 768, h: 768 },
  { label: '1024×1024', w: 1024, h: 1024 },
  { label: '1024×768', w: 1024, h: 768 },
  { label: '768×1024', w: 768, h: 1024 },
  { label: '1216×832', w: 1216, h: 832 }
]

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff)
}

export function GenerateView({ entry, onBack }: GenerateViewProps): React.JSX.Element {
  const pool = useWorkstationPool()
  const { projects } = useProjects()
  const [saveTo, setSaveTo] = useState<string>('')
  const [params, setParams] = useState<WorkflowParams>({
    prompt: entry?.prompt ?? '',
    negativePrompt: 'blurry, low quality, deformed, watermark, text, nsfw',
    checkpoint: 'sd_xl_base_1.0.safetensors',
    steps: 25,
    cfg: 7.0,
    seed: randomSeed(),
    width: 1024,
    height: 1024
  })
  const [thumbUrl, setThumbUrl] = useState<string>('')
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [runOn, setRunOn] = useState<string>('auto')           // 'auto' or workstation id
  const [globalMode, setGlobalMode] = useState<SchedulerMode>('lan-pool')
  const [wsOpen, setWsOpen] = useState(true)
  const [qOpen, setQOpen] = useState(true)
  const savedJobIds = useRef<Set<string>>(new Set())
  const saveToRef = useRef<string>('')

  // Load persisted settings (mode + panel toggle states) once.
  useEffect(() => {
    void window.api.settings.get().then((s) => {
      setGlobalMode(s.schedulerMode)
      setWsOpen(s.ui.workstationsPanelOpen)
      setQOpen(s.ui.queuePanelOpen)
    })
  }, [])

  const saveToInitialized = useRef(false)

  // Initialize saveTo from settings.lastProjectId (or first project if null).
  // Guard with a ref so this fires exactly once, preventing a projects:update
  // event (rename/create/delete) from clobbering the user's mid-session choice.
  useEffect(() => {
    if (saveToInitialized.current) return
    if (projects.length === 0) return // wait for projects to load
    saveToInitialized.current = true
    void window.api.settings.get().then((s) => {
      if (s.lastProjectId) setSaveTo(s.lastProjectId)
      else setSaveTo(projects[0].id)
    })
  }, [projects])

  const onWsToggle = useCallback((open: boolean): void => {
    setWsOpen(open)
    void window.api.settings.set({ ui: { workstationsPanelOpen: open, queuePanelOpen: qOpen } })
  }, [qOpen])

  const onQToggle = useCallback((open: boolean): void => {
    setQOpen(open)
    void window.api.settings.set({ ui: { workstationsPanelOpen: wsOpen, queuePanelOpen: open } })
  }, [wsOpen])

  useEffect(() => {
    if (entry?.prompt) setParams((prev) => ({ ...prev, prompt: entry.prompt }))
  }, [entry?.prompt])

  useEffect(() => {
    if (!entry?.thumbnailPath) return
    toMediaUrlAsync(entry.thumbnailPath).then(setThumbUrl).catch(() => {})
  }, [entry?.thumbnailPath])

  // Keep saveToRef in sync so the job-completion effect always reads the latest value.
  useEffect(() => {
    saveToRef.current = saveTo
  }, [saveTo])

  // Default selected job = most recent one
  useEffect(() => {
    if (selectedJobId == null && pool.jobs.length > 0) {
      setSelectedJobId(pool.jobs[0].id)
    }
  }, [pool.jobs, selectedJobId])

  // Watch for newly-completed jobs and persist them to history.
  useEffect(() => {
    if (!entry) return
    for (const job of pool.jobs) {
      if (job.status !== 'done') continue
      if (savedJobIds.current.has(job.id)) continue
      savedJobIds.current.add(job.id)
      const projectId = saveToRef.current
      void (async () => {
        await window.api.history.add({
          kind: entry.kind,
          filePath: entry.filePath,
          fileName: entry.fileName,
          prompt: params.prompt,
          createdAt: job.finishedAt ?? Date.now(),
          thumbnailPath: job.outputs?.[0],
          ...(projectId ? { projectId } : {})
        })
        // Bump sticky default if changed.
        const current = await window.api.settings.get()
        if (projectId && current.lastProjectId !== projectId) {
          await window.api.settings.set({ lastProjectId: projectId })
        }
      })()
    }
  }, [pool.jobs, entry, params.prompt])

  const set = useCallback(<K extends keyof WorkflowParams>(key: K, val: WorkflowParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: val }))
  }, [])

  const handleQueue = useCallback(async () => {
    try {
      const workflow = await window.api.workflow.buildImage({
        prompt: params.prompt,
        negativePrompt: params.negativePrompt
      })
      if (workflow['4']) workflow['4'].inputs.ckpt_name = params.checkpoint
      if (workflow['3']) {
        workflow['3'].inputs.steps = params.steps
        workflow['3'].inputs.cfg = params.cfg
        workflow['3'].inputs.seed = params.seed
      }
      if (workflow['5']) {
        workflow['5'].inputs.width = params.width
        workflow['5'].inputs.height = params.height
      }
      const pref = runOn === 'auto' ? undefined : runOn
      const jobId = await pool.submit(workflow, pref)
      setSelectedJobId(jobId)
    } catch (err) {
      // pool.submit doesn't throw; errors land in the job. Network errors on the IPC bridge would though.
      // eslint-disable-next-line no-alert
      alert(`Submit failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [params, runOn, pool])

  const handleRandomSeed = useCallback(() => set('seed', randomSeed()), [set])
  const onRetry = useCallback(async (jobId: string) => {
    const job = pool.jobs.find((j) => j.id === jobId)
    if (!job) return
    await pool.removeJob(jobId)
    // Build a fresh workflow with current params (job.workflow is the original; user may have tweaked)
    await handleQueue()
  }, [pool, handleQueue])

  if (!entry) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>⊕</div>
        <div className={styles.emptyTitle}>Nothing selected</div>
        <div className={styles.emptyHint}>Go to Gallery and click ⊕ on an item to generate</div>
        <PillButton variant="ghost" size="sm" onClick={onBack}>← Gallery</PillButton>
      </div>
    )
  }

  const activeSize = SIZE_PRESETS.find((p) => p.w === params.width && p.h === params.height)
  const selectedJob = pool.jobs.find((j) => j.id === selectedJobId) ?? pool.jobs[0]
  const autoLabel = globalMode === 'per-model' ? 'Auto (per model)' : 'Auto (LAN pool)'
  const showAuto = globalMode !== 'manual'

  // Empty state: no workstations at all → prompt to add
  const noWorkstations = !pool.loading && pool.workstations.length === 0

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <button type="button" className={styles.backBtn} onClick={onBack}>← Gallery</button>
          <div className={styles.entryInfo}>
            {thumbUrl && <img className={styles.thumb} src={thumbUrl} alt="" />}
            <div className={styles.entryMeta}>
              <span className={styles.kindBadge}>{entry.kind}</span>
              <span className={styles.fileName}>{entry.fileName}</span>
            </div>
          </div>
        </div>

        {noWorkstations && (
          <div className={styles.noWsBanner}>
            <span>Add a workstation to start generating.</span>
            <span style={{ opacity: 0.6, marginLeft: 8 }}>Open Settings → Workstations.</span>
          </div>
        )}

        <div className={styles.body}>
          <div className={styles.left}>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Prompt</div>
              <textarea className={styles.promptArea} value={params.prompt}
                onChange={(e) => set('prompt', e.target.value)} rows={5} spellCheck={false} />
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>Parameters</div>

              <div className={styles.field}>
                <label className={styles.label}>Checkpoint</label>
                <input className={styles.input} type="text" value={params.checkpoint}
                  onChange={(e) => set('checkpoint', e.target.value)} spellCheck={false} />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Negative prompt</label>
                <textarea className={styles.input} value={params.negativePrompt}
                  onChange={(e) => set('negativePrompt', e.target.value)} rows={2} spellCheck={false} />
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.label}>Steps — {params.steps}</label>
                  <input type="range" min={10} max={50} step={1} value={params.steps}
                    onChange={(e) => set('steps', Number(e.target.value))} className={styles.slider} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>CFG — {params.cfg.toFixed(1)}</label>
                  <input type="range" min={1} max={20} step={0.5} value={params.cfg}
                    onChange={(e) => set('cfg', Number(e.target.value))} className={styles.slider} />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Seed</label>
                <div className={styles.seedRow}>
                  <input className={styles.input} type="number" value={params.seed}
                    onChange={(e) => set('seed', Number(e.target.value))} style={{ flex: 1 }} />
                  <button type="button" className={styles.diceBtn} onClick={handleRandomSeed}>🎲</button>
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Output size</label>
                <div className={styles.sizePresets}>
                  {SIZE_PRESETS.map((p) => (
                    <button key={p.label} type="button"
                      className={[styles.sizeBtn, activeSize?.label === p.label ? styles.sizeBtnActive : ''].join(' ')}
                      onClick={() => { set('width', p.w); set('height', p.h) }}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.runOnRow}>
              <label className={styles.label}>Save to</label>
              <select
                className={styles.input}
                value={saveTo}
                onChange={(e) => setSaveTo(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className={styles.runOnRow}>
              <label className={styles.label}>Run on</label>
              <select
                className={styles.input}
                value={runOn}
                onChange={(e) => setRunOn(e.target.value)}
              >
                {showAuto && <option value="auto">{autoLabel}</option>}
                {pool.workstations.map((w) => (
                  <option key={w.id} value={w.id} disabled={!w.enabled}>
                    {w.name} {w.status === 'offline' ? '(offline)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.actions}>
              <PillButton variant="primary" onClick={handleQueue} disabled={noWorkstations}>
                Send to ComfyUI ▶
              </PillButton>
            </div>
          </div>

          <div className={styles.right}>
            <WorkstationPanel
              workstations={pool.workstations}
              open={wsOpen}
              onToggle={onWsToggle}
              onRefresh={(id) => void pool.refreshModels(id)}
            />
            <QueuePanel
              jobs={pool.jobs}
              workstations={pool.workstations}
              selectedJobId={selectedJobId}
              open={qOpen}
              onToggle={onQToggle}
              onSelect={setSelectedJobId}
              onCancel={(id) => void pool.cancel(id)}
              onRetry={(id) => void onRetry(id)}
              onRemove={(id) => void pool.removeJob(id)}
              onClearDone={() => void pool.clearDoneJobs()}
            />
            {selectedJob && selectedJob.outputs && selectedJob.outputs.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Outputs</div>
                <div className={styles.outputGrid}>
                  {selectedJob.outputs.map((url, i) => (
                    <img key={i} src={url} className={styles.outputImg} alt={`output ${i + 1}`} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default GenerateView
