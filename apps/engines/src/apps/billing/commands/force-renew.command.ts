import { Command, CommandRunner } from "nest-commander"

import { SubscriptionRenewalService } from "../services/subscription-renewal.service.js"

@Command({
  name: "force-renew",
  description: "Force-renew subscription bypassing currentPeriodEnd",
  arguments: "<subscriptionId>",
})
export class ForceRenewCommand extends CommandRunner {
  constructor(private readonly renewals: SubscriptionRenewalService) {
    super()
  }

  async run(passedParams: string[]): Promise<void> {
    const [subscriptionId] = passedParams
    if (!subscriptionId) {
      console.error("Usage: cli force-renew <subscriptionId>")
      process.exitCode = 1
      return
    }

    await this.renewals.renewOne(subscriptionId)
    console.log("Renewal attempted for", subscriptionId)
  }
}
