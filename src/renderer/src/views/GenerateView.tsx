import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './GenerateView.module.css'
import { PillButton } from '../components/PillButton'
import { toMediaUrlAsync } from '../utils/mediaUrl'
import type { HistoryEntry } from '../types'

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

type GenerateStatus = 'idle' | 'queuing' | 'pending' | 'running' | 'done' | 'error'

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
  const [comfyUrl, setComfyUrl] = useState('http://localhost:8188')
  const [status, setStatus] = useState<GenerateStatus>('idle')
  const [queuePos, setQueuePos] = useState<number | null>(null)
  const [promptId, setPromptId] = useState<string | null>(null)
  const [outputImages, setOutputImages] = useState<string[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [thumbUrl, setThumbUrl] = useState<string>('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load settings on mount to get comfyUrl
  useEffect(() => {
    window.api.settings.get().then((s) => {
      setComfyUrl((s.comfyUrl ?? 'http://localhost:8188').replace(/\/$/, ''))
    }).catch(() => {})
  }, [])

  // Sync prompt when entry changes
  useEffect(() => {
    if (entry?.prompt) {
      setParams((prev) => ({ ...prev, prompt: entry.prompt }))
    }
  }, [entry?.prompt])

  // Load thumbnail
  useEffect(() => {
    if (!entry?.thumbnailPath) return
    toMediaUrlAsync(entry.thumbnailPath).then(setThumbUrl).catch(() => {})
  }, [entry?.thumbnailPath])

  // Poll ComfyUI status when queued
  useEffect(() => {
    if (!promptId || status === 'done' || status === 'error' || status === 'idle') return

    pollRef.current = setInterval(async () => {
      try {
        const res = await (window.api as any).comfy.getStatus({ promptId, comfyUrl }) as {
          status: string
          queuePosition?: number
          outputs?: string[]
        }
        if (res.status === 'done') {
          setStatus('done')
          setOutputImages(res.outputs ?? [])
          if (pollRef.current) clearInterval(pollRef.current)
        } else if (res.status === 'running') {
          setStatus('running')
          setQueuePos(null)
        } else if (res.status === 'pending') {
          setStatus('pending')
          setQueuePos(res.queuePosition ?? null)
        }
      } catch {
        // keep polling
      }
    }, 2500)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [promptId, status, comfyUrl])

  const set = useCallback(<K extends keyof WorkflowParams>(key: K, val: WorkflowParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: val }))
  }, [])

  const handleQueue = useCallback(async () => {
    setStatus('queuing')
    setErrorMsg(null)
    setOutputImages([])
    setPromptId(null)
    try {
      const workflow = await window.api.workflow.buildImage({
        prompt: params.prompt,
        negativePrompt: params.negativePrompt
      })
      // Patch in our params
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
      const result = await (window.api as any).comfy.queue({ workflow, comfyUrl }) as { promptId: string }
      setPromptId(result.promptId)
      setStatus('pending')
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }, [params, comfyUrl])

  const handleRandomSeed = useCallback(() => {
    set('seed', randomSeed())
  }, [set])

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

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        {/* Header */}
        <div className={styles.header}>
          <button type="button" className={styles.backBtn} onClick={onBack}>
            ← Gallery
          </button>
          <div className={styles.entryInfo}>
            {thumbUrl && <img className={styles.thumb} src={thumbUrl} alt="" />}
            <div className={styles.entryMeta}>
              <span className={styles.kindBadge}>{entry.kind}</span>
              <span className={styles.fileName}>{entry.fileName}</span>
            </div>
          </div>
        </div>

        <div className={styles.body}>
          {/* Left: prompt + params */}
          <div className={styles.left}>
            {/* Prompt */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Prompt</div>
              <textarea
                className={styles.promptArea}
                value={params.prompt}
                onChange={(e) => set('prompt', e.target.value)}
                rows={5}
                spellCheck={false}
              />
            </div>

            {/* Parameters */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Parameters</div>

              <div className={styles.field}>
                <label className={styles.label}>Checkpoint</label>
                <input
                  className={styles.input}
                  type="text"
                  value={params.checkpoint}
                  onChange={(e) => set('checkpoint', e.target.value)}
                  spellCheck={false}
                  placeholder="sd_xl_base_1.0.safetensors"
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Negative prompt</label>
                <textarea
                  className={styles.input}
                  value={params.negativePrompt}
                  onChange={(e) => set('negativePrompt', e.target.value)}
                  rows={2}
                  spellCheck={false}
                />
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.label}>Steps — {params.steps}</label>
                  <input
                    type="range" min={10} max={50} step={1}
                    value={params.steps}
                    onChange={(e) => set('steps', Number(e.target.value))}
                    className={styles.slider}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>CFG — {params.cfg.toFixed(1)}</label>
                  <input
                    type="range" min={1} max={20} step={0.5}
                    value={params.cfg}
                    onChange={(e) => set('cfg', Number(e.target.value))}
                    className={styles.slider}
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Seed</label>
                <div className={styles.seedRow}>
                  <input
                    className={styles.input}
                    type="number"
                    value={params.seed}
                    onChange={(e) => set('seed', Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <button type="button" className={styles.diceBtn} onClick={handleRandomSeed} title="Randomize seed">
                    🎲
                  </button>
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Output size</label>
                <div className={styles.sizePresets}>
                  {SIZE_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className={[styles.sizeBtn, activeSize?.label === p.label ? styles.sizeBtnActive : ''].join(' ')}
                      onClick={() => { set('width', p.w); set('height', p.h) }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className={styles.actions}>
              <PillButton
                variant="primary"
                onClick={handleQueue}
                disabled={status === 'queuing' || status === 'pending' || status === 'running'}
              >
                {status === 'queuing' ? 'Sending…' : 'Send to ComfyUI ▶'}
              </PillButton>
            </div>
          </div>

          {/* Right: status + output */}
          <div className={styles.right}>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Status</div>
              {status === 'idle' && (
                <div className={styles.statusRow}>
                  <span className={[styles.dot, styles.dotIdle].join(' ')} />
                  <span className={styles.statusText}>Ready to generate</span>
                </div>
              )}
              {status === 'queuing' && (
                <div className={styles.statusRow}>
                  <span className={[styles.dot, styles.dotPending].join(' ')} />
                  <span className={styles.statusText}>Sending to ComfyUI…</span>
                </div>
              )}
              {status === 'pending' && (
                <div className={styles.statusRow}>
                  <span className={[styles.dot, styles.dotPending].join(' ')} />
                  <span className={styles.statusText}>
                    Queued{queuePos != null ? ` — position ${queuePos}` : ''}
                  </span>
                </div>
              )}
              {status === 'running' && (
                <div className={styles.statusRow}>
                  <span className={[styles.dot, styles.dotRunning].join(' ')} />
                  <span className={styles.statusText}>Generating…</span>
                </div>
              )}
              {status === 'done' && (
                <div className={styles.statusRow}>
                  <span className={[styles.dot, styles.dotDone].join(' ')} />
                  <span className={styles.statusText}>Done ✓</span>
                </div>
              )}
              {status === 'error' && (
                <div className={styles.statusCol}>
                  <div className={styles.statusRow}>
                    <span className={[styles.dot, styles.dotError].join(' ')} />
                    <span className={styles.statusText}>Error</span>
                  </div>
                  {errorMsg && <span className={styles.errorMsg}>{errorMsg}</span>}
                </div>
              )}
            </div>

            {/* Output images */}
            {outputImages.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Output</div>
                <div className={styles.outputGrid}>
                  {outputImages.map((url, i) => (
                    <img key={i} src={url} className={styles.outputImg} alt={`output ${i + 1}`} />
                  ))}
                </div>
              </div>
            )}

            {/* ComfyUI URL */}
            <div className={styles.section} style={{ marginTop: 'auto' }}>
              <div className={styles.sectionTitle}>ComfyUI Server</div>
              <div className={styles.hint}>{comfyUrl}</div>
              <div className={styles.hint} style={{ marginTop: 4 }}>
                Change in Settings → ComfyUI
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default GenerateView
