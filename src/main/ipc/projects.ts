import { ipcMain, BrowserWindow } from 'electron'
import {
  listProjects,
  addProject,
  renameProject,
  deleteProject,
  ensureInbox,
  type StoredProject
} from '../projectsStore'
import { removeByProject, listHistory } from '../historyStore'
import { getSettings, setSettings } from '../store'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerProjectHandlers(): void {
  // Ensure Inbox exists at startup; if first run, also re-point any
  // entries that have no projectId (legacy v0/v1 history).
  const inboxId = ensureInbox()
  const legacy = listHistory().filter((e) => !e.projectId || e.projectId === '')
  if (legacy.length > 0) {
    const fs = require('fs')
    const path = require('path')
    const { app } = require('electron')
    const histPath = path.join(app.getPath('userData'), 'history.json')
    const fixed = listHistory().map((e) =>
      e.projectId && e.projectId !== '' ? e : { ...e, projectId: inboxId }
    )
    fs.writeFileSync(histPath, JSON.stringify(fixed, null, 2), 'utf-8')
  }

  // If settings.lastProjectId is null, set it to inbox.
  const s = getSettings()
  if (s.lastProjectId === null) {
    setSettings({ lastProjectId: inboxId })
  }

  ipcMain.handle('projects:list', (): StoredProject[] => listProjects())

  ipcMain.handle('projects:create', (_e, args: { name: string }): StoredProject => {
    const p = addProject(args.name)
    broadcast('projects:update', listProjects())
    return p
  })

  ipcMain.handle('projects:rename', (_e, args: { id: string; name: string }): StoredProject => {
    const p = renameProject(args.id, args.name)
    broadcast('projects:update', listProjects())
    return p
  })

  ipcMain.handle('projects:delete', (_e, args: { id: string }): void => {
    if (args.id === inboxId) throw new Error("Inbox cannot be deleted — it's the default")
    // Cascade-delete entries first.
    const removedEntries = removeByProject(args.id)
    deleteProject(args.id)
    // If sticky default points to the deleted project, fall back to Inbox.
    if (getSettings().lastProjectId === args.id) {
      setSettings({ lastProjectId: inboxId })
    }
    broadcast('projects:update', listProjects())
    if (removedEntries > 0) broadcast('history:update', listHistory())
  })
}
