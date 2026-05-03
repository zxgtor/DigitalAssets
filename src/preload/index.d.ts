import { ElectronAPI } from '@electron-toolkit/preload'

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

export interface ComfyOpenArgs {
  workflow: WorkflowJSON
  fileName: string
}

export interface ComfyOpenResult {
  savedPath: string
  comfyUrl: string
}

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

export interface Api {
  settings: {
    get: () => Promise<Settings>
    set: (partial: Partial<Settings>) => Promise<Settings>
    reset: () => Promise<Settings>
  }
  ollama: {
    checkHealth: (baseUrl: string) => Promise<boolean>
    listModels: (baseUrl: string) => Promise<string[]>
  }
  media: {
    getPort: () => Promise<number>
  }
  dialog: {
    openMedia: () => Promise<string | null>
  }
  getFilePath: (file: File) => string
  analyze: {
    image: (filePath: string) => Promise<ImageAnalysisResult>
    video: (filePath: string) => Promise<VideoAnalysisResult>
    youtube: (url: string) => Promise<VideoAnalysisResult>
    onProgress: (callback: (status: string) => void) => () => void
  }
  history: {
    list: () => Promise<HistoryEntry[]>
    add: (entry: Omit<HistoryEntry, 'id'> & { id?: string }) => Promise<HistoryEntry>
    remove: (id: string) => Promise<void>
    clear: () => Promise<void>
  }
  workflow: {
    buildImage: (args: { prompt: string; negativePrompt?: string }) => Promise<WorkflowJSON>
    buildVideo: (args: {
      masterPrompt: string
      keyframes: Array<{ timeSec: number; prompt: string }>
      duration: number
    }) => Promise<WorkflowJSON>
    save: (args: {
      workflow: WorkflowJSON
      defaultFileName: string
    }) => Promise<WorkflowSaveResult>
  }
  comfy: {
    open: (args: ComfyOpenArgs) => Promise<ComfyOpenResult>
  }
  app: {
    onNavigate: (callback: (payload: { page: string; file?: string }) => void) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
