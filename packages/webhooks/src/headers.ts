/** Header names sent on every webhook delivery and verification challenge. */
export const WEBHOOK_DELIVERY_HEADERS = {
  signature: 'X-AnyNote-Signature',
  timestamp: 'X-AnyNote-Timestamp',
  event: 'X-AnyNote-Event',
  delivery: 'X-AnyNote-Delivery',
  payloadVersion: 'X-AnyNote-Payload-Version',
} as const
