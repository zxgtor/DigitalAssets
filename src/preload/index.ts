import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface Settings {
  ollamaBaseUrl: string
  ollamaModel: string
  maxKeyframes: number
  outputFolder: string
}

export interface ImageAnalysisResult {
  prompt: string
  model: string
  durationMs: number
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
  sourceTitle?: string
  sourceUrl?: string
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
    add: (entry: Omit<HistoryEntry, 'id'>): Promise<HistoryEntry> =>
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
