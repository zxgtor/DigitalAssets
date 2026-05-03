import { ipcMain, app, shell } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
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

export function registerComfyHandlers(): void {
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
