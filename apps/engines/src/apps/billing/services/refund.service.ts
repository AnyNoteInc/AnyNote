import { Injectable } from "@nestjs/common"

@Injectable()
export class RefundService {
  async fullRefund(_orderId: string): Promise<{ yookassaRefundId: string; subscriptionId: string }> {
    throw new Error("not implemented")
  }
}
