import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

type GlobalPrisma = typeof globalThis & {
  prisma?: PrismaClient
}

const globalForPrisma = globalThis as GlobalPrisma

export const prisma =
  globalForPrisma.prisma ??
  (() => {
    const databaseUrl = process.env.DATABASE_URL

    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set.')
    }

    const adapter = new PrismaPg({
      connectionString: databaseUrl,
    })

    return new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query', 'error', 'warn'],
    })
  })()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

// Explicit re-exports — avoid `export *` from @prisma/client, which is CJS and
// trips Turbopack's "unexpected export *" warning on the server bundle.
export { PrismaClient, Prisma }
export {
  RoleType,
  PageType,
  PageOwnership,
  IntegrationScope,
  IntegrationStatus,
  SubscriptionStatus,
  ChatMessageRole,
  FileStatus,
  ConsentDocumentType,
  ConsentSource,
  NotificationCategory,
  NotificationChannel,
  NotificationEventType,
  DeliveryStatus,
} from '@prisma/client'
export type { ChatMessageStatus } from '@prisma/client'
export type {
  User,
  Account,
  Session,
  Verification,
  Jwks,
  Workspace,
  WorkspaceMember,
  Page,
  UserPreference,
  IntegrationProvider,
  Integration,
  Plan,
  Subscription,
  Chat,
  ChatMessage,
  AiProvider,
  AiModel,
  WorkspaceAiSettings,
  FavoritePage,
  File,
  PageFile,
  OutboxEvent,
  UserConsent,
  PushSubscription,
} from '@prisma/client'
export { OutboxEventStatus } from '@prisma/client'

export type OutboxAggregateType = 'page' | 'file'

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

export async function enqueueOutboxEventIgnoreConflict(
  tx: Prisma.TransactionClient,
  args: EnqueueOutboxEventArgs & { delayMs?: number },
): Promise<void> {
  const delaySql = args.delayMs
    ? Prisma.sql`now() + ${args.delayMs} * interval '1 millisecond'`
    : Prisma.sql`now()`
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO outbox_events
      (event_type, aggregate_type, aggregate_id, workspace_id, payload, status, next_attempt_at)
    VALUES
      (${args.eventType}, ${args.aggregateType}, ${args.aggregateId}::uuid,
       ${args.workspaceId ?? null}::uuid, ${JSON.stringify(args.payload ?? {})}::jsonb, 'PENDING', ${delaySql})
    ON CONFLICT DO NOTHING
  `)
}

export default prisma

export {
  AiProviderConnectionSchema,
  parseAiProviderConnection,
  type AiProviderConnection,
} from './ai-provider-connection.ts'
