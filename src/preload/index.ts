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
  workstations: {
    list: (): Promise<Workstation[]> => ipcRenderer.invoke('workstations:list'),
    add: (input: { name: string; url: string }): Promise<Workstation> =>
      ipcRenderer.invoke('workstations:add', input),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('workstations:remove', id),
    edit: (id: string, patch: Partial<{ name: string; url: string; enabled: boolean }>): Promise<void> =>
      ipcRenderer.invoke('workstations:edit', { id, patch }),
    refreshModels: (id: string): Promise<void> => ipcRenderer.invoke('workstations:refreshModels', id),
    setMode: (mode: SchedulerMode): Promise<void> => ipcRenderer.invoke('workstations:setMode', mode),
    submit: (args: { workflow: WorkflowJSON; preferWorkstation?: string }): Promise<string> =>
      ipcRenderer.invoke('workstations:submit', args),
    getJobs: (): Promise<Job[]> => ipcRenderer.invoke('workstations:getJobs'),
    clearDoneJobs: (): Promise<void> => ipcRenderer.invoke('workstations:clearDoneJobs'),
    removeJob: (id: string): Promise<void> => ipcRenderer.invoke('workstations:removeJob', id),
    cancel: (id: string): Promise<void> => ipcRenderer.invoke('workstations:cancel', id),
    discover: (): Promise<DiscoveryCandidate[]> => ipcRenderer.invoke('workstations:discover'),
    testConnection: (url: string): Promise<{ ok: boolean; gpu?: string; error?: string }> =>
      ipcRenderer.invoke('workstations:testConnection', url),
    onUpdate: (cb: (list: Workstation[]) => void): (() => void) => {
      const handler = (_e: unknown, list: Workstation[]): void => cb(list)
      ipcRenderer.on('workstations:update', handler)
      return () => ipcRenderer.removeListener('workstations:update', handler)
    },
    onJobsUpdate: (cb: (list: Job[]) => void): (() => void) => {
      const handler = (_e: unknown, list: Job[]): void => cb(list)
      ipcRenderer.on('jobs:update', handler)
      return () => ipcRenderer.removeListener('jobs:update', handler)
    },
    onDiscoverCandidate: (cb: (c: DiscoveryCandidate) => void): (() => void) => {
      const handler = (_e: unknown, c: DiscoveryCandidate): void => cb(c)
      ipcRenderer.on('workstations:discover:candidate', handler)
      return () => ipcRenderer.removeListener('workstations:discover:candidate', handler)
    }
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
