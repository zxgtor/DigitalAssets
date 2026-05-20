import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getSettings, resetSettings, setSettings, Settings } from '../store'
import { registerAnalyzeHandlers } from './analyze'
import { registerVideoHandlers } from './video'
import { registerHistoryHandlers } from './history'
import { registerWorkflowHandlers } from './workflow'
import { registerComfyHandlers } from './comfy'
import { registerWorkstationHandlers } from './workstations'
import { checkHealth, listModels } from '../services/ollama'
import { getMediaPort } from '../services/mediaServer'

export function registerIpcHandlers(): void {
  ipcMain.handle('settings:get', () => {
    return getSettings()
  })

  ipcMain.handle('settings:set', (_event, partial: Partial<Settings>) => {
    return setSettings(partial)
  })

  ipcMain.handle('settings:reset', () => {
    return resetSettings()
  })

  // Proxy Ollama HTTP calls through the main process so they bypass
  // the renderer's CORS / file:// origin restrictions.
  ipcMain.handle('ollama:checkHealth', async (_event, baseUrl: string): Promise<boolean> => {
    return checkHealth(baseUrl)
  })

  ipcMain.handle('ollama:listModels', async (_event, baseUrl: string): Promise<string[]> => {
    return listModels(baseUrl)
  })

  ipcMain.handle('media:getPort', (): number => getMediaPort())

  ipcMain.handle('dialog:openMedia', async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose an image or video',
      properties: ['openFile'],
      filters: [
        {
          name: 'Image or Video',
          extensions: [
            'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp',
            'mp4', 'mov', 'mkv', 'webm', 'avi'
          ]
        },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  registerAnalyzeHandlers()
  registerVideoHandlers()
  registerHistoryHandlers()
  registerWorkflowHandlers()
  registerComfyHandlers()
  registerWorkstationHandlers()
}
