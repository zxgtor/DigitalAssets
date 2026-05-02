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

export interface VideoAnalysisResult {
  kind: 'video'
  filePath: string
  fileName: string
  prompt: string
  description?: string
  tags?: string[]
  durationSec?: number
  frameCount?: number
  createdAt: number
}

export type AnalysisResult = ImageAnalysisResult | VideoAnalysisResult

export interface SelectedFile {
  filePath: string
  fileName: string
  kind: MediaKind
  thumbnailUrl?: string
}
