import { describe, expect, it } from "vitest"

import { parseWebhookEvent, verifyTrustedIp } from "../webhook"

describe("parseWebhookEvent", () => {
  it("parses payment.succeeded event", () => {
    const event = parseWebhookEvent({
      type: "notification",
      event: "payment.succeeded",
      object: {
        id: "pmt_1",
        status: "succeeded",
        paid: true,
        amount: { value: "150.00", currency: "RUB" },
        created_at: "2026-04-26T00:00:00Z",
      },
    })
    expect(event.event).toBe("payment.succeeded")
    expect(event.object.id).toBe("pmt_1")
  })

  it("parses payment.canceled event", () => {
    const event = parseWebhookEvent({
      type: "notification",
      event: "payment.canceled",
      object: {
        id: "pmt_2",
        status: "canceled",
        paid: false,
        amount: { value: "150.00", currency: "RUB" },
        created_at: "2026-04-26T00:00:00Z",
      },
    })
    expect(event.event).toBe("payment.canceled")
  })

  it("parses refund.succeeded event", () => {
    const event = parseWebhookEvent({
      type: "notification",
      event: "refund.succeeded",
      object: {
        id: "rf_1",
        payment_id: "pmt_1",
        status: "succeeded",
        amount: { value: "150.00", currency: "RUB" },
        created_at: "2026-04-26T00:00:00Z",
      },
    })
    expect(event.event).toBe("refund.succeeded")
  })

  it("throws on unknown event", () => {
    expect(() => parseWebhookEvent({ event: "weird" })).toThrow()
  })

  it("throws on missing body", () => {
    expect(() => parseWebhookEvent(null)).toThrow()
  })

  it("throws on missing object", () => {
    expect(() => parseWebhookEvent({ event: "payment.succeeded" })).toThrow()
  })
})

describe("verifyTrustedIp", () => {
  it("returns true when allowlist is empty/undefined", () => {
    expect(verifyTrustedIp("8.8.8.8", undefined)).toBe(true)
    expect(verifyTrustedIp("8.8.8.8", "")).toBe(true)
  })

  it("returns true when ip is in CIDR allowlist", () => {
    expect(verifyTrustedIp("185.71.76.5", "185.71.76.0/27,77.75.156.0/27")).toBe(true)
    expect(verifyTrustedIp("77.75.156.10", "185.71.76.0/27,77.75.156.0/27")).toBe(true)
  })

  it("returns false when ip is outside", () => {
    expect(verifyTrustedIp("8.8.8.8", "185.71.76.0/27")).toBe(false)
  })

  it("returns false on malformed ip", () => {
    expect(verifyTrustedIp("not.an.ip", "185.71.76.0/27")).toBe(false)
  })

  it("supports single-host /32 entries", () => {
    expect(verifyTrustedIp("1.2.3.4", "1.2.3.4/32")).toBe(true)
    expect(verifyTrustedIp("1.2.3.5", "1.2.3.4/32")).toBe(false)
  })
})
