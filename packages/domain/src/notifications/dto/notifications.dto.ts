import { z } from 'zod'

export const markReadInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
})
export type MarkReadInput = z.infer<typeof markReadInput>

export interface MarkReadResultDto {
  updated: number
}

export interface DeleteResultDto {
  deleted: number
}
