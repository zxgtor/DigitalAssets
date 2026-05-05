import React from 'react'
import styles from './TopNav.module.css'
import type { OllamaStatus, ViewName } from '../types'

export interface TopNavProps {
  activeView: ViewName
  onNavigate: (view: ViewName) => void
  ollamaStatus?: OllamaStatus
}

function IconGallery(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="14" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M1 9l3.5-3.5L7 8l2.5-2.5L15 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="5" cy="5" r="1" fill="currentColor"/>
      <path d="M3 14h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

function IconSpark(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5C8 1.5 8.6 5.4 10.3 7.1C12 8.8 15.5 8 15.5 8C15.5 8 12 8.6 10.3 10.3C8.6 12 8 15.5 8 15.5C8 15.5 7.4 12 5.7 10.3C4 8.6 0.5 8 0.5 8C0.5 8 4 7.4 5.7 5.7C7.4 4 8 1.5 8 1.5Z"/>
      <path d="M13 1C13 1 13.3 2.7 14.1 3.5C14.9 4.3 16 4 16 4C16 4 14.9 4.3 14.1 5.1C13.3 5.9 13 7 13 7C13 7 12.7 5.9 11.9 5.1C11.1 4.3 10 4 10 4C10 4 11.1 3.7 11.9 2.9C12.7 2.1 13 1 13 1Z" opacity="0.7"/>
    </svg>
  )
}

function IconGenerate(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="2.5" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="13.5" cy="3.5" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="13.5" cy="12.5" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M4.3 7.3L11.7 4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M4.3 8.7L11.7 11.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function IconSettings(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.858 2.929 2.929 0 0 1 0 5.858z"/>
    </svg>
  )
}

const NAV_ITEMS: { view: ViewName; Icon: () => React.JSX.Element; label: string }[] = [
  { view: 'gallery', Icon: IconGallery, label: 'Gallery' },
  { view: 'drop', Icon: IconSpark, label: 'Analyze' },
  { view: 'generate', Icon: IconGenerate, label: 'Generate' },
  { view: 'settings', Icon: IconSettings, label: 'Settings' }
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
              <item.Icon />
            </button>
          )
        })}
      </nav>
    </header>
  )
}

export default TopNav
