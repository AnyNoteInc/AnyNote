import type { ReminderColor } from './state.ts'

export type ReminderPalette = {
  bg: string
  fg: string
  border: string
}

export const REMINDER_COLORS: Record<ReminderColor, ReminderPalette> = {
  gray: { bg: 'rgba(120, 120, 130, 0.10)', fg: '#5f5f6a', border: 'rgba(120, 120, 130, 0.25)' },
  yellow: { bg: 'rgba(255, 167, 38, 0.12)', fg: '#b75d00', border: 'rgba(255, 167, 38, 0.40)' },
  red: { bg: 'rgba(244,  67, 54, 0.12)', fg: '#b3261e', border: 'rgba(244,  67, 54, 0.40)' },
  green: { bg: 'rgba( 76, 175, 80, 0.12)', fg: '#1e7e2c', border: 'rgba( 76, 175, 80, 0.40)' },
}
