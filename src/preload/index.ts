import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface Settings {
  ollamaBaseUrl: string
  ollamaModel: string
  maxKeyframes: number
  outputFolder: string
  comfyUrl: string
}

export interface ImageAnalysisResult {
  prompt: string
  model: string
  durationMs: number
  imagePath?: string
  historyId: string
  thumbnailPath?: string
}

export interface VideoKeyframeResult {
  timeSec: number
  thumbnailPath: string
  prompt: string
}

export interface VideoAnalysisResult {
  durationMs: number
  model: string
  duration: number
  width: number
  height: number
  keyframes: VideoKeyframeResult[]
  masterPrompt: string
  videoPath?: string
  sourceTitle?: string
  sourceUrl?: string
  historyId: string
  thumbnailPath?: string
}

export type WorkflowJSON = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>

export type WorkflowSaveResult =
  | { saved: true; path: string }
  | { saved: false; canceled: true }

export interface HistoryEntry {
  id: string
  kind: 'image' | 'video'
  filePath: string
  fileName: string
  prompt: string
  model?: string
  durationSec?: number
  frameCount?: number
  durationMs?: number
  createdAt: number
  thumbnailPath?: string
  videoPath?: string
}

export interface ComfyOpenResult {
  savedPath: string
  comfyUrl: string
}

export interface ComfyOpenArgs {
  workflow: WorkflowJSON
  fileName: string
}

const api = {
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (partial: Partial<Settings>): Promise<Settings> =>
      ipcRenderer.invoke('settings:set', partial),
    reset: (): Promise<Settings> => ipcRenderer.invoke('settings:reset')
  },
  ollama: {
    checkHealth: (baseUrl: string): Promise<boolean> =>
      ipcRenderer.invoke('ollama:checkHealth', baseUrl),
    listModels: (baseUrl: string): Promise<string[]> =>
      ipcRenderer.invoke('ollama:listModels', baseUrl)
  },
  media: {
    getPort: (): Promise<number> => ipcRenderer.invoke('media:getPort')
  },
  dialog: {
    /** Open a native file picker. Returns the chosen absolute path, or null if cancelled. */
    openMedia: (): Promise<string | null> => ipcRenderer.invoke('dialog:openMedia')
  },
  /** Resolve the absolute path of a File object obtained from drag-drop or input.files. */
  getFilePath: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  analyze: {
    image: (filePath: string): Promise<ImageAnalysisResult> =>
      ipcRenderer.invoke('analyze:image', { filePath }),
    video: (filePath: string): Promise<VideoAnalysisResult> =>
      ipcRenderer.invoke('analyze:video', { filePath }),
    youtube: (url: string): Promise<VideoAnalysisResult> =>
      ipcRenderer.invoke('analyze:youtube', { url }),
    onProgress: (callback: (status: string) => void): (() => void) => {
      const handler = (_event: unknown, status: string): void => callback(status)
      ipcRenderer.on('analyze:progress', handler)
      return () => ipcRenderer.removeListener('analyze:progress', handler)
    }
  },
  history: {
    list: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:list'),
    add: (entry: Omit<HistoryEntry, 'id'> & { id?: string }): Promise<HistoryEntry> =>
      ipcRenderer.invoke('history:add', entry),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('history:delete', id),
    clear: (): Promise<void> => ipcRenderer.invoke('history:clear')
  },
  workflow: {
    buildImage: (args: { prompt: string; negativePrompt?: string }): Promise<WorkflowJSON> =>
      ipcRenderer.invoke('workflow:buildImage', args),
    buildVideo: (args: {
      masterPrompt: string
      keyframes: Array<{ timeSec: number; prompt: string }>
      duration: number
    }): Promise<WorkflowJSON> => ipcRenderer.invoke('workflow:buildVideo', args),
    save: (args: {
      workflow: WorkflowJSON
      defaultFileName: string
    }): Promise<WorkflowSaveResult> => ipcRenderer.invoke('workflow:save', args)
  },
  comfy: {
    open: (args: ComfyOpenArgs): Promise<ComfyOpenResult> =>
      ipcRenderer.invoke('comfy:open', args),
    queue: (args: { workflow: WorkflowJSON; comfyUrl: string }): Promise<{ promptId: string }> =>
      ipcRenderer.invoke('comfy:queue', args),
    getStatus: (args: { promptId: string; comfyUrl: string }): Promise<{
      status: 'pending' | 'running' | 'done' | 'error' | 'unknown'
      queuePosition?: number
      outputs?: string[]
    }> => ipcRenderer.invoke('comfy:getStatus', args)
  },
  app: {
    onNavigate: (callback: (payload: { page: string; file?: string }) => void): (() => void) => {
      const handler = (_event: unknown, payload: { page: string; file?: string }): void =>
        callback(payload)
      ipcRenderer.on('app:navigate', handler)
      return () => ipcRenderer.removeListener('app:navigate', handler)
    }
  }
}

export type Api = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
