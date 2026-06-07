import type { trpc } from '@/trpc/client'

type Utils = ReturnType<typeof trpc.useUtils>

/** Invalidate the marketplace template list after a mutation. */
export function invalidateTemplates(utils: Utils): void {
  utils.template.listMarketplace.invalidate().catch(() => undefined)
}
