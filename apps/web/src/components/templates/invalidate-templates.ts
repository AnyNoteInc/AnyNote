import type { trpc } from '@/trpc/client'

type Utils = ReturnType<typeof trpc.useUtils>

/** Invalidate the template list + search queries after a mutation. */
export function invalidateTemplates(utils: Utils, workspaceId: string): void {
  utils.template.listByWorkspace.invalidate({ workspaceId }).catch(() => undefined)
  utils.template.search.invalidate().catch(() => undefined)
}
