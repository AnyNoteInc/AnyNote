'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import type { SettingsSectionSlug } from './workspace-settings-dialog'
import { WorkspaceSettingsDialog } from './workspace-settings-dialog'

type SettingsDialogContextValue = {
  open: (section?: SettingsSectionSlug) => void
  close: () => void
  isOpen: boolean
}

const SettingsDialogContext = createContext<SettingsDialogContextValue | null>(null)

export function SettingsDialogProvider({
  workspaceId,
  currentUserId,
  children,
}: {
  workspaceId: string
  currentUserId: string
  children: ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [section, setSection] = useState<SettingsSectionSlug>('general')
  const open = useCallback((next: SettingsSectionSlug = 'general') => {
    setSection(next)
    setIsOpen(true)
  }, [])
  const close = useCallback(() => setIsOpen(false), [])
  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen])

  return (
    <SettingsDialogContext.Provider value={value}>
      {children}
      <WorkspaceSettingsDialog
        open={isOpen}
        onClose={close}
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        initialSection={section}
      />
    </SettingsDialogContext.Provider>
  )
}

export function useSettingsDialog(): SettingsDialogContextValue {
  const ctx = useContext(SettingsDialogContext)
  if (!ctx) {
    throw new Error('useSettingsDialog must be used within SettingsDialogProvider')
  }
  return ctx
}
