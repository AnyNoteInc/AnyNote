import { z } from 'zod'

export const addFavoriteInput = z.object({
  pageId: z.string().uuid(),
})
export type AddFavoriteInput = z.infer<typeof addFavoriteInput>

export const removeFavoriteInput = z.object({
  pageId: z.string().uuid(),
})
export type RemoveFavoriteInput = z.infer<typeof removeFavoriteInput>

export const reorderFavoritesInput = z.object({
  workspaceId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()),
})
export type ReorderFavoritesInput = z.infer<typeof reorderFavoritesInput>

export interface FavoritePageDto {
  userId: string
  pageId: string
  position: number
}
