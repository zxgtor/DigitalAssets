import { app } from 'electron'
import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  rmSync
} from 'fs'
import { join, extname, resolve } from 'path'
import { randomUUID } from 'crypto'

export const REF_CAP = 10

export interface StoredCharacter {
  id: string
  name: string
  description: string
  triggerWord: string | null
  loraName: string | null
  loraWeight: number
  defaultCheckpoint: string | null
  referenceImages: string[]
  ipAdapterWeight: number
  createdAt: number
}

function getCharactersPath(): string {
  return join(app.getPath('userData'), 'characters.json')
}

function getCharFolder(id: string): string {
  return join(app.getPath('userData'), 'characters', id)
}

function getRefsFolder(id: string): string {
  return join(getCharFolder(id), 'refs')
}

function readFromDisk(): StoredCharacter[] {
  const p = getCharactersPath()
  if (!existsSync(p)) return []
  try {
    const raw = readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StoredCharacter[]) : []
  } catch {
    return []
  }
}

function writeToDisk(list: StoredCharacter[]): void {
  const p = getCharactersPath()
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8')
  renameSync(tmp, p)
}

export function listCharacters(): StoredCharacter[] {
  return readFromDisk().sort((a, b) => a.name.localeCompare(b.name))
}

export function getCharacter(id: string): StoredCharacter | undefined {
  return readFromDisk().find((c) => c.id === id)
}

export interface AddCharacterInput {
  name: string
  description?: string
  triggerWord?: string | null
  loraName?: string | null
  loraWeight?: number
  defaultCheckpoint?: string | null
  ipAdapterWeight?: number
}

export function addCharacter(input: AddCharacterInput): StoredCharacter {
  const name = input.name.trim()
  if (!name) throw new Error('Name required')
  const id = randomUUID()
  const c: StoredCharacter = {
    id,
    name,
    description: input.description ?? '',
    triggerWord: input.triggerWord ?? null,
    loraName: input.loraName ?? null,
    loraWeight: input.loraWeight ?? 0.8,
    defaultCheckpoint: input.defaultCheckpoint ?? null,
    ipAdapterWeight: input.ipAdapterWeight ?? 0.6,
    referenceImages: [],
    createdAt: Date.now()
  }
  mkdirSync(getRefsFolder(id), { recursive: true })
  const list = readFromDisk()
  list.push(c)
  writeToDisk(list)
  return c
}

type UpdatablePatch = Partial<Omit<StoredCharacter, 'id' | 'createdAt' | 'referenceImages'>>

export function updateCharacter(id: string, patch: UpdatablePatch): StoredCharacter {
  const list = readFromDisk()
  const idx = list.findIndex((c) => c.id === id)
  if (idx < 0) throw new Error('Character not found')
  const next = { ...list[idx] }
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim()
    if (!trimmed) throw new Error('Name required')
    next.name = trimmed
  }
  if (patch.description !== undefined) next.description = patch.description
  if (patch.triggerWord !== undefined) next.triggerWord = patch.triggerWord
  if (patch.loraName !== undefined) next.loraName = patch.loraName
  if (patch.loraWeight !== undefined) next.loraWeight = patch.loraWeight
  if (patch.defaultCheckpoint !== undefined) next.defaultCheckpoint = patch.defaultCheckpoint
  if (patch.ipAdapterWeight !== undefined) next.ipAdapterWeight = patch.ipAdapterWeight
  // referenceImages intentionally NOT updatable via this channel
  list[idx] = next
  writeToDisk(list)
  return next
}

export function deleteCharacter(id: string): void {
  const list = readFromDisk()
  if (!list.some((c) => c.id === id)) throw new Error('Character not found')
  // Remove folder (cascade ref files).
  rmSync(getCharFolder(id), { recursive: true, force: true })
  writeToDisk(list.filter((c) => c.id !== id))
}

export function addReference(id: string, sourcePath: string): string {
  const list = readFromDisk()
  const idx = list.findIndex((c) => c.id === id)
  if (idx < 0) throw new Error('Character not found')
  if (!existsSync(sourcePath)) throw new Error('Source file not found')
  if (list[idx].referenceImages.length >= REF_CAP) {
    throw new Error(`Reference image cap reached (${REF_CAP})`)
  }
  const ext = extname(sourcePath) || '.png'
  const refsFolder = getRefsFolder(id)
  mkdirSync(refsFolder, { recursive: true })
  const refPath = join(refsFolder, `${randomUUID()}${ext}`)
  copyFileSync(sourcePath, refPath)
  list[idx] = { ...list[idx], referenceImages: [...list[idx].referenceImages, refPath] }
  writeToDisk(list)
  return refPath
}

export function removeReference(id: string, refPath: string): void {
  const list = readFromDisk()
  const idx = list.findIndex((c) => c.id === id)
  if (idx < 0) throw new Error('Character not found')
  // Defense against path traversal: refPath must be inside the character's refs folder.
  const refsFolder = resolve(getRefsFolder(id))
  const resolvedRef = resolve(refPath)
  if (!resolvedRef.startsWith(refsFolder)) {
    throw new Error('Invalid reference path')
  }
  if (existsSync(resolvedRef)) unlinkSync(resolvedRef)
  list[idx] = {
    ...list[idx],
    referenceImages: list[idx].referenceImages.filter((p) => p !== refPath)
  }
  writeToDisk(list)
}
