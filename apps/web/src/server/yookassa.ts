import "server-only"
import { YookassaClient } from "@repo/yookassa"

let client: YookassaClient | null = null

export function getYookassaClient(): YookassaClient {
  if (client) return client
  const shopId = process.env.YOOKASSA_SHOP_ID
  const secretKey = process.env.YOOKASSA_SECRET_KEY
  if (!shopId || !secretKey) {
    throw new Error("YOOKASSA_SHOP_ID/SECRET_KEY env vars not set")
  }
  client = new YookassaClient({ shopId, secretKey })
  return client
}

export function getReturnUrlBase(): string {
  return (
    process.env.YOOKASSA_RETURN_URL_BASE ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "http://localhost:3000"
  )
}
