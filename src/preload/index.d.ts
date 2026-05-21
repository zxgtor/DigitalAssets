import { ElectronAPI } from '@electron-toolkit/preload'

export type SchedulerModeValue = 'lan-pool' | 'per-model' | 'manual'

export interface Settings {
  ollamaBaseUrl: string
  ollamaModel: string
  maxKeyframes: number
  outputFolder: string
  comfyUrl: string
  /** v2 fields — present once migrated */
  schedulerMode: SchedulerModeValue
  ui: { workstationsPanelOpen: boolean; queuePanelOpen: boolean }
  /** v3 fields */
  lastProjectId: string | null
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

export interface WorkstationPersisted {
  id: string
  name: string
  url: string
  enabled: boolean
}

export type WorkstationStatus = 'online' | 'busy' | 'offline' | 'unknown'

export interface Workstation extends WorkstationPersisted {
  status: WorkstationStatus
  models: { checkpoints: string[]; loras: string[]; vae: string[] }
  queueDepth: number
  gpu?: { name: string; vramTotal: number; vramFree: number }
  lastSeenAt?: number
}

export type JobStatus = 'queued' | 'submitting' | 'pending' | 'running' | 'done' | 'error'

export interface Job {
  id: string
  workstationId: string | null
  promptId: string | null
  hints: { preferWorkstation?: string }
  status: JobStatus
  queuePosition?: number
  outputs?: string[]
  error?: string
  promptPreview?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

export type SchedulerMode = 'lan-pool' | 'per-model' | 'manual'

export interface DiscoveryCandidate {
  url: string
  gpu: string
  vramTotal: number
}

export interface StoredProject {
  id: string
  name: string
  createdAt: number
}

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
    add: (entry: Omit<HistoryEntry, 'id' | 'projectId'> & { id?: string; projectId?: string }) => Promise<HistoryEntry>
    remove: (id: string) => Promise<void>
    clear: () => Promise<void>
    onUpdate: (cb: (list: HistoryEntry[]) => void) => () => void
  }
  projects: {
    list: () => Promise<StoredProject[]>
    create: (name: string) => Promise<StoredProject>
    rename: (id: string, name: string) => Promise<StoredProject>
    delete: (id: string) => Promise<void>
    onUpdate: (cb: (list: StoredProject[]) => void) => () => void
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
    queue: (args: { workflow: WorkflowJSON; comfyUrl: string }) => Promise<{ promptId: string }>
    getStatus: (args: { promptId: string; comfyUrl: string }) => Promise<{
      status: 'pending' | 'running' | 'done' | 'error' | 'unknown'
      queuePosition?: number
      outputs?: string[]
    }>
  }
  workstations: {
    list: () => Promise<Workstation[]>
    add: (input: { name: string; url: string }) => Promise<Workstation>
    remove: (id: string) => Promise<void>
    edit: (id: string, patch: Partial<{ name: string; url: string; enabled: boolean }>) => Promise<void>
    refreshModels: (id: string) => Promise<void>
    setMode: (mode: SchedulerMode) => Promise<void>
    submit: (args: { workflow: WorkflowJSON; preferWorkstation?: string }) => Promise<string>
    getJobs: () => Promise<Job[]>
    clearDoneJobs: () => Promise<void>
    removeJob: (id: string) => Promise<void>
    cancel: (id: string) => Promise<void>
    discover: () => Promise<DiscoveryCandidate[]>
    testConnection: (url: string) => Promise<{ ok: boolean; gpu?: string; error?: string }>
    onUpdate: (cb: (list: Workstation[]) => void) => () => void
    onJobsUpdate: (cb: (list: Job[]) => void) => () => void
    onDiscoverCandidate: (cb: (c: DiscoveryCandidate) => void) => () => void
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
