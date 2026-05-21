import { ipcMain, BrowserWindow } from 'electron'
import {
  listCharacters,
  addCharacter,
  updateCharacter,
  deleteCharacter,
  addReference,
  removeReference,
  type StoredCharacter,
  type AddCharacterInput
} from '../charactersStore'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

type UpdatablePatch = Partial<
  Omit<StoredCharacter, 'id' | 'createdAt' | 'referenceImages'>
>

export function registerCharacterHandlers(): void {
  ipcMain.handle('characters:list', (): StoredCharacter[] => listCharacters())

  ipcMain.handle(
    'characters:create',
    (_e, input: AddCharacterInput): StoredCharacter => {
      const c = addCharacter(input)
      broadcast('characters:update', listCharacters())
      return c
    }
  )

  ipcMain.handle(
    'characters:update',
    (_e, args: { id: string; patch: UpdatablePatch }): StoredCharacter => {
      const c = updateCharacter(args.id, args.patch)
      broadcast('characters:update', listCharacters())
      return c
    }
  )

  ipcMain.handle('characters:delete', (_e, args: { id: string }): void => {
    deleteCharacter(args.id)
    broadcast('characters:update', listCharacters())
  })

  ipcMain.handle(
    'characters:addReference',
    (_e, args: { id: string; sourcePath: string }): string => {
      const refPath = addReference(args.id, args.sourcePath)
      broadcast('characters:update', listCharacters())
      return refPath
    }
  )

  ipcMain.handle(
    'characters:removeReference',
    (_e, args: { id: string; refPath: string }): void => {
      removeReference(args.id, args.refPath)
      broadcast('characters:update', listCharacters())
    }
  )
}
