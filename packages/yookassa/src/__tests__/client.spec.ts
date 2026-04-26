import { describe, expect, it, vi } from 'vitest'

import { YookassaClient } from '../client'
import type { ChargeSavedInput } from '../index'

describe('YookassaClient', () => {
  const payment = {
    id: 'pmt_1',
    status: 'pending',
    paid: false,
    amount: { value: '150.00', currency: 'RUB' },
    confirmation: {
      type: 'redirect',
      confirmation_url: 'https://yookassa.ru/checkout/payments/pmt_1',
    },
    created_at: '2026-04-26T12:00:00.000Z',
  }

  it('posts createPayment requests with Basic auth and idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(payment),
    })
    const client = new YookassaClient({
      shopId: 'shop',
      secretKey: 'secret',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const result = await client.createPayment(
      {
        amount: { value: '150.00', currency: 'RUB' },
        capture: true,
        confirmation: {
          type: 'redirect',
          return_url: 'https://example.com/return',
        },
      },
      'idem_1',
    )

    expect(fetchMock).toHaveBeenCalledWith('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from('shop:secret').toString('base64')}`,
        'Content-Type': 'application/json',
        'Idempotence-Key': 'idem_1',
      },
      body: JSON.stringify({
        amount: { value: '150.00', currency: 'RUB' },
        capture: true,
        confirmation: {
          type: 'redirect',
          return_url: 'https://example.com/return',
        },
      }),
    })
    expect(result.id).toBe('pmt_1')
  })

  it('posts chargeWithSavedMethod requests with payment method id, capture, and idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...payment, status: 'succeeded', paid: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const client = new YookassaClient({
      shopId: 'shop',
      secretKey: 'secret',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const input = {
      amount: { value: '150.00', currency: 'RUB' },
      payment_method_id: 'pm_1',
      description: 'Saved payment method charge',
      metadata: { orderId: 'order_1' },
    } satisfies ChargeSavedInput

    const result = await client.chargeWithSavedMethod(input, 'idem_2')

    expect(fetchMock).toHaveBeenCalledWith('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from('shop:secret').toString('base64')}`,
        'Content-Type': 'application/json',
        'Idempotence-Key': 'idem_2',
      },
      body: expect.any(String),
    })
    const [, requestInit] = fetchMock.mock.calls[0]!
    expect(JSON.parse(String(requestInit.body))).toEqual({
      amount: { value: '150.00', currency: 'RUB' },
      capture: true,
      payment_method_id: 'pm_1',
      description: 'Saved payment method charge',
      metadata: { orderId: 'order_1' },
    })
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('confirmation'),
      }),
    )
    expect(result.status).toBe('succeeded')
  })

  it('gets payment by id without an idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payment), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const client = new YookassaClient({
      shopId: 'shop',
      secretKey: 'secret',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const result = await client.getPayment('pmt_1/with space')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.yookassa.ru/v3/payments/pmt_1%2Fwith%20space',
      {
        method: 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from('shop:secret').toString('base64')}`,
          'Content-Type': 'application/json',
        },
      },
    )
    expect(result).toEqual(payment)
  })
})

describe('YookassaClient.createRefund', () => {
  it('posts to /refunds with idempotency', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'rf_1',
          payment_id: 'pmt_1',
          status: 'succeeded',
          amount: { value: '150.00', currency: 'RUB' },
          created_at: '2026-04-26T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const client = new YookassaClient({
      shopId: 'shop',
      secretKey: 'secret',
      fetch: fetchMock as unknown as typeof fetch,
    })
    const r = await client.createRefund(
      { payment_id: 'pmt_1', amount: { value: '150.00', currency: 'RUB' } },
      'rf-key',
    )
    expect(r.id).toBe('rf_1')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.yookassa.ru/v3/refunds')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers as HeadersInit)
    expect(headers.get('Idempotence-Key')).toBe('rf-key')
  })
})

describe('YookassaClient.getRefund', () => {
  it('fetches refund by id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'rf_2',
          payment_id: 'pmt_2',
          status: 'succeeded',
          amount: { value: '150.00', currency: 'RUB' },
          created_at: '2026-04-26T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const client = new YookassaClient({
      shopId: 'shop',
      secretKey: 'secret',
      fetch: fetchMock as unknown as typeof fetch,
    })
    const r = await client.getRefund('rf_2')
    expect(r.id).toBe('rf_2')
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.yookassa.ru/v3/refunds/rf_2')
  })
})
