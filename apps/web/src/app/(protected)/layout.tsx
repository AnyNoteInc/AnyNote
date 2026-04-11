import type { ReactNode } from "react"

import { requireSession } from "@/lib/get-session"
import { TRPCReactProvider } from "@/trpc/client"

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  await requireSession()
  return <TRPCReactProvider>{children}</TRPCReactProvider>
}
