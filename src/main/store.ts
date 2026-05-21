import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

// ─── Schemas ────────────────────────────────────────────────────────────────

export interface StoredWorkstation {
  id: string
  name: string
  url: string
  enabled: boolean
}

export type SchedulerMode = 'lan-pool' | 'per-model' | 'manual'

/** Legacy v1 shape — preserved so old settings.json files still load. */
export interface SettingsV1 {
  ollamaBaseUrl: string
  ollamaModel: string
  maxKeyframes: number
  outputFolder: string
  comfyUrl: string
}

export interface SettingsV2 extends SettingsV1 {
  version: 2
  workstations: StoredWorkstation[]
  schedulerMode: SchedulerMode
  discovery: { portRange: [number, number] }
  ui: { workstationsPanelOpen: boolean; queuePanelOpen: boolean }
}

export interface SettingsV3 extends Omit<SettingsV2, 'version'> {
  version: 3
  lastProjectId: string | null
}

/** Public type. Always v3 once `getSettings()` returns. */
export type Settings = SettingsV3

export const DEFAULT_SETTINGS: Settings = {
  version: 3,
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llava',
  maxKeyframes: 8,
  outputFolder: '',
  comfyUrl: 'http://localhost:8188',
  workstations: [],
  schedulerMode: 'lan-pool',
  discovery: { portRange: [8188, 8190] },
  ui: { workstationsPanelOpen: true, queuePanelOpen: true },
  lastProjectId: null
}

// ─── Migration ──────────────────────────────────────────────────────────────

/**
 * Convert any persisted settings object to v3. Idempotent.
 *
 * v1 → v3: the legacy `comfyUrl` becomes the first workstation entry
 * (or `[]` if it was empty), then lastProjectId is added as null.
 * v2 → v3: lastProjectId is added as null.
 */
export function migrateSettings(
  raw: Partial<SettingsV3> & Partial<SettingsV2> & Partial<SettingsV1>
): SettingsV3 {
  if (raw.version === 3) {
    return { ...DEFAULT_SETTINGS, ...raw, version: 3 }
  }

  // First, normalize to v2 (handles v1 path inline).
  let v2: SettingsV2
  if (raw.version === 2) {
    v2 = { ...DEFAULT_SETTINGS, ...raw, version: 2 } as SettingsV2
  } else {
    const comfyUrl = (raw.comfyUrl ?? '').trim().replace(/\/$/, '')
    const workstations: StoredWorkstation[] = comfyUrl
      ? [{ id: randomUUID(), name: 'Local ComfyUI', url: comfyUrl, enabled: true }]
      : []
    v2 = {
      ...DEFAULT_SETTINGS,
      ...raw,
      version: 2,
      workstations,
      schedulerMode: 'lan-pool',
      discovery: { portRange: [8188, 8190] },
      ui: { workstationsPanelOpen: true, queuePanelOpen: true }
    } as SettingsV2
  }

  // v2 → v3: add lastProjectId field (null until first generation picks one).
  return { ...v2, version: 3, lastProjectId: null }
}

// ─── Disk I/O ───────────────────────────────────────────────────────────────

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function readFromDisk(): Settings {
  const path = getSettingsPath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS }
  try {
    const raw = readFileSync(path, 'utf-8')
    return migrateSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Atomic write: tmp file + rename. */
function writeToDisk(settings: Settings): void {
  const path = getSettingsPath()
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8')
  renameSync(tmp, path)
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function getSettings(): Settings {
  return readFromDisk()
}

export function setSettings(partial: Partial<Settings>): Settings {
  const current = readFromDisk()
  const next: Settings = { ...current, ...partial }
  writeToDisk(next)
  return next
}

export function resetSettings(): Settings {
  const fresh = { ...DEFAULT_SETTINGS }
  writeToDisk(fresh)
  return fresh
}
