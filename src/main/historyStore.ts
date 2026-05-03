import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface HistoryEntry {
  id: string
  kind: 'image' | 'video'
  filePath: string
  fileName: string
  prompt: string
  model?: string
  durationSec?: number
  frameCount?: number
  durationMs?: number
  createdAt: number
  /** Persistent thumbnail (under userData/thumbnails). */
  thumbnailPath?: string
  /** Playable video — local source path or persisted copy under userData/videos. */
  videoPath?: string
}

const MAX_ENTRIES = 100

function getHistoryPath(): string {
  return join(app.getPath('userData'), 'history.json')
}

function readFromDisk(): HistoryEntry[] {
  const path = getHistoryPath()
  if (!existsSync(path)) return []
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : []
  } catch {
    return []
  }
}

function writeToDisk(entries: HistoryEntry[]): void {
  writeFileSync(getHistoryPath(), JSON.stringify(entries, null, 2), 'utf-8')
}

export function listHistory(): HistoryEntry[] {
  return readFromDisk()
}

export function addHistoryEntry(
  entry: Omit<HistoryEntry, 'id'> & { id?: string }
): HistoryEntry {
  const entries = readFromDisk()
  const { id: providedId, ...rest } = entry
  const newEntry: HistoryEntry = {
    ...rest,
    id: providedId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
  // Prepend newest first, cap at MAX_ENTRIES
  const next = [newEntry, ...entries].slice(0, MAX_ENTRIES)
  writeToDisk(next)
  return newEntry
}

export function clearHistory(): void {
  writeToDisk([])
}
