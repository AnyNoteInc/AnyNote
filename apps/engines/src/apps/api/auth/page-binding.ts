import { ForbiddenException } from '@nestjs/common'

import type { AuthContext } from './auth-context.js'

/**
 * Defense-in-depth for page-bound chats: when the auth context carries a
 * boundPageId (HMAC-covered `x-agents-bound-page` header), page write tools
 * may only target that page. Call right after assertMember in every tool
 * handler that writes to an explicit pageId.
 */
export function assertPageBindingAllows(auth: AuthContext, pageId: string): void {
  if (auth.boundPageId && pageId !== auth.boundPageId) {
    throw new ForbiddenException(
      `Этот чат привязан к другой странице — изменять можно только страницу ${auth.boundPageId}`,
    )
  }
}

/**
 * For tools that create new pages: a page-bound chat works with exactly one
 * page and must not create others. `what` names the blocked action for the
 * error message, e.g. 'создание страниц'.
 */
export function assertNotPageBound(auth: AuthContext, what: string): void {
  if (auth.boundPageId) {
    throw new ForbiddenException(
      `Этот чат привязан к странице ${auth.boundPageId} — ${what} здесь недоступно`,
    )
  }
}
