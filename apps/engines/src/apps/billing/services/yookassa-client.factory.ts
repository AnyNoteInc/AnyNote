import { Injectable } from '@nestjs/common'
import { YookassaClient } from '@repo/yookassa'

@Injectable()
export class YookassaClientFactory {
  private client: YookassaClient | null = null

  get(): YookassaClient {
    if (this.client) {
      return this.client
    }

    const shopId = process.env.YOOKASSA_SHOP_ID
    const secretKey = process.env.YOOKASSA_SECRET_KEY

    if (!shopId || !secretKey) {
      throw new Error('YOOKASSA_SHOP_ID/SECRET_KEY missing')
    }

    this.client = new YookassaClient({ shopId, secretKey })
    return this.client
  }
}
