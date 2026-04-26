import type { ReactNode } from 'react'

import '@repo/editor/styles'
import { EditorThemeBridge } from '@repo/editor'

import { requireSession } from '@/lib/get-session'
import { TRPCReactProvider } from '@/trpc/client'

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  await requireSession()
  return (
    <TRPCReactProvider>
      <EditorThemeBridge />
      {children}
    </TRPCReactProvider>
  )
}
