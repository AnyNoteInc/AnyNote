import { Server } from '@hocuspocus/server'

import { loadEnv } from './env.js'
import {
  initJwks,
  verifyJwt,
  canAccessPage,
  canAccessSyncedBlock,
  isReadOnlyAccess,
  verifyShareToken,
  loadPageMeta,
} from './auth.js'
import {
  loadPageDocument,
  storePageDocument,
  loadSyncedBlockDocument,
  storeSyncedBlockDocument,
} from './persistence.js'
import { parseDocumentName } from './parse.js'
import { log } from './logger.js'
import type { PageType } from '@repo/db'

// The auth context is discriminated by document kind so onStoreDocument routes
// to the right table without re-parsing the name.
type AuthContext =
  | { kind: 'page'; userId: string; pageType: PageType; workspaceId: string }
  | { kind: 'syncedBlock'; userId: string; blockId: string }

const env = loadEnv()
initJwks(env.jwksUrl)

const server = new Server({
  port: env.port,

  async onAuthenticate({ token, documentName, connectionConfig }) {
    if (!token) throw new Error('Missing auth token')

    const parsed = parseDocumentName(documentName)

    // Synced-block document (Phase 9C): members/grant holders only. Share tokens
    // are page-scoped and NEVER admit a live nested-doc connection — anonymous /
    // public-share viewers see the synced block via the server-rendered snapshot
    // (the node render-prop), not this live document. Reject any share token here.
    if (parsed.kind === 'syncedBlock') {
      const share = await verifyShareToken(token, env.shareTokenSecret)
      if (share) {
        log.warn('share token rejected on synced-block document', {
          userId: share.userId,
          blockId: parsed.id,
        })
        throw new Error('Forbidden')
      }
      const { userId } = await verifyJwt(token, env.jwtAudience)
      const access = await canAccessSyncedBlock(userId, parsed.id)
      if (!access) {
        log.warn('synced-block access denied', { userId, blockId: parsed.id })
        throw new Error('Forbidden')
      }
      // VIEWER/COMMENTER origin access ⇒ read-only, mapped identically to pages.
      if (isReadOnlyAccess(access)) {
        connectionConfig.readOnly = true
      }
      log.info('authenticated (synced block)', {
        userId,
        blockId: parsed.id,
        access: access.access,
        role: access.role,
        readOnly: connectionConfig.readOnly,
      })
      const ctx: AuthContext = { kind: 'syncedBlock', userId, blockId: parsed.id }
      return ctx
    }

    // Page document — the historical contract (documentName === pageId), unchanged.
    const pageId = parsed.id

    // Share-token path (anonymous or non-member viewers via /s/{shareId}).
    const share = await verifyShareToken(token, env.shareTokenSecret)
    if (share) {
      if (share.pageId !== pageId) throw new Error('Forbidden')
      const meta = await loadPageMeta(pageId)
      if (!meta) throw new Error('Forbidden')
      // Reader/commenter connections are read-only; the server rejects their writes
      // regardless of any client-side editable flag. Editor is writable.
      if (share.role === 'READER' || share.role === 'COMMENTER') {
        connectionConfig.readOnly = true
      }
      log.info('authenticated (share)', {
        userId: share.userId,
        pageId,
        role: share.role,
        readOnly: connectionConfig.readOnly,
      })
      const ctx: AuthContext = {
        kind: 'page',
        userId: share.userId,
        pageType: meta.pageType,
        workspaceId: meta.workspaceId,
      }
      return ctx
    }

    // Workspace path: active members (write) or PageShareUser grant holders
    // (role-mapped); workspace-blocked users are denied in both arms.
    const { userId } = await verifyJwt(token, env.jwtAudience)
    const access = await canAccessPage(userId, pageId)
    if (!access) {
      log.warn('page access denied', { userId, pageId })
      throw new Error('Forbidden')
    }
    // READER/COMMENTER grants are read-only; the server rejects their writes
    // regardless of any client-side editable flag. EDITOR grants and members write.
    if (isReadOnlyAccess(access)) {
      connectionConfig.readOnly = true
    }
    log.info('authenticated', {
      userId,
      pageId,
      pageType: access.pageType,
      workspaceId: access.workspaceId,
      access: access.access,
      role: access.role,
      readOnly: connectionConfig.readOnly,
    })
    const ctx: AuthContext = {
      kind: 'page',
      userId,
      pageType: access.pageType,
      workspaceId: access.workspaceId,
    }
    return ctx
  },

  async onLoadDocument({ documentName }) {
    const parsed = parseDocumentName(documentName)
    return parsed.kind === 'syncedBlock'
      ? loadSyncedBlockDocument(parsed.id)
      : loadPageDocument(parsed.id)
  },

  async onStoreDocument({ documentName, document, context }) {
    const ctx = context as AuthContext
    if (ctx.kind === 'syncedBlock') {
      await storeSyncedBlockDocument({ blockId: ctx.blockId, document })
      return
    }
    if (!ctx.pageType || !ctx.workspaceId) {
      throw new Error('missing pageType/workspaceId in onStoreDocument context')
    }
    await storePageDocument({
      pageId: parseDocumentName(documentName).id,
      workspaceId: ctx.workspaceId,
      document,
      pageType: ctx.pageType,
    })
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
