import { Server } from "@hocuspocus/server"

import { loadEnv } from "./env.js"
import { initJwks, verifyJwt, canAccessPage } from "./auth.js"
import { loadPageDocument, storePageDocument } from "./persistence.js"
import { log } from "./logger.js"
import type { PageType } from "@repo/db"

type AuthContext = { userId: string; pageType: PageType }

const env = loadEnv()
initJwks(env.jwksUrl)

const server = new Server({
  port: env.port,

  async onAuthenticate({ token, documentName }) {
    if (!token) throw new Error("Missing auth token")
    const { userId } = await verifyJwt(token, env.jwtAudience)
    const access = await canAccessPage(userId, documentName)
    if (!access) {
      log.warn("page access denied", { userId, pageId: documentName })
      throw new Error("Forbidden")
    }
    log.info("authenticated", { userId, pageId: documentName, pageType: access.pageType })
    const ctx: AuthContext = { userId, pageType: access.pageType }
    return ctx
  },

  async onLoadDocument({ documentName }) {
    return loadPageDocument(documentName)
  },

  async onStoreDocument({ documentName, document, context }) {
    const ctx = context as Partial<AuthContext>
    if (!ctx.pageType) {
      throw new Error("missing pageType in onStoreDocument context")
    }
    const { pageType } = ctx as AuthContext
    await storePageDocument({ pageId: documentName, document, pageType })
  },
})

process.on("unhandledRejection", (err) => {
  log.error("unhandled rejection", { error: String(err) })
})

process.on("uncaughtException", (err) => {
  log.error("uncaught exception", {
    error: String(err),
    stack: err instanceof Error ? err.stack : undefined,
  })
  process.exit(1)
})

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    log.info("shutting down", { signal: sig })
    try {
      await server.destroy()
    } catch (err) {
      log.error("server destroy failed", { error: String(err) })
    }
    process.exit(0)
  })
}

await server.listen()
log.info("yjs server listening", { port: env.port })
