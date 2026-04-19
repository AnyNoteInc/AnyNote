import { PrismaClient, Prisma } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

type GlobalPrisma = typeof globalThis & {
  prisma?: PrismaClient
}

const globalForPrisma = globalThis as GlobalPrisma

export const prisma =
  globalForPrisma.prisma ??
  (() => {
    const databaseUrl = process.env.DATABASE_URL

    if (!databaseUrl) {
      throw new Error("DATABASE_URL environment variable is not set.")
    }

    const adapter = new PrismaPg({
      connectionString: databaseUrl,
    })

    return new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === "production" ? ["error", "warn"] : ["query", "error", "warn"],
    })
  })()

if (process.env.NODE_ENV !== "production") {
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
} from "@prisma/client"
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
  ChatMessageFile,
  AiProvider,
  AiModel,
  FavoritePage,
  File,
  PageFile,
} from "@prisma/client"
export default prisma
