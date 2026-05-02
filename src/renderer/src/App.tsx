import React, { useCallback, useEffect, useState } from 'react'
import './styles/globals.css'
import { Sidebar } from './components/Sidebar'
import { AmbientGlow } from './components/AmbientGlow'
import { DropView } from './views/DropView'
import { AnalyzingView } from './views/AnalyzingView'
import { ImageResultView } from './views/ImageResultView'
import { VideoResultView } from './views/VideoResultView'
import { SettingsView } from './views/SettingsView'
import { HistoryView } from './views/HistoryView'
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

  // Poll Ollama health endpoint every 20 seconds.
  useEffect(() => {
    const check = async (): Promise<void> => {
      try {
        const settings = await window.api.settings.get()
        const base = (settings.ollamaBaseUrl ?? 'http://localhost:11434').replace(/\/$/, '')
        const res = await fetch(`${base}/api/tags`, { method: 'GET' })
        setOllamaStatus(res.ok ? 'connected' : 'error')
      } catch {
        setOllamaStatus('error')
      }
    }
    void check()
    const id = setInterval(() => void check(), 20_000)
    return () => clearInterval(id)
  }, [])

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
            kind: 'image',
            filePath: selectedFile.filePath,
            fileName: selectedFile.fileName,
            prompt: result.prompt,
            model: result.model,
            durationMs: result.durationMs,
            createdAt: Date.now()
          })
        } else {
          const result = await window.api.analyze.video(selectedFile.filePath)
          if (cancelled) return
          setVideoResult(result)
          setActiveView('videoResult')
          // persist to history (fire-and-forget)
          void window.api.history.add({
            kind: 'video',
            filePath: selectedFile.filePath,
            fileName: selectedFile.fileName,
            prompt: result.masterPrompt,
            model: result.model,
            durationSec: result.duration,
            frameCount: result.keyframes.length,
            durationMs: result.durationMs,
            createdAt: Date.now()
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
      content = <DropView onFileSelected={handleFileSelected} />
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
    case 'history':
      content = <HistoryView />
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
        flexDirection: 'row',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden'
      }}
    >
      <Sidebar
        activeView={activeView}
        onNavigate={handleNavigate}
        ollamaStatus={ollamaStatus}
      />
      <main
        style={{
          flex: 1,
          position: 'relative',
          height: '100%',
          overflow: 'hidden'
        }}
      >
        <AmbientGlow />
        <div key={activeView} className="view-fade" style={{ height: '100%' }}>
          {content}
        </div>
      </main>
    </div>
  )
}

export default App
