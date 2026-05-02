import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './SettingsView.module.css'
import { PillButton } from '../components/PillButton'

interface Settings {
  ollamaBaseUrl: string
  ollamaModel: string
  maxKeyframes: number
  outputFolder: string
}

export function SettingsView(): React.JSX.Element {
  const [form, setForm] = useState<Settings>({
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaModel: 'llava',
    maxKeyframes: 8,
    outputFolder: ''
  })
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load current settings on mount
  useEffect(() => {
    window.api.settings.get().then((s) => setForm(s)).catch(console.error)
  }, [])

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
    setError(null)
  }, [])

  const fetchModels = useCallback(async () => {
    setLoadingModels(true)
    setError(null)
    try {
      // Use the Ollama tags endpoint directly from renderer (same host as user configured)
      const url = `${form.ollamaBaseUrl.replace(/\/+$/, '')}/api/tags`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { models?: Array<{ name?: string }> }
      const names = (data.models ?? []).map((m) => m.name ?? '').filter(Boolean)
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
