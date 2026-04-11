import { PrismaClient } from "@prisma/client"
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

export * from "@prisma/client"
export default prisma
