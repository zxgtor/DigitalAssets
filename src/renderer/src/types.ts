export type ViewName =
  | 'drop'
  | 'analyzing'
  | 'imageResult'
  | 'videoResult'
  | 'workflow'
  | 'settings'
  | 'gallery'
  | 'generate'

export interface HistoryEntry {
  id: string
  projectId: string
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

export type MediaKind = 'image' | 'video'

export type OllamaStatus = 'unknown' | 'connected' | 'error'

export interface ImageAnalysisResult {
  prompt: string
  model: string
  durationMs: number
  imagePath?: string
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
}

export type AnalysisResult = ImageAnalysisResult | VideoAnalysisResult

export type WorkflowJSON = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>

export type WorkflowKind = 'image' | 'video'

export interface SelectedFile {
  filePath: string
  fileName: string
  kind: MediaKind
  thumbnailUrl?: string
  youtubeUrl?: string
}

export type {
  Workstation,
  WorkstationStatus,
  Job,
  JobStatus,
  SchedulerMode,
  DiscoveryCandidate
} from '@preload/index'

export type { StoredProject } from '@preload/index'
