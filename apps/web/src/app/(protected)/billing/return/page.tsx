import { notFound } from "next/navigation"
import { prisma } from "@repo/db"
import { requireSession } from "@/lib/get-session"
import { OrderProgress } from "@/components/billing/order-progress"

type Props = { searchParams: Promise<{ orderId?: string }> }

export default async function BillingReturnPage({ searchParams }: Props) {
  const session = await requireSession()
  const { orderId } = await searchParams
  if (!orderId) notFound()
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true },
  })
  if (!order || order.userId !== session.user.id) notFound()
  return <OrderProgress orderId={order.id} />
}
