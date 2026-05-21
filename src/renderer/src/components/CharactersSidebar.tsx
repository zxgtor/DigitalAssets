import { useState } from 'react'
import type { StoredCharacter } from '@preload/index'
import styles from './CharactersSidebar.module.css'

interface Props {
  characters: StoredCharacter[]
  onOpenDetail: (char: StoredCharacter | null) => void
  onCreate: (name: string) => Promise<StoredCharacter>
  onDelete: (id: string) => Promise<void>
}

export function CharactersSidebar(props: Props): React.JSX.Element {
  const { characters, onOpenDetail, onCreate, onDelete } = props
  const [collapsed, setCollapsed] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const commitCreate = async (): Promise<void> => {
    if (creating || !newName.trim()) {
      setNewName('')
      setAdding(false)
      return
    }
    setCreating(true)
    try {
      const c = await onCreate(newName.trim())
      setNewName('')
      setAdding(false)
      onOpenDetail(c) // open detail for the new character
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className={styles.sidebar}>
      <button className={styles.header} onClick={() => setCollapsed((v) => !v)}>
        Characters <span>{collapsed ? '▶' : '▼'}</span>
      </button>
      {!collapsed && (
        <>
          {characters.length === 0 && !adding && (
            <div className={styles.empty}>No characters yet.</div>
          )}
          {characters.map((c) => (
            <div key={c.id} className={styles.row}>
              <button className={styles.rowLabel} onClick={() => onOpenDetail(c)}>
                {c.referenceImages[0] ? (
                  <img
                    src={`file:///${c.referenceImages[0].replace(/\\/g, '/')}`}
                    className={styles.thumb}
                    alt=""
                  />
                ) : (
                  <div className={styles.thumbPlaceholder}>{c.name[0]?.toUpperCase() ?? '?'}</div>
                )}
                <span className={styles.name}>{c.name}</span>
                <span className={styles.count}>{c.referenceImages.length}</span>
              </button>
              <button
                className={styles.deleteBtn}
                title="Delete"
                onClick={() => {
                  if (window.confirm(`Delete "${c.name}" and all ${c.referenceImages.length} ref images?`)) {
                    void onDelete(c.id)
                  }
                }}
              >✕</button>
            </div>
          ))}
          {adding ? (
            <input
              autoFocus
              value={newName}
              placeholder="Character name"
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
        </>
      )}
    </div>
  )
}

export default CharactersSidebar
