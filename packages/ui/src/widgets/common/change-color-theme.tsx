'use client'

import { useMemo } from 'react'
import DarkModeRounded from '@mui/icons-material/DarkModeRounded'
import LightModeRounded from '@mui/icons-material/LightModeRounded'
import { IconButton, Tooltip } from '@repo/ui/components'

import { useThemeMode } from '../../providers'

export function ChangeColorTheme() {
  const { mode, toggleMode } = useThemeMode()

  const icon = useMemo(
    () =>
      mode === 'light' ? (
        <DarkModeRounded fontSize="small" />
      ) : (
        <LightModeRounded fontSize="small" />
      ),
    [mode],
  )

  return (
    <Tooltip title={mode === 'light' ? 'Темная тема' : 'Светлая тема'}>
      <IconButton color="inherit" aria-label="toggle color mode" onClick={toggleMode} size="large">
        {icon}
      </IconButton>
    </Tooltip>
  )
}
