'use client'

import { createContext, useContext } from 'react'
import * as Y from 'yjs'

export const DocContext = createContext<Y.Doc | null>(null)

export function useDoc(): Y.Doc {
  const d = useContext(DocContext)
  if (!d) throw new Error('useDoc must be used inside DocContext.Provider')
  return d
}
