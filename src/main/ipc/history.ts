import { ipcMain } from 'electron'
import { addHistoryEntry, clearHistory, listHistory, HistoryEntry } from '../historyStore'

export function registerHistoryHandlers(): void {
  ipcMain.handle('history:list', (): HistoryEntry[] => {
    return listHistory()
  })

  ipcMain.handle(
    'history:add',
    (_event, entry: Omit<HistoryEntry, 'id'>): HistoryEntry => {
      return addHistoryEntry(entry)
    }
  )

  ipcMain.handle('history:clear', (): void => {
    clearHistory()
  })
}
