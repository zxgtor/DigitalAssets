import { ElectronAPI } from '@electron-toolkit/preload'

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
}

export interface Api {
  settings: {
    get: () => Promise<Settings>
    set: (partial: Partial<Settings>) => Promise<Settings>
    reset: () => Promise<Settings>
  }
  analyze: {
    image: (filePath: string) => Promise<ImageAnalysisResult>
    video: (filePath: string) => Promise<VideoAnalysisResult>
  }
  history: {
    list: () => Promise<HistoryEntry[]>
    add: (entry: Omit<HistoryEntry, 'id'>) => Promise<HistoryEntry>
    clear: () => Promise<void>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
