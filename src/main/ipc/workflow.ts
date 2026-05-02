import { dialog, ipcMain } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { getSettings } from '../store'
import {
  buildAnimateDiffWorkflow,
  buildImageWorkflow,
  WorkflowJSON
} from '../services/workflow'

interface BuildImageArgs {
  prompt: string
  negativePrompt?: string
}

interface BuildVideoArgs {
  masterPrompt: string
  keyframes: Array<{ timeSec: number; prompt: string }>
  duration: number
}

interface SaveArgs {
  workflow: WorkflowJSON
  defaultFileName: string
}

export type SaveResult =
  | { saved: true; path: string }
  | { saved: false; canceled: true }

export function registerWorkflowHandlers(): void {
  ipcMain.handle('workflow:buildImage', async (_event, args: BuildImageArgs): Promise<WorkflowJSON> => {
    if (!args?.prompt) throw new Error('workflow:buildImage requires a prompt')
    return buildImageWorkflow({
      prompt: args.prompt,
      negativePrompt: args.negativePrompt
    })
  })

  ipcMain.handle('workflow:buildVideo', async (_event, args: BuildVideoArgs): Promise<WorkflowJSON> => {
    if (!args?.masterPrompt) {
      throw new Error('workflow:buildVideo requires a masterPrompt')
    }
    return buildAnimateDiffWorkflow({
      masterPrompt: args.masterPrompt,
      frames: args.keyframes ?? [],
      totalDurationSec: args.duration ?? 0
    })
  })

  ipcMain.handle('workflow:save', async (_event, args: SaveArgs): Promise<SaveResult> => {
    if (!args?.workflow) throw new Error('workflow:save requires a workflow')
    const settings = getSettings()
    const defaultDir = settings.outputFolder?.trim() || ''
    const defaultPath = defaultDir
      ? join(defaultDir, args.defaultFileName)
      : args.defaultFileName

    const result = await dialog.showSaveDialog({
      title: 'Save ComfyUI workflow',
      defaultPath,
      filters: [
        { name: 'ComfyUI workflow JSON', extensions: ['json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return { saved: false, canceled: true }
    }

    const json = JSON.stringify(args.workflow, null, 2)
    await writeFile(result.filePath, json, 'utf-8')
    return { saved: true, path: result.filePath }
  })
}
