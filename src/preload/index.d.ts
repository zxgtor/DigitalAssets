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

export interface Api {
  settings: {
    get: () => Promise<Settings>
    set: (partial: Partial<Settings>) => Promise<Settings>
    reset: () => Promise<Settings>
  }
  analyze: {
    image: (filePath: string) => Promise<ImageAnalysisResult>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
