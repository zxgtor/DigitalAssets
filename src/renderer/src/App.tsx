import React, { useCallback, useEffect, useRef, useState } from 'react'
import './styles/globals.css'
import { TopNav } from './components/TopNav'
import { AmbientGlow } from './components/AmbientGlow'
import { DropView } from './views/DropView'
import { AnalyzingView } from './views/AnalyzingView'
import { ImageResultView } from './views/ImageResultView'
import { VideoResultView } from './views/VideoResultView'
import { SettingsView } from './views/SettingsView'
import { GalleryView } from './views/GalleryView'
import { WorkflowView } from './views/WorkflowView'
import type {
  ImageAnalysisResult,
  VideoAnalysisResult,
  MediaKind,
  OllamaStatus,
  SelectedFile,
  ViewName,
  WorkflowJSON,
  WorkflowKind
} from './types'

function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

function Placeholder({ label }: { label: string }): React.JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        zIndex: 1,
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 12,
        letterSpacing: 0.3
      }}
    >
      {label}
    </div>
  )
}

function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<ViewName>('drop')
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null)
  const [imageResult, setImageResult] = useState<ImageAnalysisResult | null>(null)
  const [videoResult, setVideoResult] = useState<VideoAnalysisResult | null>(null)
  const [analyzeStatus, setAnalyzeStatus] = useState<string>('Analyzing...')
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>('unknown')
  const [workflow, setWorkflow] = useState<WorkflowJSON | null>(null)
  const [workflowKind, setWorkflowKind] = useState<WorkflowKind>('image')

  const handleFileSelected = useCallback(
    (filePath: string, kind: MediaKind, file?: File) => {
      // revoke prior thumbnail
      if (selectedFile?.thumbnailUrl) {
        try {
          URL.revokeObjectURL(selectedFile.thumbnailUrl)
        } catch {
          /* noop */
        }
      }
      const thumbnailUrl =
        file && kind === 'image' ? URL.createObjectURL(file) : undefined
      setSelectedFile({
        filePath,
        fileName: basename(filePath),
        kind,
        thumbnailUrl
      })
      setImageResult(null)
      setVideoResult(null)
      setAnalyzeStatus(
        kind === 'video'
          ? 'Extracting keyframes & analyzing each one'
          : 'Extracting visual features'
      )
      setActiveView('analyzing')
    },
    [selectedFile]
  )

  const handleYouTubeUrl = useCallback(
    (url: string) => {
      if (selectedFile?.thumbnailUrl) {
        try {
          URL.revokeObjectURL(selectedFile.thumbnailUrl)
        } catch {
          /* noop */
        }
      }
      setSelectedFile({
        filePath: url,
        fileName: 'YouTube video',
        kind: 'video',
        thumbnailUrl: undefined,
        youtubeUrl: url
      })
      setImageResult(null)
      setVideoResult(null)
      setAnalyzeStatus('Downloading YouTube video & extracting keyframes')
      setActiveView('analyzing')
    },
    [selectedFile]
  )

  const handleNavigate = useCallback((view: ViewName) => {
    setActiveView(view)
  }, [])

  const handleNew = useCallback(() => {
    if (selectedFile?.thumbnailUrl) {
      try {
        URL.revokeObjectURL(selectedFile.thumbnailUrl)
      } catch {
        /* noop */
      }
    }
    setSelectedFile(null)
    setImageResult(null)
    setVideoResult(null)
    setActiveView('drop')
  }, [selectedFile])

  const handleImageWorkflow = useCallback(async () => {
    if (!imageResult) return
    try {
      const wf = await window.api.workflow.buildImage({ prompt: imageResult.prompt })
      setWorkflow(wf)
      setWorkflowKind('image')
      setActiveView('workflow')
    } catch (err) {
      console.error('buildImage failed', err)
      // eslint-disable-next-line no-alert
      alert(`Workflow build failed:\n\n${err instanceof Error ? err.message : String(err)}`)
    }
  }, [imageResult])

  const handleVideoWorkflow = useCallback(async () => {
    if (!videoResult) return
    try {
      const wf = await window.api.workflow.buildVideo({
        masterPrompt: videoResult.masterPrompt,
        keyframes: videoResult.keyframes.map((k) => ({
          timeSec: k.timeSec,
          prompt: k.prompt
        })),
        duration: videoResult.duration
      })
      setWorkflow(wf)
      setWorkflowKind('video')
      setActiveView('workflow')
    } catch (err) {
      console.error('buildVideo failed', err)
      // eslint-disable-next-line no-alert
      alert(`Workflow build failed:\n\n${err instanceof Error ? err.message : String(err)}`)
    }
  }, [videoResult])

  const handleWorkflowBack = useCallback(() => {
    setActiveView(workflowKind === 'image' ? 'imageResult' : 'videoResult')
  }, [workflowKind])

  // Warm the media-server port cache so toMediaUrl() returns a real URL
  // the first time anything tries to render a thumbnail/video.
  useEffect(() => {
    void import('./utils/mediaUrl').then((m) => m.primeMediaPort())
  }, [])

  const ollamaUrlRef = useRef<string>('http://localhost:11434')

  // Sync URL ref whenever settings load/change — polling reads from this ref
  useEffect(() => {
    window.api.settings.get()
      .then((s) => {
        ollamaUrlRef.current = (s.ollamaBaseUrl ?? 'http://localhost:11434').replace(/\/$/, '')
      })
      .catch(() => { /* keep default */ })
  }, [])

  // Poll Ollama health endpoint every 20 seconds — via IPC so we sidestep
  // CORS/origin issues for non-localhost Ollama URLs (LAN, remote).
  useEffect(() => {
    let active = true
    const check = async (): Promise<void> => {
      try {
        const ok = await window.api.ollama.checkHealth(ollamaUrlRef.current)
        if (active) setOllamaStatus(ok ? 'connected' : 'error')
      } catch {
        if (active) setOllamaStatus('error')
      }
    }
    void check()
    const id = setInterval(() => void check(), 20_000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [])

  // Listen for per-frame progress updates from the main process.
  useEffect(() => {
    const unsubscribe = window.api.analyze.onProgress((status: string) => {
      setAnalyzeStatus(status)
    })
    return unsubscribe
  }, [])

  // Listen for agent / deep-link navigation commands.
  useEffect(() => {
    const unsubscribe = window.api.app.onNavigate(({ page, file }) => {
      if (page === 'gallery') {
        handleNavigate('gallery')
      } else if (page === 'settings') {
        handleNavigate('settings')
      } else if (page === 'analyze' || page === 'generate') {
        if (file) {
          // Determine kind from extension
          const ext = file.split('.').pop()?.toLowerCase() ?? ''
          const kind: MediaKind = ['mp4', 'mov', 'mkv', 'webm', 'avi'].includes(ext)
            ? 'video'
            : 'image'
          handleFileSelected(file, kind)
        } else {
          handleNavigate('drop')
        }
      }
    })
    return unsubscribe
  }, [handleNavigate, handleFileSelected])

  // Kick off analysis when entering 'analyzing' view.
  useEffect(() => {
    if (activeView !== 'analyzing' || !selectedFile) return

    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        if (selectedFile.kind === 'image') {
          const result = await window.api.analyze.image(selectedFile.filePath)
          if (cancelled) return
          setImageResult(result)
          setActiveView('imageResult')
          // persist to history (fire-and-forget)
          void window.api.history.add({
            id: result.historyId,
            kind: 'image',
            filePath: selectedFile.filePath,
            fileName: selectedFile.fileName,
            prompt: result.prompt,
            model: result.model,
            durationMs: result.durationMs,
            createdAt: Date.now(),
            thumbnailPath: result.thumbnailPath,
            videoPath: result.imagePath
          })
        } else {
          const isYouTube = !!selectedFile.youtubeUrl
          const result = isYouTube
            ? await window.api.analyze.youtube(selectedFile.youtubeUrl as string)
            : await window.api.analyze.video(selectedFile.filePath)
          if (cancelled) return
          setVideoResult(result)
          const resolvedTitle = result.sourceTitle ?? selectedFile.fileName
          if (isYouTube && result.sourceTitle) {
            setSelectedFile((prev) =>
              prev ? { ...prev, fileName: result.sourceTitle as string } : prev
            )
          }
          setActiveView('videoResult')
          // persist to history (fire-and-forget)
          void window.api.history.add({
            id: result.historyId,
            kind: 'video',
            filePath: isYouTube
              ? (result.sourceUrl ?? (selectedFile.youtubeUrl as string))
              : selectedFile.filePath,
            fileName: isYouTube ? (result.sourceTitle ?? 'YouTube video') : resolvedTitle,
            prompt: result.masterPrompt,
            model: result.model,
            durationSec: result.duration,
            frameCount: result.keyframes.length,
            durationMs: result.durationMs,
            createdAt: Date.now(),
            thumbnailPath: result.thumbnailPath,
            videoPath: result.videoPath
          })
        }
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('Analysis failed', err)
        // eslint-disable-next-line no-alert
        alert(`Analysis failed:\n\n${msg}`)
        setActiveView('drop')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [activeView, selectedFile])

  let content: React.ReactNode
  switch (activeView) {
    case 'drop':
      content = (
        <DropView onFileSelected={handleFileSelected} onYouTubeUrl={handleYouTubeUrl} />
      )
      break
    case 'analyzing':
      content = (
        <AnalyzingView
          fileName={selectedFile?.fileName ?? ''}
          thumbnailUrl={selectedFile?.thumbnailUrl}
          status={analyzeStatus}
        />
      )
      break
    case 'imageResult':
      content =
        imageResult && selectedFile ? (
          <ImageResultView
            result={imageResult}
            fileName={selectedFile.fileName}
            thumbnailUrl={selectedFile.thumbnailUrl}
            onNew={handleNew}
            onWorkflow={handleImageWorkflow}
          />
        ) : (
          <Placeholder label="No result available" />
        )
      break
    case 'videoResult':
      content =
        videoResult && selectedFile ? (
          <VideoResultView
            result={videoResult}
            fileName={selectedFile.fileName}
            onNew={handleNew}
            onWorkflow={handleVideoWorkflow}
          />
        ) : (
          <Placeholder label="No result available" />
        )
      break
    case 'workflow':
      content = workflow ? (
        <WorkflowView
          kind={workflowKind}
          workflow={workflow}
          fileName={selectedFile?.fileName ?? 'workflow'}
          onBack={handleWorkflowBack}
        />
      ) : (
        <Placeholder label="No workflow generated" />
      )
      break
    case 'gallery':
      content = <GalleryView />
      break
    case 'settings':
      content = <SettingsView />
      break
    default:
      content = <Placeholder label="Unknown view" />
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden'
      }}
    >
      <TopNav
        activeView={activeView}
        onNavigate={handleNavigate}
        ollamaStatus={ollamaStatus}
      />
      <main
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          paddingTop: '40px'
        }}
      >
        <AmbientGlow />
        <div key={activeView} className="view-fade">
          {content}
        </div>
      </main>
    </div>
  )
}

export default App
