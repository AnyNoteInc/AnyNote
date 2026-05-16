export interface SprintLike {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly description?: string | null
  readonly startDate?: Date | string | null
  readonly endDate?: Date | string | null
}
