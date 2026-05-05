import { ipcMain, app, shell } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import axios from 'axios'
import { getSettings } from '../store'
import type { WorkflowJSON } from '../services/workflow'

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
  // ── Queue workflow directly to ComfyUI API ────────────────────────────────
  ipcMain.handle(
    'comfy:queue',
    async (_event, args: { workflow: WorkflowJSON; comfyUrl: string }): Promise<{ promptId: string }> => {
      const url = (args.comfyUrl || 'http://localhost:8188').replace(/\/$/, '')
      const clientId = `digitalassets-${Date.now()}`
      const response = await axios.post(
        `${url}/prompt`,
        { prompt: args.workflow, client_id: clientId },
        { timeout: 10_000 }
      )
      const promptId = response.data?.prompt_id as string
      if (!promptId) throw new Error('ComfyUI did not return a prompt_id')
      return { promptId }
    }
  )

  // ── Poll ComfyUI for prompt status ────────────────────────────────────────
  ipcMain.handle(
    'comfy:getStatus',
    async (
      _event,
      args: { promptId: string; comfyUrl: string }
    ): Promise<{ status: ComfyStatus; queuePosition?: number; outputs?: string[] }> => {
      const url = (args.comfyUrl || 'http://localhost:8188').replace(/\/$/, '')

      // 1. Check history — if the entry is there, it finished
      try {
        const hist = await axios.get(`${url}/history/${args.promptId}`, { timeout: 5_000 })
        const entry = hist.data?.[args.promptId]
        if (entry) {
          const outputs: string[] = []
          for (const nodeOut of Object.values(entry.outputs ?? {}) as Record<string, unknown>[]) {
            const imgs = (nodeOut as { images?: { filename: string; subfolder?: string; type?: string }[] }).images
            if (imgs) {
              for (const img of imgs) {
                outputs.push(
                  `${url}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${img.type ?? 'output'}`
                )
              }
            }
          }
          return { status: 'done', outputs }
        }
      } catch {
        /* not in history yet */
      }

      // 2. Check the queue
      try {
        const q = await axios.get(`${url}/queue`, { timeout: 5_000 })
        const running: unknown[][] = q.data?.queue_running ?? []
        const pending: unknown[][] = q.data?.queue_pending ?? []

        if (running.some((item) => item[1] === args.promptId)) {
          return { status: 'running' }
        }
        const pendingIdx = pending.findIndex((item) => item[1] === args.promptId)
        if (pendingIdx >= 0) {
          return { status: 'pending', queuePosition: pendingIdx + 1 }
        }
      } catch {
        /* queue check failed */
      }

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
