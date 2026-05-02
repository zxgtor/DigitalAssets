import React from 'react'
import styles from './PillButton.module.css'

export interface PillButtonProps {
  variant?: 'primary' | 'ghost'
  size?: 'sm' | 'md'
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  children: React.ReactNode
  type?: 'button' | 'submit' | 'reset'
  className?: string
}

export function PillButton({
  variant = 'primary',
  size = 'md',
  onClick,
  disabled,
  children,
  type = 'button',
  className
}: PillButtonProps): React.JSX.Element {
  const cls = [
    styles.button,
    size === 'sm' ? styles.sm : styles.md,
    variant === 'ghost' ? styles.ghost : styles.primary,
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

export default PillButton
