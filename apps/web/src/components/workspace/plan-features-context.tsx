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

/**
 * Non-throwing variant for components rendered BOTH inside the protected app
 * (where the provider is mounted) AND outside it (e.g. the public-share renderer,
 * which has no plan context). Returns null when no provider is present.
 */
export function usePlanFeaturesOptional(): PlanFeatures | null {
  return useContext(Ctx)
}
