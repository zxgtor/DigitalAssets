import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import type { WorkflowJSON } from './workflow'
import type { StoredWorkstation } from '../store'
import { getSettings, setSettings } from '../store'

// ─── Public types ───────────────────────────────────────────────────────────

export interface Workstation extends StoredWorkstation {
  status: 'online' | 'busy' | 'offline' | 'unknown'
  models: { checkpoints: string[]; loras: string[]; vae: string[] }
  queueDepth: number
  gpu?: { name: string; vramTotal: number; vramFree: number }
  lastSeenAt?: number
}

export type JobStatus =
  | 'queued'
  | 'submitting'
  | 'pending'
  | 'running'
  | 'done'
  | 'error'

export interface Job {
  id: string
  workstationId: string | null
  promptId: string | null
  workflow: WorkflowJSON
  hints: { requireModel?: { checkpoints: string[]; loras: string[]; vae: string[] }; preferWorkstation?: string }
  status: JobStatus
  queuePosition?: number
  outputs?: string[]
  error?: string
  promptPreview?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

// ─── Pool ───────────────────────────────────────────────────────────────────

export interface WorkstationPoolOptions {
  persist?: boolean   // default true; tests pass false
}

function normalizeUrl(u: string): string {
  return u.trim().replace(/\/$/, '').toLowerCase()
}

export class WorkstationPool extends EventEmitter {
  private workstations = new Map<string, Workstation>()
  private readonly opts: WorkstationPoolOptions

  constructor(opts: WorkstationPoolOptions = {}) {
    super()
    this.opts = { persist: true, ...opts }
    if (this.opts.persist) this.loadFromSettings()
  }

  private loadFromSettings(): void {
    const s = getSettings()
    for (const ws of s.workstations) {
      this.workstations.set(ws.id, {
        ...ws,
        status: 'unknown',
        models: { checkpoints: [], loras: [], vae: [] },
        queueDepth: 0
      })
    }
  }

  private persist(): void {
    if (!this.opts.persist) return
    const workstations: StoredWorkstation[] = Array.from(this.workstations.values()).map((w) => ({
      id: w.id, name: w.name, url: w.url, enabled: w.enabled
    }))
    setSettings({ workstations })
  }

  list(): Workstation[] {
    return Array.from(this.workstations.values())
  }

  add(input: { name: string; url: string }): Workstation {
    const normalized = normalizeUrl(input.url)
    for (const ws of this.workstations.values()) {
      if (normalizeUrl(ws.url) === normalized) return ws
    }
    const ws: Workstation = {
      id: randomUUID(),
      name: input.name,
      url: input.url.trim().replace(/\/$/, ''),
      enabled: true,
      status: 'unknown',
      models: { checkpoints: [], loras: [], vae: [] },
      queueDepth: 0
    }
    this.workstations.set(ws.id, ws)
    this.persist()
    this.emit('workstations:update', this.list())
    return ws
  }

  remove(id: string): void {
    this.workstations.delete(id)
    this.persist()
    this.emit('workstations:update', this.list())
  }

  edit(id: string, patch: Partial<Pick<Workstation, 'name' | 'url' | 'enabled'>>): void {
    const ws = this.workstations.get(id)
    if (!ws) return
    if (patch.name !== undefined) ws.name = patch.name
    if (patch.url !== undefined) ws.url = patch.url.trim().replace(/\/$/, '')
    if (patch.enabled !== undefined) ws.enabled = patch.enabled
    this.persist()
    this.emit('workstations:update', this.list())
  }
}
