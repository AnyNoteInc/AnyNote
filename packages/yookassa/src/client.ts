import { YookassaApiError } from './errors.ts'
import type { CreatePaymentInput, CreateRefundInput, Payment, Refund } from './types.ts'

export type ChargeSavedInput = Omit<
  CreatePaymentInput,
  'save_payment_method' | 'confirmation' | 'capture'
> & {
  payment_method_id: string
}

export type YookassaClientOpts = {
  shopId: string
  secretKey: string
  baseUrl?: string
  fetch?: typeof fetch
}

export class YookassaClient {
  private readonly baseUrl: string
  private readonly auth: string
  private readonly fetchImpl: typeof fetch

  constructor(opts: YookassaClientOpts) {
    this.baseUrl = opts.baseUrl ?? 'https://api.yookassa.ru/v3'
    this.auth = `Basic ${Buffer.from(`${opts.shopId}:${opts.secretKey}`).toString('base64')}`
    this.fetchImpl = opts.fetch ?? fetch
  }

  private async request<T>(path: string, init: RequestInit, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: this.auth,
      'Content-Type': 'application/json',
    }

    if (idempotencyKey) {
      headers['Idempotence-Key'] = idempotencyKey
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    })

    const body = await response.json().catch(() => undefined)

    if (!response.ok) {
      const code =
        typeof body === 'object' && body !== null && 'code' in body ? String(body.code) : undefined
      throw new YookassaApiError(code ?? 'YooKassa API request failed', response.status, body)
    }

    return body as T
  }

  createPayment(input: CreatePaymentInput, idempotencyKey: string): Promise<Payment> {
    return this.request<Payment>(
      '/payments',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      idempotencyKey,
    )
  }

  chargeWithSavedMethod(input: ChargeSavedInput, idempotencyKey: string): Promise<Payment> {
    return this.request<Payment>(
      '/payments',
      {
        method: 'POST',
        body: JSON.stringify({ ...input, capture: true }),
      },
      idempotencyKey,
    )
  }

  getPayment(paymentId: string): Promise<Payment> {
    return this.request<Payment>(`/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' })
  }

  createRefund(input: CreateRefundInput, idempotencyKey: string): Promise<Refund> {
    return this.request<Refund>(
      '/refunds',
      { method: 'POST', body: JSON.stringify(input) },
      idempotencyKey,
    )
  }

  getRefund(id: string): Promise<Refund> {
    return this.request<Refund>(`/refunds/${id}`, { method: 'GET' })
  }
}
