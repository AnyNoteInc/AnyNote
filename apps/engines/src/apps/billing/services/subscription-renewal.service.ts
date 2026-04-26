import { Injectable } from "@nestjs/common"

@Injectable()
export class SubscriptionRenewalService {
  async expireCanceled(): Promise<void> {}

  async renewActive(): Promise<void> {}

  async renewOne(_subscriptionId: string): Promise<void> {}
}
