import { useState } from 'react'
import type { StoredProject, HistoryEntry } from '@preload/index'
import styles from './ProjectSidebar.module.css'

interface Props {
  projects: StoredProject[]
  entries: HistoryEntry[]
  selectedId: string | null
  inboxId: string | null
  onSelect: (id: string) => void
  onCreate: (name: string) => Promise<unknown>
  onRename: (id: string, name: string) => Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
}

function ProjectRow({
  p, count, active, isInbox, onSelect, onRename, onDelete
}: {
  p: StoredProject
  count: number
  active: boolean
  isInbox: boolean
  onSelect: () => void
  onRename: (name: string) => Promise<unknown>
  onDelete: () => Promise<unknown>
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(p.name)
  const [menuOpen, setMenuOpen] = useState(false)

  const commitRename = async (): Promise<void> => {
    if (draft.trim() && draft.trim() !== p.name) {
      await onRename(draft.trim())
    } else {
      setDraft(p.name)
    }
    setEditing(false)
  }

  return (
    <div className={[styles.row, active ? styles.active : ''].join(' ')}>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename()
            if (e.key === 'Escape') { setDraft(p.name); setEditing(false) }
          }}
          className={styles.renameInput}
        />
      ) : (
        <button className={styles.rowLabel} onClick={onSelect}>
          <span className={styles.rowName}>{p.name}</span>
          <span className={styles.rowCount}>{count}</span>
        </button>
      )}
      <button
        className={styles.menuBtn}
        title="More"
        onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
      >⋯</button>
      {menuOpen && (
        <div className={styles.menu} onMouseLeave={() => setMenuOpen(false)}>
          <button onClick={() => { setMenuOpen(false); setEditing(true) }}>Rename</button>
          {!isInbox && (
            <button onClick={() => {
              setMenuOpen(false)
              if (window.confirm(`Delete "${p.name}" and all ${count} of its entries? This cannot be undone.`)) {
                void onDelete()
              }
            }}>Delete</button>
          )}
        </div>
      )}
    </div>
  )
}

export function ProjectSidebar(props: Props): React.JSX.Element {
  const { projects, entries, selectedId, inboxId, onSelect, onCreate, onRename, onDelete } = props
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const counts = new Map<string, number>()
  for (const e of entries) counts.set(e.projectId, (counts.get(e.projectId) ?? 0) + 1)

  const commitCreate = async (): Promise<void> => {
    if (newName.trim()) {
      const p = await onCreate(newName.trim())
      onSelect((p as StoredProject).id)
    }
    setNewName('')
    setAdding(false)
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>Projects</div>
      {projects.map((p) => (
        <ProjectRow
          key={p.id}
          p={p}
          count={counts.get(p.id) ?? 0}
          active={p.id === selectedId}
          isInbox={p.id === inboxId}
          onSelect={() => onSelect(p.id)}
          onRename={(name) => onRename(p.id, name)}
          onDelete={() => onDelete(p.id)}
        />
      ))}
      {adding ? (
        <input
          autoFocus
          value={newName}
          placeholder="Project name"
          onChange={(e) => setNewName(e.target.value)}
          onBlur={commitCreate}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitCreate()
            if (e.key === 'Escape') { setNewName(''); setAdding(false) }
          }}
          className={styles.addInput}
        />
      ) : (
        <button className={styles.addBtn} onClick={() => setAdding(true)}>+ New</button>
      )}
    </div>
  )
}

export default ProjectSidebar
