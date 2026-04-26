import { describe, expect, it, vi } from "vitest"

import { YookassaClient } from "../client"

describe("YookassaClient", () => {
  it("posts createPayment requests with Basic auth and idempotency key", async () => {
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
})
