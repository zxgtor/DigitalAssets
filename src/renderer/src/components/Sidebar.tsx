import React from 'react'
import styles from './Sidebar.module.css'
import type { OllamaStatus, ViewName } from '../types'

export interface SidebarProps {
  activeView: ViewName
  onNavigate: (view: ViewName) => void
  ollamaStatus?: OllamaStatus
}

interface NavSpec {
  view: ViewName
  label: string
  icon: string
}

const NAV_ITEMS: NavSpec[] = [
  { view: 'gallery', label: 'Gallery', icon: '⊞' },
  { view: 'drop', label: 'Analyze', icon: '↑' },
  { view: 'settings', label: 'Settings', icon: '⚙' }
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

export function Sidebar({
  activeView,
  onNavigate,
  ollamaStatus = 'unknown'
}: SidebarProps): React.JSX.Element {
  const statusClass =
    ollamaStatus === 'connected'
      ? styles.statusConnected
      : ollamaStatus === 'error'
        ? styles.statusError
        : ''

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>V</div>
      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(activeView, item.view)
          const cls = [styles.navItem, active ? styles.active : null].filter(Boolean).join(' ')
          return (
            <button
              key={item.view}
              type="button"
              className={cls}
              onClick={() => onNavigate(item.view)}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
            >
              <span className={styles.icon}>{item.icon}</span>
              <span className={styles.label}>{item.label}</span>
            </button>
          )
        })}
      </nav>
      <div className={styles.statusWrap} title={`Ollama: ${ollamaStatus}`}>
        <span className={[styles.statusDot, statusClass].filter(Boolean).join(' ')} />
      </div>
    </aside>
  )
}

export default Sidebar
