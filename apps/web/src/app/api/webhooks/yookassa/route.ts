import { NextRequest, NextResponse } from 'next/server'
import { parseWebhookEvent, verifyTrustedIp } from '@repo/yookassa/next'
import { prisma } from '@repo/db'
import { getYookassaClient } from '@/server/yookassa'
import {
  handlePaymentSucceeded,
  handlePaymentCanceled,
  handleRefundSucceeded,
} from '@/server/billing/webhook-handlers'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? '?'
  if (!verifyTrustedIp(ip, process.env.YOOKASSA_TRUSTED_IPS)) {
    return NextResponse.json({ error: 'untrusted ip' }, { status: 403 })
  }

  let event
  try {
    event = parseWebhookEvent(await req.json())
  } catch {
    return NextResponse.json({ error: 'bad event' }, { status: 400 })
  }

  const ctx = { yookassa: getYookassaClient(), prisma }
  switch (event.event) {
    case 'payment.succeeded':
      await handlePaymentSucceeded(ctx, event.object)
      break
    case 'payment.canceled':
      await handlePaymentCanceled(ctx, event.object)
      break
    case 'refund.succeeded':
      await handleRefundSucceeded(ctx, event.object)
      break
    case 'payment.waiting_for_capture':
      break
  }
  return NextResponse.json({ ok: true })
}
