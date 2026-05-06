'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import { SearchDialog } from './search-dialog'

type SearchDialogContextValue = {
  open: () => void
  close: () => void
  isOpen: boolean
}

const SearchDialogContext = createContext<SearchDialogContextValue | null>(null)

export function SearchDialogProvider({
  workspaceId,
  children,
}: {
  workspaceId: string
  children: ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const value = useMemo(() => ({ open, close, isOpen }), [close, isOpen, open])

  return (
    <SearchDialogContext.Provider value={value}>
      {children}
      {isOpen && <SearchDialog workspaceId={workspaceId} onClose={close} />}
    </SearchDialogContext.Provider>
  )
}

export function useSearchDialog(): SearchDialogContextValue {
  const ctx = useContext(SearchDialogContext)
  if (!ctx) {
    throw new Error('useSearchDialog must be used within SearchDialogProvider')
  }
  return ctx
}
