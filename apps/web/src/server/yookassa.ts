import 'server-only'
import type { Payment, YookassaClient } from '@repo/yookassa/next'
import { prisma } from '@repo/db'
import { YookassaClient as RealYookassaClient } from '@repo/yookassa/next'
import { handlePaymentSucceeded } from '@/server/billing/webhook-handlers'

let client: YookassaClient | null = null

class MockYookassaClient implements Pick<YookassaClient, 'createPayment' | 'getPayment'> {
  async createPayment(input: Parameters<YookassaClient['createPayment']>[0]): Promise<Payment> {
    const orderId = input.metadata?.orderId
    const paymentId = `mock_${orderId ?? crypto.randomUUID()}`
    if (orderId) {
      await prisma.order.update({
        where: { id: orderId },
        data: { yookassaPaymentId: paymentId },
      })
    }
    const payment = {
      id: paymentId,
      status: 'pending' as const,
      paid: false,
      amount: input.amount,
      confirmation: {
        type: 'redirect' as const,
        return_url: input.confirmation?.return_url ?? '',
        confirmation_url: input.confirmation?.return_url ?? '',
      },
      created_at: new Date().toISOString(),
      metadata: input.metadata,
    } satisfies Payment
    await handlePaymentSucceeded({ yookassa: this as unknown as YookassaClient, prisma }, payment)
    return payment
  }

  async getPayment(id: string): Promise<Payment> {
    const order = await prisma.order.findUniqueOrThrow({
      where: { yookassaPaymentId: id },
      include: { plan: true },
    })
    return {
      id,
      status: 'succeeded',
      paid: true,
      amount: { value: (order.amountKopecks / 100).toFixed(2), currency: 'RUB' },
      payment_method: {
        id: `pm_${order.id}`,
        type: 'bank_card',
        saved: true,
        card: { last4: '0000', card_type: 'MIR' },
      },
      created_at: new Date().toISOString(),
      metadata: {
        orderId: order.id,
        userId: order.userId,
        planSlug: order.plan.slug,
        period: order.billingPeriod,
      },
    }
  }
}

export function getYookassaClient(): YookassaClient {
  if (client) return client
  if (process.env.YOOKASSA_MOCK_ENABLED === 'true' && process.env.PLAYWRIGHT !== 'true') {
    throw new Error('YOOKASSA_MOCK_ENABLED is only supported under Playwright')
  }
  if (process.env.YOOKASSA_MOCK_ENABLED === 'true') {
    client = new MockYookassaClient() as unknown as YookassaClient
    return client
  }
  const shopId = process.env.YOOKASSA_SHOP_ID
  const secretKey = process.env.YOOKASSA_SECRET_KEY
  if (!shopId || !secretKey) {
    throw new Error('YOOKASSA_SHOP_ID/SECRET_KEY env vars not set')
  }
  client = new RealYookassaClient({ shopId, secretKey })
  return client
}

/**
 * Public origin used for links minted server-side in the tRPC context:
 * invite/join/guest-invite/share emails AND the YooKassa payment return URL.
 *
 * Prefer `BETTER_AUTH_URL` (the authoritative runtime origin) so emailed links
 * never carry the build-time `localhost:3000`. `YOOKASSA_RETURN_URL_BASE` is
 * kept as a fallback for the rare case it must diverge from the auth domain,
 * then `NEXT_PUBLIC_BASE_URL`, then localhost for dev. Empty/whitespace values
 * are treated as unset and trailing slashes trimmed so `${base}/path` is clean.
 */
export function getReturnUrlBase(): string {
  const pick = (v: string | undefined): string | undefined => v?.trim() || undefined
  const raw =
    pick(process.env.BETTER_AUTH_URL) ??
    pick(process.env.YOOKASSA_RETURN_URL_BASE) ??
    pick(process.env.NEXT_PUBLIC_BASE_URL) ??
    'http://localhost:3000'
  return raw.replace(/\/+$/, '')
}
