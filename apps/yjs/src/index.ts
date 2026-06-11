import { Server } from '@hocuspocus/server'

import { loadEnv } from './env.js'
import {
  initJwks,
  verifyJwt,
  canAccessPage,
  isReadOnlyAccess,
  verifyShareToken,
  loadPageMeta,
} from './auth.js'
import { loadPageDocument, storePageDocument } from './persistence.js'
import { log } from './logger.js'
import type { PageType } from '@repo/db'

type AuthContext = { userId: string; pageType: PageType; workspaceId: string }

const env = loadEnv()
initJwks(env.jwksUrl)

const server = new Server({
  port: env.port,

  async onAuthenticate({ token, documentName, connectionConfig }) {
    if (!token) throw new Error('Missing auth token')

    // Share-token path (anonymous or non-member viewers via /s/{shareId}).
    const share = await verifyShareToken(token, env.shareTokenSecret)
    if (share) {
      if (share.pageId !== documentName) throw new Error('Forbidden')
      const meta = await loadPageMeta(documentName)
      if (!meta) throw new Error('Forbidden')
      // Reader/commenter connections are read-only; the server rejects their writes
      // regardless of any client-side editable flag. Editor is writable.
      if (share.role === 'READER' || share.role === 'COMMENTER') {
        connectionConfig.readOnly = true
      }
      log.info('authenticated (share)', {
        userId: share.userId,
        pageId: documentName,
        role: share.role,
        readOnly: connectionConfig.readOnly,
      })
      const ctx: AuthContext = {
        userId: share.userId,
        pageType: meta.pageType,
        workspaceId: meta.workspaceId,
      }
      return ctx
    }

    // Workspace path: active members (write) or PageShareUser grant holders
    // (role-mapped); workspace-blocked users are denied in both arms.
    const { userId } = await verifyJwt(token, env.jwtAudience)
    const access = await canAccessPage(userId, documentName)
    if (!access) {
      log.warn('page access denied', { userId, pageId: documentName })
      throw new Error('Forbidden')
    }
    // READER/COMMENTER grants are read-only; the server rejects their writes
    // regardless of any client-side editable flag. EDITOR grants and members write.
    if (isReadOnlyAccess(access)) {
      connectionConfig.readOnly = true
    }
    log.info('authenticated', {
      userId,
      pageId: documentName,
      pageType: access.pageType,
      workspaceId: access.workspaceId,
      access: access.access,
      role: access.role,
      readOnly: connectionConfig.readOnly,
    })
    const ctx: AuthContext = {
      userId,
      pageType: access.pageType,
      workspaceId: access.workspaceId,
    }
    return ctx
  },

  async onLoadDocument({ documentName }) {
    return loadPageDocument(documentName)
  },

  async onStoreDocument({ documentName, document, context }) {
    const { pageType, workspaceId } = context as AuthContext
    if (!pageType || !workspaceId) {
      throw new Error('missing pageType/workspaceId in onStoreDocument context')
    }
    await storePageDocument({ pageId: documentName, workspaceId, document, pageType })
  },
})

process.on('unhandledRejection', (err) => {
  log.error('unhandled rejection', { error: String(err) })
})

process.on('uncaughtException', (err) => {
  log.error('uncaught exception', {
    error: String(err),
    stack: err instanceof Error ? err.stack : undefined,
  })
  process.exit(1)
})

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    log.info('shutting down', { signal: sig })
    try {
      await server.destroy()
    } catch (err) {
      log.error('server destroy failed', { error: String(err) })
    }
    process.exit(0)
  })
}

await server.listen()
log.info('yjs server listening', { port: env.port })
