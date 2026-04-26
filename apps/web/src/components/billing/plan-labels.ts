const PLAN_DISPLAY_NAMES: Record<string, string> = {
  personal: 'Персональный',
  pro: 'ПРО',
  max: 'МАКС',
}

export function getPlanDisplayName(plan: {
  slug: string | null | undefined
  name?: string | null
}): string {
  const displayName = plan.slug ? PLAN_DISPLAY_NAMES[plan.slug] : undefined
  if (displayName) {
    return displayName
  }

  return plan.name ?? 'Персональный'
}
