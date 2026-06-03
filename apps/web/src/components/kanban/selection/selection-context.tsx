'use client'

import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react'

export type SelectionAction =
  | { type: 'toggle'; id: string }
  | { type: 'set'; ids: string[] }
  | { type: 'clear' }

export function selectionReducer(state: Set<string>, action: SelectionAction): Set<string> {
  switch (action.type) {
    case 'toggle': {
      const next = new Set(state)
      if (next.has(action.id)) next.delete(action.id)
      else next.add(action.id)
      return next
    }
    case 'set':
      return new Set(action.ids)
    case 'clear':
      return state.size === 0 ? state : new Set()
  }
}

interface SelectionContextValue {
  readonly selected: Set<string>
  readonly toggle: (id: string) => void
  readonly setSelection: (ids: string[]) => void
  readonly clear: () => void
}

const SelectionContext = createContext<SelectionContextValue | null>(null)

export function SelectionProvider({ children }: { readonly children: ReactNode }) {
  const [selected, dispatch] = useReducer(selectionReducer, undefined, () => new Set<string>())
  const value = useMemo<SelectionContextValue>(
    () => ({
      selected,
      toggle: (id) => dispatch({ type: 'toggle', id }),
      setSelection: (ids) => dispatch({ type: 'set', ids }),
      clear: () => dispatch({ type: 'clear' }),
    }),
    [selected],
  )
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('useSelection must be used within SelectionProvider')
  return ctx
}
