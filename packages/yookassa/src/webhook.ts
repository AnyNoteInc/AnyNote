import type { WebhookEvent } from "./types.js"

export const parseWebhookEvent = (_body: unknown): WebhookEvent => {
  throw new Error("parseWebhookEvent is not implemented")
}

export const verifyTrustedIp = (_ip: string): boolean => {
  throw new Error("verifyTrustedIp is not implemented")
}
