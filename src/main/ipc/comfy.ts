import { ipcMain, app, shell } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { getSettings } from '../store'
import type { WorkflowJSON } from '../services/workflow'
import { getPool } from '../services/workstationPool'

export interface ComfyOpenArgs {
  workflow: WorkflowJSON
  fileName: string
}

export interface ComfyOpenResult {
  savedPath: string
  comfyUrl: string
}

function sanitize(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9-_]+/g, '_')
      .slice(0, 80) || 'workflow'
  )
}

type ComfyStatus = 'pending' | 'running' | 'done' | 'error' | 'unknown'

export function registerComfyHandlers(): void {
  // ── Thin wrapper: forwards to workstationPool ────────────────────────────
  ipcMain.handle(
    'comfy:queue',
    async (_event, args: { workflow: WorkflowJSON; comfyUrl: string }): Promise<{ promptId: string }> => {
      const pool = getPool()
      const normalized = (args.comfyUrl ?? '').trim().replace(/\/$/, '').toLowerCase()
      const match = pool.list().find((w) => w.url.toLowerCase() === normalized)
      if (!match) {
        console.warn('[comfy:queue] unknown comfyUrl, falling back to scheduler:', args.comfyUrl)
      }
      const jobId = await pool.submit({
        workflow: args.workflow,
        hints: match ? { preferWorkstation: match.id } : {}
      })
      // Wait briefly for promptId — for backward compat (callers expect promptId).
      // The job may still be 'submitting' but typically transitions within 100ms.
      for (let i = 0; i < 50; i++) {  // 50 * 100ms = 5s max
        const job = pool.getJobs().find((j) => j.id === jobId)
        if (!job) break
        if (job.promptId) return { promptId: job.promptId }
        if (job.status === 'error') throw new Error(job.error ?? 'submission failed')
        await new Promise((r) => setTimeout(r, 100))
      }
      throw new Error('Timed out waiting for ComfyUI prompt_id')
    }
  )

  ipcMain.handle(
    'comfy:getStatus',
    async (
      _event,
      args: { promptId: string; comfyUrl: string }
    ): Promise<{ status: ComfyStatus; queuePosition?: number; outputs?: string[] }> => {
      const pool = getPool()
      const job = pool.getJobs().find((j) => j.promptId === args.promptId)
      if (!job) return { status: 'unknown' }
      if (job.status === 'done') return { status: 'done', outputs: job.outputs ?? [] }
      if (job.status === 'pending') return { status: 'pending', queuePosition: job.queuePosition }
      if (job.status === 'running') return { status: 'running' }
      if (job.status === 'error') return { status: 'error' }
      return { status: 'unknown' }
    }
  )

  // ── Open workflow in ComfyUI (legacy — save JSON + open folder) ───────────
  ipcMain.handle(
    'comfy:open',
    async (_event, args: ComfyOpenArgs): Promise<ComfyOpenResult> => {
      if (!args?.workflow) throw new Error('comfy:open requires a workflow')

      const settings = getSettings()
      const dir = join(app.getPath('userData'), 'comfy-workflows')
      await fs.mkdir(dir, { recursive: true })

      const base = sanitize(args.fileName ?? 'workflow')
      const ts = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19)
      const savedPath = join(dir, `${base}-${ts}.json`)

      await fs.writeFile(savedPath, JSON.stringify(args.workflow, null, 2), 'utf-8')

      // Open the containing folder so the user can drag the JSON onto ComfyUI.
      shell.showItemInFolder(savedPath)
      // Bring up the ComfyUI tab.
      const comfyUrl = settings.comfyUrl?.trim() || 'http://localhost:8188'
      void shell.openExternal(comfyUrl)

      return { savedPath, comfyUrl }
    }
  )
}
