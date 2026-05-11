import type { CSSProperties } from 'react'

export const REMINDER_WRAPPER_STYLE = {
  display: 'inline-flex',
  boxSizing: 'border-box',
  verticalAlign: 'baseline',
} satisfies CSSProperties

export const REMINDER_CHIP_SX = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.5,
  px: 0.75,
  mx: 0.25,
  py: '1px',
  borderRadius: 1,
}
