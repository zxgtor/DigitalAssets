import { ipcMain } from 'electron'
import { getSettings, resetSettings, setSettings, Settings } from '../store'
import { registerAnalyzeHandlers } from './analyze'
import { registerVideoHandlers } from './video'
import { registerHistoryHandlers } from './history'
import { registerWorkflowHandlers } from './workflow'
import { checkHealth, listModels } from '../services/ollama'

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

  registerAnalyzeHandlers()
  registerVideoHandlers()
  registerHistoryHandlers()
  registerWorkflowHandlers()
}
