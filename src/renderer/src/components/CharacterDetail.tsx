import { useState, useEffect, useRef, useCallback } from 'react'
import type { StoredCharacter } from '@preload/index'
import { useWorkstationPool } from '../hooks/useWorkstationPool'
import styles from './CharacterDetail.module.css'

const REF_CAP = 10

interface Props {
  open: boolean
  character: StoredCharacter | null
  onClose: () => void
  onSave: (patch: Partial<Omit<StoredCharacter, 'id' | 'createdAt' | 'referenceImages'>>) => Promise<void>
  onAddReference: (sourcePath: string) => Promise<void>
  onRemoveReference: (refPath: string) => Promise<void>
}

export function CharacterDetail(props: Props): React.JSX.Element | null {
  const { open, character, onClose, onSave, onAddReference, onRemoveReference } = props
  const pool = useWorkstationPool()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [triggerWord, setTriggerWord] = useState('')
  const [loraName, setLoraName] = useState<string>('')
  const [loraWeight, setLoraWeight] = useState(0.8)
  const [defaultCheckpoint, setDefaultCheckpoint] = useState<string>('')
  const [ipAdapterWeight, setIpAdapterWeight] = useState(0.6)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Seed state when the character changes.
  useEffect(() => {
    if (!character) return
    setName(character.name)
    setDescription(character.description)
    setTriggerWord(character.triggerWord ?? '')
    setLoraName(character.loraName ?? '')
    setLoraWeight(character.loraWeight)
    setDefaultCheckpoint(character.defaultCheckpoint ?? '')
    setIpAdapterWeight(character.ipAdapterWeight)
    setError(null)
  }, [character])

  // Union of all workstation models for dropdowns.
  const allLoras = Array.from(new Set(pool.workstations.flatMap((w) => w.models.loras))).sort()
  const allCheckpoints = Array.from(new Set(pool.workstations.flatMap((w) => w.models.checkpoints))).sort()

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError('Name required')
      return
    }
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        description,
        triggerWord: triggerWord.trim() === '' ? null : triggerWord.trim(),
        loraName: loraName === '' ? null : loraName,
        loraWeight,
        defaultCheckpoint: defaultCheckpoint === '' ? null : defaultCheckpoint,
        ipAdapterWeight
      })
      onClose()
    } catch (e) {
      setError((e as Error).message ?? String(e))
    } finally {
      setSaving(false)
    }
  }, [name, description, triggerWord, loraName, loraWeight, defaultCheckpoint, ipAdapterWeight, onSave, onClose])

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || !character) return
      for (let i = 0; i < files.length; i++) {
        const file = files[i] as File & { path?: string }
        if (!file.path) continue // skip drag-drop entries without path
        if (character.referenceImages.length + i >= REF_CAP) {
          setError(`Reference image cap reached (${REF_CAP})`)
          break
        }
        try {
          await onAddReference(file.path)
        } catch (e) {
          setError((e as Error).message)
          break
        }
      }
    },
    [character, onAddReference]
  )

  if (!open || !character) return null

  const atCap = character.referenceImages.length >= REF_CAP

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>Edit character</div>
        <div className={styles.body}>
          {/* Left column: fields */}
          <div className={styles.fields}>
            <label className={styles.field}>
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>Description</span>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. tall warrior, silver hair, blue cloak"
              />
            </label>
            <label className={styles.field}>
              <span>Trigger word</span>
              <input
                value={triggerWord}
                onChange={(e) => setTriggerWord(e.target.value)}
                placeholder="optional, e.g. ariax"
              />
            </label>
            <label className={styles.field}>
              <span>LoRA</span>
              <select value={loraName} onChange={(e) => setLoraName(e.target.value)}>
                <option value="">None</option>
                {allLoras.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>LoRA weight: {loraWeight.toFixed(2)}</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={loraWeight}
                onChange={(e) => setLoraWeight(Number(e.target.value))}
              />
            </label>
            <label className={styles.field}>
              <span>Default checkpoint</span>
              <select
                value={defaultCheckpoint}
                onChange={(e) => setDefaultCheckpoint(e.target.value)}
              >
                <option value="">None</option>
                {allCheckpoints.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>IPAdapter weight: {ipAdapterWeight.toFixed(2)}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={ipAdapterWeight}
                onChange={(e) => setIpAdapterWeight(Number(e.target.value))}
              />
            </label>
            {error && <div className={styles.error}>✗ {error}</div>}
          </div>

          {/* Right column: reference images */}
          <div className={styles.refs}>
            <div className={styles.refsHeader}>
              Reference images ({character.referenceImages.length}/{REF_CAP})
            </div>
            <div
              className={[styles.refGrid, dragOver ? styles.dragOver : ''].join(' ')}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                void handleFiles(e.dataTransfer.files)
              }}
            >
              {character.referenceImages.map((p) => (
                <div key={p} className={styles.refItem}>
                  <img src={`file:///${p.replace(/\\/g, '/')}`} alt="ref" />
                  <button
                    className={styles.refRemove}
                    title="Remove"
                    onClick={() => void onRemoveReference(p)}
                  >✕</button>
                </div>
              ))}
              {character.referenceImages.length === 0 && (
                <div className={styles.refEmpty}>
                  Drag images here, or click + Add image
                </div>
              )}
            </div>
            <button
              className={styles.addBtn}
              disabled={atCap}
              onClick={() => fileInputRef.current?.click()}
            >
              {atCap ? 'Cap reached' : '+ Add image'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                void handleFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
        </div>
        <div className={styles.footer}>
          <button onClick={onClose}>Cancel</button>
          <button
            className={styles.saveBtn}
            disabled={saving || !name.trim()}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CharacterDetail
