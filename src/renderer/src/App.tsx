import './styles/globals.css'

function App(): React.JSX.Element {
  return (
    <>
      <div className="ambient-glow" />
      <div
        style={{
          position: 'relative',
          height: '100vh',
          width: '100vw',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          fontWeight: 500,
          letterSpacing: '-0.01em',
          zIndex: 1
        }}
      >
        VideoToPrompt &mdash; building&hellip;
      </div>
    </>
  )
}

export default App
