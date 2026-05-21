import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export interface StoredProject {
  id: string
  name: string
  createdAt: number
}

function getProjectsPath(): string {
  return join(app.getPath('userData'), 'projects.json')
}

function readFromDisk(): StoredProject[] {
  const p = getProjectsPath()
  if (!existsSync(p)) return []
  try {
    const raw = readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StoredProject[]) : []
  } catch {
    return []
  }
}

function writeToDisk(projects: StoredProject[]): void {
  const p = getProjectsPath()
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(projects, null, 2), 'utf-8')
  renameSync(tmp, p)
}

export function listProjects(): StoredProject[] {
  return readFromDisk().sort((a, b) => a.createdAt - b.createdAt)
}

export function getProject(id: string): StoredProject | undefined {
  return readFromDisk().find((p) => p.id === id)
}

export function addProject(name: string): StoredProject {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Name required')
  const p: StoredProject = { id: randomUUID(), name: trimmed, createdAt: Date.now() }
  const list = readFromDisk()
  list.push(p)
  writeToDisk(list)
  return p
}

export function renameProject(id: string, name: string): StoredProject {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Name required')
  const list = readFromDisk()
  const target = list.find((p) => p.id === id)
  if (!target) throw new Error('Project not found')
  target.name = trimmed
  writeToDisk(list)
  return target
}

export function deleteProject(id: string): void {
  const list = readFromDisk()
  if (!list.some((p) => p.id === id)) throw new Error('Project not found')
  writeToDisk(list.filter((p) => p.id !== id))
}

/** Returns the id of the first (oldest) project, creating an "Inbox" if none exists. */
export function ensureInbox(): string {
  const list = readFromDisk().sort((a, b) => a.createdAt - b.createdAt)
  if (list.length > 0) return list[0].id
  const inbox = addProject('Inbox')
  return inbox.id
}
