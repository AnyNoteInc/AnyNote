import { CollectionKind } from '@repo/db'
import { z } from 'zod'

export const updateCollectionInput = z.object({
  collectionId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string().max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().max(32).nullable().optional(),
})
export type UpdateCollectionInput = z.infer<typeof updateCollectionInput>

export const reorderCollectionsInput = z.object({
  workspaceId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()),
})
export type ReorderCollectionsInput = z.infer<typeof reorderCollectionsInput>

export interface CollectionDto {
  id: string
  workspaceId: string
  kind: CollectionKind
  title: string | null
  icon: string | null
  color: string | null
  ownerId: string | null
  homePageId: string | null
  position: number
}
