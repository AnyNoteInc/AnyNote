import { describe, expect, it, vi } from "vitest"

import { YookassaClient } from "../client"

describe("YookassaClient", () => {
  const payment = {
    id: "pmt_1",
    status: "pending",
    paid: false,
    amount: { value: "150.00", currency: "RUB" },
    confirmation: {
      type: "redirect",
      confirmation_url: "https://yookassa.ru/checkout/payments/pmt_1",
    },
    created_at: "2026-04-26T12:00:00.000Z",
  }

  it("posts createPayment requests with Basic auth and idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(payment),
    })
    const client = new YookassaClient({
      shopId: "shop",
      secretKey: "secret",
      fetch: fetchMock as unknown as typeof fetch,
    })

    const result = await client.createPayment(
      {
        amount: { value: "150.00", currency: "RUB" },
        capture: true,
        confirmation: {
          type: "redirect",
          return_url: "https://example.com/return",
        },
      },
      "idem_1",
    )

    expect(fetchMock).toHaveBeenCalledWith("https://api.yookassa.ru/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from("shop:secret").toString("base64")}`,
        "Content-Type": "application/json",
        "Idempotence-Key": "idem_1",
      },
      body: JSON.stringify({
        amount: { value: "150.00", currency: "RUB" },
        capture: true,
        confirmation: {
          type: "redirect",
          return_url: "https://example.com/return",
        },
      }),
    })
    expect(result.id).toBe("pmt_1")
  })

  it("posts chargeWithSavedMethod requests with payment method id, capture, and idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...payment, status: "succeeded", paid: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    const client = new YookassaClient({
      shopId: "shop",
      secretKey: "secret",
      fetch: fetchMock as unknown as typeof fetch,
    })

    const result = await client.chargeWithSavedMethod(
      {
        amount: { value: "150.00", currency: "RUB" },
        capture: false,
        payment_method_id: "pm_1",
        description: "Saved payment method charge",
        metadata: { orderId: "order_1" },
      },
      "idem_2",
    )

    expect(fetchMock).toHaveBeenCalledWith("https://api.yookassa.ru/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from("shop:secret").toString("base64")}`,
        "Content-Type": "application/json",
        "Idempotence-Key": "idem_2",
      },
      body: JSON.stringify({
        amount: { value: "150.00", currency: "RUB" },
        capture: true,
        payment_method_id: "pm_1",
        description: "Saved payment method charge",
        metadata: { orderId: "order_1" },
      }),
    })
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining("confirmation"),
      }),
    )
    expect(result.status).toBe("succeeded")
  })

  it("gets payment by id without an idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payment), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    const client = new YookassaClient({
      shopId: "shop",
      secretKey: "secret",
      fetch: fetchMock as unknown as typeof fetch,
    })

    const result = await client.getPayment("pmt_1")

    expect(fetchMock).toHaveBeenCalledWith("https://api.yookassa.ru/v3/payments/pmt_1", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from("shop:secret").toString("base64")}`,
        "Content-Type": "application/json",
      },
    })
    expect(result).toEqual(payment)
  })
})
