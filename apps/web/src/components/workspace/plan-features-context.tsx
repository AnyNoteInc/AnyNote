'use client'

import { createContext, useContext } from 'react'

import type { PlanFeatures } from '@repo/trpc'

const Ctx = createContext<PlanFeatures | null>(null)

export function PlanFeaturesProvider({
  features,
  children,
}: {
  features: PlanFeatures
  children: React.ReactNode
}) {
  return <Ctx.Provider value={features}>{children}</Ctx.Provider>
}

export function usePlanFeatures(): PlanFeatures {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePlanFeatures must be used inside PlanFeaturesProvider')
  return v
}
