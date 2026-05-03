import React from 'react'
import styles from './TopNav.module.css'
import type { OllamaStatus, ViewName } from '../types'

export interface TopNavProps {
  activeView: ViewName
  onNavigate: (view: ViewName) => void
  ollamaStatus?: OllamaStatus
}

const NAV_ITEMS: { view: ViewName; icon: string; label: string }[] = [
  { view: 'gallery', icon: '⊞', label: 'Gallery' },
  { view: 'drop', icon: '⬆', label: 'Analyze' },
  { view: 'settings', icon: '⚙', label: 'Settings' }
]

function isActive(active: ViewName, item: ViewName): boolean {
  if (item === 'drop') {
    return (
      active === 'drop' ||
      active === 'analyzing' ||
      active === 'imageResult' ||
      active === 'videoResult' ||
      active === 'workflow'
    )
  }
  return active === item
}

export function TopNav({
  activeView,
  onNavigate,
  ollamaStatus = 'unknown'
}: TopNavProps): React.JSX.Element {
  const statusClass =
    ollamaStatus === 'connected'
      ? styles.statusConnected
      : ollamaStatus === 'error'
        ? styles.statusError
        : styles.statusUnknown

  return (
    <header className={styles.topNav}>
      <div className={styles.left}>
        <span className={[styles.statusDot, statusClass].join(' ')} title={`Ollama: ${ollamaStatus}`} />
      </div>
      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(activeView, item.view)
          return (
            <button
              key={item.view}
              type="button"
              className={[styles.navItem, active ? styles.active : ''].join(' ')}
              onClick={() => onNavigate(item.view)}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
            >
              {item.icon}
            </button>
          )
        })}
      </nav>
    </header>
  )
}

export default TopNav
