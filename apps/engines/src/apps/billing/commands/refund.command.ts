import { Command, CommandRunner } from "nest-commander"

import { RefundService } from "../services/refund.service.js"

@Command({
  name: "refund",
  description: "Полный возврат по Order id",
  arguments: "<orderId>",
})
export class RefundCommand extends CommandRunner {
  constructor(private readonly refunds: RefundService) {
    super()
  }

  async run(passedParams: string[]): Promise<void> {
    const [orderId] = passedParams
    if (!orderId) {
      console.error("Usage: cli refund <orderId>")
      process.exitCode = 1
      return
    }

    const result = await this.refunds.fullRefund(orderId)
    console.log("Refund:", result.yookassaRefundId)
    console.log("Order:", orderId, "-> REFUNDED")
    console.log("Subscription:", result.subscriptionId, "-> EXPIRED")
  }
}
