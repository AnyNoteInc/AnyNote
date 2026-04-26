"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { Box, Stack, CircularProgress, Typography, Button } from "@repo/ui/components"
import { trpc } from "@/trpc/client"

export function OrderProgress({ orderId }: { orderId: string }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const [shouldPoll, setShouldPoll] = useState(true)
  const query = trpc.subscription.getOrder.useQuery({ orderId }, {
    refetchInterval: shouldPoll ? 2000 : false,
  })

  useEffect(() => {
    if (query.data && query.data.status !== "PENDING") {
      setShouldPoll(false)
    }
  }, [query.data])

  const order = query.data
  if (!order) {
    return (
      <Centered>
        <CircularProgress />
      </Centered>
    )
  }

  if (order.status === "PAID") {
    return (
      <Centered>
        <Typography variant="h5">Оплата прошла успешно</Typography>
        <Button component={Link} href="/app" variant="contained">
          В рабочее пространство
        </Button>
      </Centered>
    )
  }

  if (order.status === "FAILED") {
    return (
      <Centered>
        <Typography variant="h5" color="error">
          Не удалось провести оплату
        </Typography>
        <Button component={Link} href="/pricing" variant="outlined">
          Попробовать ещё раз
        </Button>
      </Centered>
    )
  }

  // PENDING
  if (elapsed > 30) {
    return (
      <Centered>
        <Typography variant="h6">Платёж в обработке</Typography>
        <Typography color="text.secondary">
          Уведомим, когда подтвердится. Можно вернуться в кабинет.
        </Typography>
        <Button component={Link} href="/settings/billing" variant="text">
          В настройки подписки
        </Button>
      </Centered>
    )
  }
  return (
    <Centered>
      <CircularProgress />
      <Typography>Обрабатываем оплату…</Typography>
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: "70vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Stack spacing={2} alignItems="center">
        {children}
      </Stack>
    </Box>
  )
}
