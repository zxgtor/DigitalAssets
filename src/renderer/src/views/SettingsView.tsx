import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './SettingsView.module.css'
import { PillButton } from '../components/PillButton'
import { useWorkstationPool } from '../hooks/useWorkstationPool'
import { DiscoverDialog } from '../components/DiscoverDialog'
import type { SchedulerMode } from '../types'

interface Settings {
  ollamaBaseUrl: string
  ollamaModel: string
  maxKeyframes: number
  outputFolder: string
  comfyUrl: string
}

export function SettingsView(): React.JSX.Element {
  const [form, setForm] = useState<Settings>({
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaModel: 'llava',
    maxKeyframes: 8,
    outputFolder: '',
    comfyUrl: 'http://localhost:8188'
  })
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Workstation pool state
  const pool = useWorkstationPool()
  const [mode, setMode] = useState<SchedulerMode>('lan-pool')
  const [showDiscover, setShowDiscover] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  // Load current settings on mount
  useEffect(() => {
    window.api.settings.get().then((s) => setForm(s)).catch(console.error)
  }, [])

  useEffect(() => {
    void window.api.settings.get().then((s) => setMode(s.schedulerMode))
  }, [])

  const onTestNew = async (): Promise<void> => {
    setTesting(true); setTestResult(null)
    const r = await pool.testConnection(newUrl)
    setTesting(false)
    setTestResult(r.ok ? `✓ ${r.gpu}` : `✗ ${r.error}`)
  }

  const onAddNew = async (): Promise<void> => {
    if (!newName.trim() || !newUrl.trim()) return
    await pool.add({ name: newName.trim(), url: newUrl.trim() })
    setNewName(''); setNewUrl(''); setTestResult(null); setShowAddDialog(false)
  }

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
    setError(null)
  }, [])

  const fetchModels = useCallback(async () => {
    setLoadingModels(true)
    setError(null)
    try {
      // Route through main process — renderer-side fetch hits CORS for any
      // non-localhost Ollama URL (LAN, remote, etc.) since Ollama doesn't
      // ship CORS headers and the renderer is a different origin.
      const names = await window.api.ollama.listModels(form.ollamaBaseUrl)
      setAvailableModels(names)
    } catch (err) {
      setError(`Could not reach Ollama: ${(err as Error).message}`)
      setAvailableModels([])
    } finally {
      setLoadingModels(false)
    }
  }, [form.ollamaBaseUrl])

  const handleSave = useCallback(async () => {
    try {
      await window.api.settings.set(form)
      setSaved(true)
      setError(null)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(`Save failed: ${(err as Error).message}`)
    }
  }, [form])

  const handleReset = useCallback(async () => {
    try {
      const defaults = await window.api.settings.reset()
      setForm(defaults)
      setSaved(false)
      setError(null)
    } catch (err) {
      setError(`Reset failed: ${(err as Error).message}`)
    }
  }, [])

  return (
    <div className={styles.wrap}>
      <div className={styles.column}>
        <div className={styles.heading}>Settings</div>

        {/* Ollama section */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Ollama</div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="ollamaBaseUrl">
              Server URL
            </label>
            <input
              id="ollamaBaseUrl"
              className={styles.input}
              type="text"
              value={form.ollamaBaseUrl}
              onChange={(e) => set('ollamaBaseUrl', e.target.value)}
              placeholder="http://localhost:11434"
              spellCheck={false}
            />
            <span className={styles.hint}>
              Base URL of your local Ollama instance.
            </span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="ollamaModel">
              Vision model
            </label>
            <div className={styles.modelRow}>
              <input
                id="ollamaModel"
                className={styles.input}
                type="text"
                value={form.ollamaModel}
                onChange={(e) => set('ollamaModel', e.target.value)}
                placeholder="llava"
                spellCheck={false}
              />
              <PillButton variant="ghost" size="sm" onClick={fetchModels} disabled={loadingModels}>
                {loadingModels ? '…' : 'Fetch'}
              </PillButton>
            </div>
            {availableModels.length > 0 && (
              <div className={styles.modelList}>
                {availableModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={styles.modelChip}
                    onClick={() => set('ollamaModel', m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
            <span className={styles.hint}>
              Must be a multimodal model (e.g. llava, llava:13b, bakllava).
            </span>
          </div>
        </div>

        <div className={styles.divider} />

        {/* Workstations section */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Workstations</div>

          <div className={styles.field}>
            <div className={styles.label}>Scheduler mode</div>
            {(['lan-pool', 'per-model', 'manual'] as const).map((m) => (
              <label key={m} className={styles.radioRow}>
                <input
                  type="radio"
                  checked={mode === m}
                  onChange={() => { setMode(m); void pool.setMode(m) }}
                />
                <span>
                  {m === 'lan-pool' && 'LAN pool — route to least-busy idle'}
                  {m === 'per-model' && 'Per-model — route by required checkpoint'}
                  {m === 'manual' && 'Manual — pick per job'}
                </span>
              </label>
            ))}
          </div>

          <div className={styles.workstationList}>
            {pool.workstations.length === 0 && (
              <div className={styles.empty}>No workstations yet. Add manually or discover.</div>
            )}
            {pool.workstations.map((w) => (
              <div key={w.id} className={styles.wsRow}>
                <input
                  type="checkbox"
                  checked={w.enabled}
                  onChange={(e) => void pool.edit(w.id, { enabled: e.target.checked })}
                />
                <div className={styles.wsInfo}>
                  <div className={styles.wsName}>{w.name}</div>
                  <div className={styles.wsUrl}>{w.url}</div>
                  <div className={styles.wsMeta}>
                    {w.status} · {w.gpu?.name ?? '—'} · {w.models.checkpoints.length} ckpts · {w.models.loras.length} LoRAs
                  </div>
                </div>
                <button onClick={() => void pool.refreshModels(w.id)} title="Refresh models">↻</button>
                <button onClick={() => {
                  if (confirm(`Remove '${w.name}'?`)) void pool.remove(w.id).catch((e) => alert((e as Error).message))
                }}>✕</button>
              </div>
            ))}
          </div>

          <div className={styles.wsActions}>
            <button onClick={() => setShowAddDialog(true)}>+ Add workstation</button>
            <button onClick={() => setShowDiscover(true)}>⚲ Discover on LAN…</button>
          </div>

          {showAddDialog && (
            <div className={styles.inlineDialog}>
              <input placeholder="Name (e.g. PC-1)" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <input placeholder="http://host:8188" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
              <div className={styles.inlineActions}>
                <button onClick={onTestNew} disabled={testing || !newUrl.trim()}>
                  {testing ? 'Testing…' : 'Test'}
                </button>
                <button onClick={onAddNew} disabled={!newName.trim() || !newUrl.trim()}>Save</button>
                <button onClick={() => { setShowAddDialog(false); setTestResult(null) }}>Cancel</button>
              </div>
              {testResult && <div className={styles.testResult}>{testResult}</div>}
            </div>
          )}
        </section>

        <DiscoverDialog
          open={showDiscover}
          onClose={() => setShowDiscover(false)}
          onDiscover={pool.discover}
          onAdd={async (cands) => {
            for (const c of cands) {
              await pool.add({ name: `Workstation @ ${c.url.replace(/^https?:\/\//, '')}`, url: c.url })
            }
          }}
        />

        <div className={styles.divider} />

        {/* ComfyUI section (legacy) */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>ComfyUI URL (legacy)</div>
          <div className={styles.legacyHint}>
            Migrated to Workstation #1. Edit there instead. This field will be removed in Phase 2.
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="comfyUrl">
              Server URL
            </label>
            <input
              id="comfyUrl"
              className={styles.input}
              type="text"
              value={form.comfyUrl}
              onChange={(e) => set('comfyUrl', e.target.value)}
              placeholder="http://localhost:8188"
              spellCheck={false}
            />
            <span className={styles.hint}>
              URL of your ComfyUI instance. Used to queue and monitor generation.
            </span>
          </div>
        </section>

        <div className={styles.divider} />

        {/* Video section */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Video</div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="maxKeyframes">
              Max keyframes
            </label>
            <input
              id="maxKeyframes"
              className={styles.input}
              type="number"
              min={1}
              max={16}
              value={form.maxKeyframes}
              onChange={(e) => set('maxKeyframes', Math.max(1, Math.min(16, Number(e.target.value))))}
            />
            <span className={styles.hint}>
              Number of frames extracted per video (1–16). More frames = better coverage, slower analysis.
            </span>
          </div>
        </div>

        <div className={styles.divider} />

        {/* Actions */}
        <div className={styles.actions}>
          <PillButton variant="primary" onClick={handleSave}>
            Save
          </PillButton>
          <PillButton variant="ghost" onClick={handleReset}>
            Reset to defaults
          </PillButton>
          {saved && <span className={styles.saved}>Saved ✓</span>}
          {error && <span className={styles.errorMsg}>{error}</span>}
        </div>
      </div>
    </div>
  )
}

export default SettingsView
