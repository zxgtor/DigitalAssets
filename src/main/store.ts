import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface Settings {
  ollamaBaseUrl: string
  ollamaModel: string
  maxKeyframes: number
  outputFolder: string
  comfyUrl: string
}

const DEFAULT_SETTINGS: Settings = {
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llava',
  maxKeyframes: 8,
  outputFolder: '',
  comfyUrl: 'http://localhost:8188'
}

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function readFromDisk(): Settings {
  const path = getSettingsPath()
  if (!existsSync(path)) {
    return { ...DEFAULT_SETTINGS }
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function writeToDisk(settings: Settings): void {
  const path = getSettingsPath()
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8')
}

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
