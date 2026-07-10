import { Injectable, Logger } from '@nestjs/common'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { SignJWT } from 'jose'
import * as Y from 'yjs'

import {
  computeTargetDoc,
  prepareDocUpdate,
  readTiptapDoc,
  type ContentEdit,
  type TiptapDoc,
} from './yjs-content.js'

const SYNC_TIMEOUT_MS = 4_000
const FLUSH_TIMEOUT_MS = 4_000

export type ApplyResult = { applied: false } | { applied: true; replacements: number }

/**
 * Applies agent content edits THROUGH the collaboration server (apps/yjs), as
 * a short-lived Hocuspocus client. This is the lost-update guard: while a page
 * is open in a browser, Hocuspocus holds the authoritative in-memory doc — a
 * direct DB write would be invisible to connected editors and silently
 * overwritten by the next onStoreDocument. Editing the live doc instead makes
 * the change appear in open editors instantly, and persistence (content
 * snapshot + contentYjs + revision + outbox) rides the server's normal store
 * path.
 *
 * Auth: a self-minted share token (HS256, YJS_SHARE_TOKEN_SECRET — the same
 * secret apps/web mints share tokens with) scoped to this page with
 * role EDITOR and the acting user as subject. The secret is shared backend
 * infra; the token is minted only after the MCP tool has already passed the
 * JWT scope gate (pages:write) and the PageWriter workspace check.
 *
 * When the yjs server is unreachable/unconfigured we return `applied: false`
 * and callers fall back to the direct DB write — correct in that state, since
 * an unreachable collaboration server also means no live docs exist.
 */
@Injectable()
export class YjsPageEditor {
  private readonly logger = new Logger(YjsPageEditor.name)

  async applyContentEdit(args: {
    pageId: string
    actorUserId: string
    edit: ContentEdit
  }): Promise<ApplyResult> {
    const url =
      process.env.YJS_INTERNAL_WS_URL ?? process.env.NEXT_PUBLIC_YJS_URL ?? 'ws://localhost:1234'
    const secret = process.env.YJS_SHARE_TOKEN_SECRET
    if (!secret) {
      this.logger.warn(
        'YJS_SHARE_TOKEN_SECRET is not set — page edits fall back to direct DB writes',
      )
      return { applied: false }
    }

    const token = await this.mintShareToken(secret, args.pageId, args.actorUserId, 'EDITOR')

    const document = new Y.Doc()
    const socket = new HocuspocusProviderWebsocket({
      url,
      // Node has a spec-compliant global WebSocket since v21.
      WebSocketPolyfill: WebSocket,
      // Fail fast: a dead yjs server means no live docs — the DB fallback is
      // correct there, and retry loops would only stall the agent tool call.
      maxAttempts: 1,
    })
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: args.pageId,
      document,
      token,
    })

    try {
      try {
        // Subscribe BEFORE attach so no event can slip past the waiter. With an
        // explicit websocketProvider the provider does NOT auto-attach
        // (manageSocket=false) — without attach() it never authenticates/syncs.
        const synced = this.waitForSync(provider, socket)
        provider.attach()
        await synced
      } catch (err) {
        this.logger.warn(
          `yjs connection failed for page ${args.pageId}: ${(err as Error).message} — falling back to direct DB write`,
        )
        return { applied: false }
      }

      const current = readTiptapDoc(document)
      const { doc: target, replacements } = computeTargetDoc(current, args.edit)
      if (args.edit.kind === 'replaceText' && replacements === 0) {
        return { applied: true, replacements: 0 }
      }

      // Validation happens BEFORE any mutation. A schema-invalid target (the
      // agent can hand updatePage an arbitrary doc-shaped `content`) falls back
      // to the DB path, which persists the raw JSON — the pre-live-path
      // behavior (tryBuildContentYjs's graceful degradation). Errors AFTER this
      // point propagate: the doc is live and a DB fallback would race it.
      let apply: (ydoc: Y.Doc) => void
      try {
        apply = prepareDocUpdate(target)
      } catch (err) {
        this.logger.warn(
          `schema-invalid content for page ${args.pageId}: ${(err as Error).message} — falling back to raw DB persist`,
        )
        return { applied: false }
      }
      apply(document)
      await this.flushOutgoing(provider)
      return { applied: true, replacements }
    } finally {
      provider.destroy()
      socket.destroy()
    }
  }

  /** Current TEXT-page content as seen by the LIVE collaborative doc. The DB
   *  snapshot lags behind it (Hocuspocus persists on debounce/unload), so tool
   *  reads right after a live edit must come from here or the agent re-reads
   *  pre-edit content. Returns null when the yjs server is unreachable or
   *  unconfigured — callers fall back to the DB snapshot, correct then. */
  async readLiveContent(args: { pageId: string; actorUserId: string }): Promise<TiptapDoc | null> {
    const url =
      process.env.YJS_INTERNAL_WS_URL ?? process.env.NEXT_PUBLIC_YJS_URL ?? 'ws://localhost:1234'
    const secret = process.env.YJS_SHARE_TOKEN_SECRET
    if (!secret) return null

    const token = await this.mintShareToken(secret, args.pageId, args.actorUserId, 'READER')
    const document = new Y.Doc()
    const socket = new HocuspocusProviderWebsocket({
      url,
      WebSocketPolyfill: WebSocket,
      maxAttempts: 1,
    })
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: args.pageId,
      document,
      token,
    })
    try {
      const synced = this.waitForSync(provider, socket)
      provider.attach()
      await synced
      return readTiptapDoc(document)
    } catch (err) {
      this.logger.warn(
        `yjs read failed for page ${args.pageId}: ${(err as Error).message} — using the DB snapshot`,
      )
      return null
    } finally {
      provider.destroy()
      socket.destroy()
    }
  }

  /** Share token for the collab server (HS256, the same secret apps/web mints
   *  share tokens with): page-scoped, short-lived, minted only after the MCP
   *  tool already passed the JWT scope gate and the PageWriter workspace check. */
  private mintShareToken(
    secret: string,
    pageId: string,
    actorUserId: string,
    role: 'READER' | 'EDITOR',
  ) {
    return new SignJWT({
      typ: 'share',
      pageId,
      shareId: 'agent-tools',
      role,
      name: 'AI-агент',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(actorUserId)
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(new TextEncoder().encode(secret))
  }

  private waitForSync(provider: HocuspocusProvider, socket: HocuspocusProviderWebsocket) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sync timeout')), SYNC_TIMEOUT_MS)
      const done = (fn: () => void) => {
        clearTimeout(timer)
        fn()
      }
      provider.on('synced', () => done(resolve))
      provider.on('authenticationFailed', ({ reason }: { reason: string }) =>
        done(() => reject(new Error(`auth failed: ${reason}`))),
      )
      socket.on('close', () => done(() => reject(new Error('connection closed'))))
    })
  }

  /** Wait until the provider has no unsynced outgoing updates (best-effort,
   *  bounded) so destroy() can't drop the edit on the floor. */
  private flushOutgoing(provider: HocuspocusProvider) {
    if (!provider.hasUnsyncedChanges) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const timer = setTimeout(finish, FLUSH_TIMEOUT_MS)
      function finish() {
        clearTimeout(timer)
        provider.off('unsyncedChanges', check)
        resolve()
      }
      function check() {
        if (!provider.hasUnsyncedChanges) finish()
      }
      provider.on('unsyncedChanges', check)
      check()
    })
  }
}
