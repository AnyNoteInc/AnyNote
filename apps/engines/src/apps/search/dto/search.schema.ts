import { z } from "zod"

export const searchPagesRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().trim().min(1).max(4000),
  topK: z.number().int().min(1).max(20).optional(),
  scoreThreshold: z.number().min(0).max(1).optional(),
})

export type SearchPagesRequest = z.infer<typeof searchPagesRequestSchema>

export type SearchPagesResponse = {
  documents: Array<{
    id: string
    title: string
    content: string
    score: number
    updatedAt: string
    pageType: string
  }>
}
