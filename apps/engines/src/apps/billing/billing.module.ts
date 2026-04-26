import { Module } from "@nestjs/common"

import { SubscriptionRenewalCronService } from "./cron/subscription-renewal-cron.service.js"
import { RefundService } from "./services/refund.service.js"
import { SubscriptionRenewalService } from "./services/subscription-renewal.service.js"
import { YookassaClientFactory } from "./services/yookassa-client.factory.js"

@Module({
  providers: [YookassaClientFactory, SubscriptionRenewalService, RefundService, SubscriptionRenewalCronService],
  exports: [SubscriptionRenewalService, RefundService, YookassaClientFactory],
})
export class BillingModule {}
