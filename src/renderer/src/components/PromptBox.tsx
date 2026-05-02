import React from 'react'
import styles from './PromptBox.module.css'

export interface PromptBoxProps {
  text: string
  monospace?: boolean
  className?: string
}

export function PromptBox({ text, monospace, className }: PromptBoxProps): React.JSX.Element {
  const cls = [styles.box, monospace ? styles.mono : null, className].filter(Boolean).join(' ')
  return <div className={cls}>{text}</div>
}

export default PromptBox
