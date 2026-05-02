import { ipcMain } from 'electron'
import { getSettings, resetSettings, setSettings, Settings } from '../store'
import { registerAnalyzeHandlers } from './analyze'

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

  registerAnalyzeHandlers()
}
