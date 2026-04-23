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
} from '@prisma/client'
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

export default prisma
