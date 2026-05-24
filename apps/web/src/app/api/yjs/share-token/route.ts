import { randomUUID } from 'node:crypto'
import { SignJWT } from 'jose'
import { NextResponse, type NextRequest } from 'next/server'

import { prisma } from '@repo/db'

import { getSession } from '@/lib/get-session'
import { resolveShareAccess } from '@/lib/share-access'

export const runtime = 'nodejs'

const ANIMALS = ['Лис', 'Кот', 'Барс', 'Сокол', 'Ёж', 'Бобр', 'Тур', 'Краб']

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { shareId?: string } | null
  const shareId = body?.shareId
  if (!shareId) return NextResponse.json({ error: 'shareId required' }, { status: 400 })

  const session = await getSession()
  const { page, role } = await resolveShareAccess(prisma, shareId, session)
  if (!page || !role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sub = session?.user?.id ?? `anon:${randomUUID()}`
  const name = session?.user
    ? [session.user.firstName, session.user.lastName].filter(Boolean).join(' ').trim() ||
      session.user.email
    : `Гость · ${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`

  const secretRaw = process.env.YJS_SHARE_TOKEN_SECRET
  if (!secretRaw) {
    return NextResponse.json({ error: 'Share tokens are not configured' }, { status: 500 })
  }
  const secret = new TextEncoder().encode(secretRaw)
  const token = await new SignJWT({ typ: 'share', pageId: page.id, shareId, role, name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secret)

  return NextResponse.json({ token })
}
