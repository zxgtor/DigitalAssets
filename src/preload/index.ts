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
      ipcRenderer.invoke('analyze:youtube', { url })
  },
  history: {
    list: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:list'),
    add: (entry: Omit<HistoryEntry, 'id'> & { id?: string }): Promise<HistoryEntry> =>
      ipcRenderer.invoke('history:add', entry),
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
      ipcRenderer.invoke('comfy:open', args)
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
