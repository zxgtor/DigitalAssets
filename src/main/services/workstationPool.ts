import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import axios from 'axios'
import type { WorkflowJSON } from './workflow'
import type { StoredWorkstation, SchedulerMode } from '../store'
import { getSettings, setSettings } from '../store'
import { Semaphore } from '../utils/semaphore'
import { extractRequiredModels } from '../utils/workflowAnalyze'
import { discover as runDiscovery, type DiscoveryCandidate } from '../utils/discovery'

/** Global gate so /object_info never runs more than once at a time across all workstations. */
const objectInfoGate = new Semaphore(1)

/** Global gate so we never POST /prompt more than 4x in parallel. */
const submitGate = new Semaphore(4)
const MAX_SUBMIT_RETRIES = 2

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
  private failureCounts = new Map<string, number>()
  private healthInterval: NodeJS.Timeout | null = null
  private readonly POLL_INTERVAL_MS = 5_000
  private readonly OFFLINE_AFTER_FAILURES = 3
  private jobs = new Map<string, Job>()
  private currentMode: SchedulerMode = 'lan-pool'
  private readonly UNKNOWN_THRESHOLD = 20
  private unknownCounts = new Map<string, number>()

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

  /** Begin the 5s health-polling loop. */
  start(): void {
    if (this.healthInterval) return
    this.healthInterval = setInterval(() => { void this.pollOnce() }, this.POLL_INTERVAL_MS)
    void this.pollOnce()
  }

  /** Stop the health loop. Safe to call from tests / shutdown. */
  stop(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval)
      this.healthInterval = null
    }
  }

  /** Run one pass of health checks. Exposed for tests. */
  async pollOnce(): Promise<void> {
    const enabled = this.list().filter((w) => w.enabled)
    await Promise.all(enabled.map((w) => this.checkOne(w)))
  }

  private async checkOne(ws: Workstation): Promise<void> {
    try {
      const stats = await axios.get(`${ws.url}/system_stats`, { timeout: 3_000 })
      const queue = await axios.get(`${ws.url}/queue`, { timeout: 3_000 })
      this.failureCounts.set(ws.id, 0)

      const firstContact = ws.lastSeenAt === undefined

      const dev = (stats.data?.devices?.[0] ?? {}) as Record<string, unknown>
      ws.gpu = {
        name: (dev.name as string) ?? 'unknown GPU',
        vramTotal: (dev.vram_total as number) ?? 0,
        vramFree: (dev.vram_free as number) ?? 0
      }
      const running = Array.isArray(queue.data?.queue_running) ? queue.data.queue_running.length : 0
      const pending = Array.isArray(queue.data?.queue_pending) ? queue.data.queue_pending.length : 0
      ws.queueDepth = running + pending
      ws.status = running > 0 ? 'busy' : 'online'
      ws.lastSeenAt = Date.now()

      if (firstContact && ws.models.checkpoints.length === 0) {
        // fire-and-forget; refresh emits its own update event
        void this.refreshModels(ws.id)
      }

      // NEW: update jobs running on this workstation
      await this.refreshJobsFor(ws)
    } catch {
      const failures = (this.failureCounts.get(ws.id) ?? 0) + 1
      this.failureCounts.set(ws.id, failures)
      if (failures >= this.OFFLINE_AFTER_FAILURES) {
        ws.status = 'offline'
        ws.queueDepth = 0
      }
      // refreshJobsFor must also run here: test 3 ("transitions to done …") mocks
      // /system_stats and /history but NOT /queue, so checkOne()'s own axios.get(/queue)
      // at line 163 throws and control jumps to this catch block before the try-block
      // call to refreshJobsFor is reached.  refreshJobsFor's internal /queue fetch is
      // wrapped in its own try/catch (queueData stays null), so /history is still
      // queried and the job transitions to 'done' correctly.
      await this.refreshJobsFor(ws)
    } finally {
      this.emit('workstations:update', this.list())
    }
  }

  async refreshModels(id: string): Promise<void> {
    const ws = this.workstations.get(id)
    if (!ws) return
    await objectInfoGate.run(async () => {
      try {
        const res = await axios.get(`${ws.url}/object_info`, {
          timeout: 30_000,
          maxContentLength: 50_000_000
        })
        const info = res.data as Record<string, any>
        ws.models = {
          checkpoints: info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [],
          loras:       info?.LoraLoader?.input?.required?.lora_name?.[0] ?? [],
          vae:         info?.VAELoader?.input?.required?.vae_name?.[0] ?? []
        }
      } catch {
        // leave as-is on failure; UI shows last-known list
      } finally {
        this.emit('workstations:update', this.list())
      }
    })
  }

  async discoverOnLan(opts: {
    portRange: [number, number]
    onCandidate?: (c: DiscoveryCandidate) => void
  }): Promise<DiscoveryCandidate[]> {
    const existing = this.list().map((w) => w.url.toLowerCase())
    return runDiscovery({
      portRange: opts.portRange,
      skipUrls: existing,
      onCandidate: opts.onCandidate
    })
  }

  private async refreshJobsFor(ws: Workstation): Promise<void> {
    const myJobs = Array.from(this.jobs.values()).filter(
      (j) => j.workstationId === ws.id && (j.status === 'pending' || j.status === 'running')
    )
    if (myJobs.length === 0) return

    // Snapshot /queue once per workstation; reuse across jobs.
    let queueData: { queue_running: any[][]; queue_pending: any[][] } | null = null
    try {
      const q = await axios.get(`${ws.url}/queue`, { timeout: 3_000 })
      queueData = { queue_running: q.data?.queue_running ?? [], queue_pending: q.data?.queue_pending ?? [] }
    } catch { /* leave null */ }

    for (const job of myJobs) {
      if (!job.promptId) continue
      try {
        // 1. History first — if there, it's done.
        const hist = await axios.get(`${ws.url}/history/${job.promptId}`, { timeout: 5_000 })
        const entry = hist.data?.[job.promptId]
        if (entry) {
          const outputs: string[] = []
          for (const nodeOut of Object.values(entry.outputs ?? {}) as Record<string, unknown>[]) {
            const imgs = (nodeOut as { images?: { filename: string; subfolder?: string; type?: string }[] }).images
            if (imgs) {
              for (const img of imgs) {
                outputs.push(
                  `${ws.url}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${img.type ?? 'output'}`
                )
              }
            }
          }
          job.status = 'done'
          job.outputs = outputs
          job.finishedAt = Date.now()
          this.unknownCounts.delete(job.id)
          continue
        }

        // 2. Queue — running vs pending.
        if (queueData) {
          if (queueData.queue_running.some((item) => item[1] === job.promptId)) {
            job.status = 'running'
            job.queuePosition = undefined
            this.unknownCounts.delete(job.id)
            continue
          }
          const idx = queueData.queue_pending.findIndex((item) => item[1] === job.promptId)
          if (idx >= 0) {
            job.status = 'pending'
            job.queuePosition = idx + 1
            this.unknownCounts.delete(job.id)
            continue
          }
        }

        // 3. Unknown — increment.
        const u = (this.unknownCounts.get(job.id) ?? 0) + 1
        this.unknownCounts.set(job.id, u)
        if (u >= this.UNKNOWN_THRESHOLD) {
          job.status = 'error'
          job.error = `Lost track of job on '${ws.name}' (ComfyUI may have restarted). Click Retry.`
          job.finishedAt = Date.now()
          this.unknownCounts.delete(job.id)
        }
      } catch {
        /* network blip — try again next cycle */
      }
    }
    this.emit('jobs:update', this.getJobs())
  }

  // ── Testing seams (no-op in prod) ─────────────────────────────────────────

  /** @internal — used only in unit tests to seed state without HTTP. */
  __test_setWorkstations(list: Workstation[]): void {
    this.workstations.clear()
    for (const w of list) this.workstations.set(w.id, w)
  }

  /** @internal */
  __test_setStatus(id: string, status: Workstation['status']): void {
    const ws = this.workstations.get(id)
    if (ws) ws.status = status
  }

  /** @internal — used only in unit tests. */
  __test_seedJob(job: Job): void {
    this.jobs.set(job.id, job)
  }

  // ── Jobs ─────────────────────────────────────────────────────────────────

  setMode(mode: SchedulerMode): void {
    this.currentMode = mode
  }

  getJobs(): Job[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt)
  }

  clearDoneJobs(): void {
    for (const [id, j] of this.jobs) if (j.status === 'done') this.jobs.delete(id)
    this.emit('jobs:update', this.getJobs())
  }

  removeJob(id: string): void {
    this.jobs.delete(id)
    this.emit('jobs:update', this.getJobs())
  }

  async submit(args: {
    workflow: WorkflowJSON
    hints: { preferWorkstation?: string }
    mode?: SchedulerMode
  }): Promise<string> {
    const mode = args.mode ?? this.currentMode
    const requireModel = extractRequiredModels(args.workflow)
    const job: Job = {
      id: randomUUID(),
      workstationId: null,
      promptId: null,
      workflow: args.workflow,
      hints: { ...args.hints, requireModel },
      status: 'queued',
      promptPreview: extractPromptPreview(args.workflow),
      createdAt: Date.now()
    }
    this.jobs.set(job.id, job)
    this.emit('jobs:update', this.getJobs())

    // Try up to (MAX_SUBMIT_RETRIES + 1) different workstations.
    const tried = new Set<string>()
    for (let attempt = 0; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
      const ws = this.pick({ mode, preferWorkstation: args.hints.preferWorkstation, requireModel })
      if (!ws) {
        if (tried.size > 0) {
          this.failJob(job, `All eligible workstations rejected the job`)
        } else {
          this.failJob(job, this.noPickReason(mode, args.hints.preferWorkstation, requireModel))
        }
        return job.id
      }
      if (tried.has(ws.id)) {
        this.failJob(job, `All eligible workstations rejected the job`)
        return job.id
      }
      tried.add(ws.id)
      job.workstationId = ws.id
      job.status = 'submitting'
      this.emit('jobs:update', this.getJobs())

      try {
        await submitGate.run(async () => {
          const res = await axios.post(
            `${ws.url}/prompt`,
            { prompt: args.workflow, client_id: `digitalassets-${Date.now()}` },
            { timeout: 10_000 }
          )
          const promptId = res.data?.prompt_id as string | undefined
          if (!promptId) throw new Error('ComfyUI did not return a prompt_id')
          job.promptId = promptId
          job.status = 'pending'
          job.startedAt = Date.now()
        })
        this.emit('jobs:update', this.getJobs())
        return job.id
      } catch (err) {
        // Mark this workstation offline immediately so the next pick skips it.
        ws.status = 'offline'
        this.emit('workstations:update', this.list())
        // continue retry loop
        if (attempt === MAX_SUBMIT_RETRIES) {
          this.failJob(job, `Workstation '${ws.name}' rejected the job: ${(err as Error).message}`)
          return job.id
        }
      }
    }
    return job.id
  }

  private failJob(job: Job, reason: string): void {
    job.status = 'error'
    job.error = reason
    job.finishedAt = Date.now()
    this.emit('jobs:update', this.getJobs())
  }

  private noPickReason(mode: SchedulerMode, pref: string | undefined, req: { checkpoints: string[]; loras: string[]; vae: string[] }): string {
    if (mode === 'manual' && !pref) return 'Pick a workstation from "Run on" before sending.'
    if (pref) return `Workstation '${pref}' not found or disabled.`
    const anyOnline = this.list().some((w) => w.enabled && (w.status === 'online' || w.status === 'busy'))
    if (!anyOnline) return 'No workstations are online. Check your network, or click "Discover on LAN" in Settings.'
    const missing = req.checkpoints.find((m) => !this.list().some((w) => w.models.checkpoints.includes(m)))
    if (missing) return `No workstation has '${missing}'. Refresh model lists with ↻, or pick a different checkpoint.`
    return 'No workstation matched the job constraints.'
  }

  // ── Scheduler ─────────────────────────────────────────────────────────────

  pick(opts: {
    mode: SchedulerMode
    preferWorkstation?: string
    requireModel: { checkpoints: string[]; loras: string[]; vae: string[] }
  }): Workstation | null {
    // 1. Hard pin always wins.
    if (opts.preferWorkstation) {
      const pinned = this.workstations.get(opts.preferWorkstation)
      if (pinned && pinned.enabled) return pinned
      return null
    }

    // 2. Manual mode requires a pin.
    if (opts.mode === 'manual') return null

    // 3. Filter to candidates.
    let candidates = this.list().filter((w) => w.enabled && (w.status === 'online' || w.status === 'busy'))

    if (opts.mode === 'per-model') {
      const need = opts.requireModel
      const hasAll = (w: Workstation): boolean =>
        need.checkpoints.every((m) => w.models.checkpoints.includes(m)) &&
        need.loras.every((m)       => w.models.loras.includes(m)) &&
        need.vae.every((m)         => w.models.vae.includes(m))
      // Empty requireModel = no constraint = lan-pool behavior.
      const anyConstraint = need.checkpoints.length + need.loras.length + need.vae.length > 0
      if (anyConstraint) candidates = candidates.filter(hasAll)
    }

    if (candidates.length === 0) return null

    // 4. Sort by queueDepth asc, tie-break by random.
    candidates.sort((a, b) => {
      if (a.queueDepth !== b.queueDepth) return a.queueDepth - b.queueDepth
      return Math.random() - 0.5
    })
    return candidates[0]
  }
}

function extractPromptPreview(wf: WorkflowJSON): string {
  for (const node of Object.values(wf)) {
    if (node.class_type === 'CLIPTextEncode') {
      const t = (node.inputs as Record<string, unknown>).text
      if (typeof t === 'string' && t.length > 0) {
        return t.length > 50 ? t.slice(0, 50) + '…' : t
      }
    }
  }
  return ''
}

let _singleton: WorkstationPool | null = null

export function getPool(): WorkstationPool {
  if (!_singleton) _singleton = new WorkstationPool({ persist: true })
  return _singleton
}
