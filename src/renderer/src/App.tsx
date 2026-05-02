import React, { useCallback, useState } from 'react'
import './styles/globals.css'
import { Sidebar } from './components/Sidebar'
import { AmbientGlow } from './components/AmbientGlow'
import { DropView } from './views/DropView'
import { AnalyzingView } from './views/AnalyzingView'
import type { MediaKind, OllamaStatus, SelectedFile, ViewName } from './types'

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
  const [ollamaStatus] = useState<OllamaStatus>('unknown')

  const handleFileSelected = useCallback((filePath: string, kind: MediaKind) => {
    setSelectedFile({
      filePath,
      fileName: basename(filePath),
      kind
    })
    setActiveView('analyzing')
  }, [])

  const handleNavigate = useCallback((view: ViewName) => {
    setActiveView(view)
  }, [])

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
        />
      )
      break
    case 'imageResult':
      content = <Placeholder label="Image result (coming soon)" />
      break
    case 'videoResult':
      content = <Placeholder label="Video result (coming soon)" />
      break
    case 'workflow':
      content = <Placeholder label="Workflow (coming soon)" />
      break
    case 'history':
      content = <Placeholder label="History (coming soon)" />
      break
    case 'settings':
      content = <Placeholder label="Settings (coming soon)" />
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
        {content}
      </main>
    </div>
  )
}

export default App
