import { Server } from "@hocuspocus/server"

import { loadEnv } from "./env"
import { initJwks, verifyJwt, canAccessPage } from "./auth"
import { loadPageDocument, storePageDocument } from "./persistence"
import { log } from "./logger"
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
    const { pageType } = context as AuthContext
    await storePageDocument({ pageId: documentName, document, pageType })
  },
})

server.listen()
log.info("yjs server listening", { port: env.port })
