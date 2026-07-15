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
  PageTemplateScope,
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
  ReminderAudience,
  CollectionKind,
  DatabaseViewType,
  DatabaseFormAudience,
  DatabaseFormRespondentAccess,
  DatabaseFormState,
  DatabasePropertyType,
  DatabaseAccessLevel,
  PageRevisionAction,
  PageNotificationLevel,
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
  FavoriteChat,
  File,
  PageFile,
  OutboxEvent,
  UserConsent,
  PushSubscription,
  NotificationEvent,
  NotificationInApp,
  NotificationDelivery,
  NotificationPreference,
  Reminder,
  ReminderRecipient,
  KanbanColumn,
  KanbanType,
  KanbanPriority,
  KanbanLabel,
  Sprint,
  Task,
  TaskAssignee,
  KanbanLabelOnTask,
  TaskComment,
  TaskActivity,
  TaskAttachment,
  DatabaseSource,
  DatabaseView,
  DatabaseForm,
  DatabaseFormVersion,
  DatabaseFormSubmission,
  DatabaseFormUpload,
  DatabaseProperty,
  DatabaseRow,
  DatabaseCellValue,
  PageRevision,
  PageNotificationPreference,
  DatabaseDateReminder,
} from '@prisma/client'
export {
  OutboxEventStatus,
  KanbanColumnKind,
  SprintStatus,
  TaskActivityType,
  AiProviderKind,
} from '@prisma/client'

export type OutboxAggregateType = 'page' | 'file' | 'webhook_event' | 'telegram_event'

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

export interface EnqueueWebhookEventArgs {
  event: string // e.g. 'page.moved' — @repo/webhooks owns the catalog; db stays untyped
  resourceType: 'page' | 'comment'
  resourceId: string
  workspaceId: string
  actorId?: string | null
  hints?: Prisma.InputJsonValue
}

/** Second outbox row for webhook fan-out (the indexer only reads aggregate_type='page'). */
export async function enqueueWebhookEvent(
  tx: Prisma.TransactionClient,
  args: EnqueueWebhookEventArgs,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      eventType: args.event,
      aggregateType: 'webhook_event',
      aggregateId: args.resourceId,
      workspaceId: args.workspaceId,
      payload: {
        resourceType: args.resourceType,
        actorId: args.actorId ?? null,
        hints: args.hints ?? {},
      },
    },
  })
}

export type EnqueueIntegrationEventsArgs = EnqueueWebhookEventArgs

/**
 * Writes one outbox row per outbound-integration consumer (webhooks + telegram).
 * Consumers each claim only their own aggregateType — SKIP LOCKED consumers must
 * never share rows (they would steal from each other).
 */
export async function enqueueIntegrationEvents(
  tx: Prisma.TransactionClient,
  args: EnqueueIntegrationEventsArgs,
): Promise<void> {
  const payload = {
    resourceType: args.resourceType,
    actorId: args.actorId ?? null,
    hints: args.hints ?? {},
  }
  await tx.outboxEvent.createMany({
    data: (['webhook_event', 'telegram_event'] as const).map((aggregateType) => ({
      eventType: args.event,
      aggregateType,
      aggregateId: args.resourceId,
      workspaceId: args.workspaceId,
      payload,
    })),
  })
}

export default prisma

export {
  AiProviderConnectionSchema,
  parseAiProviderConnection,
  type AiProviderConnection,
} from './ai-provider-connection.ts'
