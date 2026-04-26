import { Module } from "@nestjs/common"

import { CancelSubscriptionCommand } from "./commands/cancel-subscription.command.js"
import { ForceRenewCommand } from "./commands/force-renew.command.js"
import { RefundCommand } from "./commands/refund.command.js"
import { SubscriptionRenewalCronService } from "./cron/subscription-renewal-cron.service.js"
import { RefundService } from "./services/refund.service.js"
import { SubscriptionRenewalService } from "./services/subscription-renewal.service.js"
import { YookassaClientFactory } from "./services/yookassa-client.factory.js"

@Module({
  providers: [
    YookassaClientFactory,
    SubscriptionRenewalService,
    RefundService,
    SubscriptionRenewalCronService,
    RefundCommand,
    ForceRenewCommand,
    CancelSubscriptionCommand,
  ],
  exports: [SubscriptionRenewalService, RefundService, YookassaClientFactory],
})
export class BillingModule {}
