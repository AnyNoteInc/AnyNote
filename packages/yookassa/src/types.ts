export type YookassaCurrency = "RUB"

export type Money = {
  value: string
  currency: YookassaCurrency
}

export type YookassaAmount = Money

export type ConfirmationRedirect = {
  type: "redirect"
  confirmation_url: string
  return_url?: string
}

export type CreatePaymentConfirmation = {
  type: "redirect"
  return_url: string
}

export type CreatePaymentInput = {
  amount: Money
  capture: boolean
  save_payment_method?: boolean
  payment_method_id?: string
  confirmation?: CreatePaymentConfirmation
  description?: string
  metadata?: Record<string, string>
}

export type CreateRefundInput = {
  payment_id: string
  amount: Money
  description?: string
}

export type PaymentMethodCard = {
  first6?: string
  last4?: string
  expiry_month?: string
  expiry_year?: string
  card_type?: string
  issuer_country?: string
  issuer_name?: string
}

export type PaymentMethod = {
  id: string
  type: string
  saved?: boolean
  title?: string
  card?: PaymentMethodCard
}

export type CancellationDetails = {
  party: string
  reason: string
}

export type Payment = {
  id: string
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled"
  paid: boolean
  amount: YookassaAmount
  captured?: boolean
  confirmation?: ConfirmationRedirect
  payment_method?: PaymentMethod
  metadata?: Record<string, string>
  cancellation_details?: CancellationDetails
  refundable?: boolean
  created_at: string
  captured_at?: string
}

export type Refund = {
  id: string
  status: "pending" | "succeeded" | "canceled"
  payment_id: string
  amount: YookassaAmount
  metadata?: Record<string, string>
  created_at: string
}

export type PaymentWebhookEvent = {
  type: "notification"
  event: "payment.succeeded" | "payment.canceled" | "payment.waiting_for_capture"
  object: Payment
}

export type RefundWebhookEvent = {
  type: "notification"
  event: "refund.succeeded"
  object: Refund
}

export type WebhookEvent = PaymentWebhookEvent | RefundWebhookEvent
