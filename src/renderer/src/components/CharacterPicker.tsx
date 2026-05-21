import type { StoredCharacter } from '@preload/index'
import styles from './CharacterPicker.module.css'

interface Props {
  characters: StoredCharacter[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onManage: () => void
}

export function CharacterPicker(props: Props): React.JSX.Element {
  const { characters, selectedId, onSelect, onManage } = props
  return (
    <div className={styles.row}>
      <span className={styles.label}>Character:</span>
      <select
        className={styles.select}
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">None</option>
        {characters.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <button className={styles.manageBtn} onClick={onManage} title="Manage characters">
        Manage…
      </button>
    </div>
  )
}

export default CharacterPicker
