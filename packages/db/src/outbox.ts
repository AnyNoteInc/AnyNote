import type { Prisma } from "@prisma/client"

export type OutboxAggregateType = "page" | "file"

export interface EnqueueOutboxEventArgs {
  eventType: string
  aggregateType: OutboxAggregateType
  aggregateId: string
  workspaceId?: string | null
  payload?: Prisma.InputJsonValue
}

export async function enqueueOutboxEvent(
  tx: Prisma.TransactionClient,
  args: EnqueueOutboxEventArgs,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      eventType: args.eventType,
      aggregateType: args.aggregateType,
      aggregateId: args.aggregateId,
      workspaceId: args.workspaceId ?? null,
      payload: args.payload ?? {},
    },
  })
}
