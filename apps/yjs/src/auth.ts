import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"
import { prisma, PageType } from "@repo/db"

import { log } from "./logger"

let jwksFetcher: ReturnType<typeof createRemoteJWKSet> | null = null

export function initJwks(jwksUrl: string): void {
  jwksFetcher = createRemoteJWKSet(new URL(jwksUrl))
  log.info("JWKS fetcher initialized", { jwksUrl })
}

export async function verifyJwt(
  token: string,
  audience: string | undefined,
): Promise<{ userId: string }> {
  if (!jwksFetcher) throw new Error("JWKS not initialized; call initJwks first")
  const { payload } = await jwtVerify(token, jwksFetcher, {
    audience,
  })
  const userId = pickUserId(payload)
  if (!userId) throw new Error("JWT missing subject (userId)")
  return { userId }
}

function pickUserId(payload: JWTPayload): string | undefined {
  if (typeof payload.sub === "string") return payload.sub
  if (typeof (payload as { userId?: unknown }).userId === "string") {
    return (payload as { userId: string }).userId
  }
  return undefined
}

export async function canAccessPage(
  userId: string,
  pageId: string,
): Promise<{ pageType: PageType } | null> {
  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      deletedAt: null,
      workspace: { members: { some: { userId } } },
    },
    select: { type: true },
  })
  return page ? { pageType: page.type } : null
}
