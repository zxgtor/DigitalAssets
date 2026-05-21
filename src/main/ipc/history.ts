import { ipcMain } from 'electron'
import { addHistoryEntry, clearHistory, deleteHistoryEntry, listHistory, HistoryEntry } from '../historyStore'
import { registerPath } from '../services/mediaServer'
import { ensureInbox } from '../projectsStore'

export function registerHistoryHandlers(): void {
  ipcMain.handle('history:list', (): HistoryEntry[] => {
    const entries = listHistory()
    // Re-register persistent paths from prior sessions so the media
    // server allows the renderer to fetch them.
    for (const e of entries) {
      if (e.thumbnailPath) registerPath(e.thumbnailPath)
      if (e.videoPath) registerPath(e.videoPath)
    }
    return entries
  })

  ipcMain.handle(
    'history:add',
    (_event, entry: Omit<HistoryEntry, 'id'> & { id?: string }): HistoryEntry => {
      return addHistoryEntry({ ...entry, projectId: entry.projectId ?? ensureInbox() })
    }
  )

  ipcMain.handle('history:delete', (_event, id: string): void => {
    deleteHistoryEntry(id)
  })

  ipcMain.handle('history:clear', (): void => {
    clearHistory()
  })
}
