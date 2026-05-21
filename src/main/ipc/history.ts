import { ipcMain, BrowserWindow } from 'electron'
import { addHistoryEntry, clearHistory, deleteHistoryEntry, listHistory, HistoryEntry } from '../historyStore'
import { registerPath } from '../services/mediaServer'
import { getSettings } from '../store'
import { ensureInbox } from '../projectsStore'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

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
    (_event, entry: Omit<HistoryEntry, 'id' | 'projectId'> & { id?: string; projectId?: string }): HistoryEntry => {
      // Resolve projectId: explicit > settings.lastProjectId > Inbox
      const explicit = entry.projectId
      const settingsHint = getSettings().lastProjectId
      const projectId = explicit ?? settingsHint ?? ensureInbox()
      const saved = addHistoryEntry({ ...entry, projectId })
      broadcast('history:update', listHistory())
      return saved
    }
  )

  ipcMain.handle('history:delete', (_event, id: string): void => {
    deleteHistoryEntry(id)
    broadcast('history:update', listHistory())
  })

  ipcMain.handle('history:clear', (): void => {
    clearHistory()
    broadcast('history:update', listHistory())
  })
}
