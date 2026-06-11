import type { ReactNode } from 'react'

import { DevelopersShell } from '@/components/developers/developers-shell'

export default function DevelopersLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return <DevelopersShell>{children}</DevelopersShell>
}
