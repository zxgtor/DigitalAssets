export type ViewName =
  | 'drop'
  | 'analyzing'
  | 'imageResult'
  | 'videoResult'
  | 'workflow'
  | 'settings'
  | 'history'

export type MediaKind = 'image' | 'video'

export type OllamaStatus = 'unknown' | 'connected' | 'error'

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

export type AnalysisResult = ImageAnalysisResult | VideoAnalysisResult

export interface SelectedFile {
  filePath: string
  fileName: string
  kind: MediaKind
  thumbnailUrl?: string
}
