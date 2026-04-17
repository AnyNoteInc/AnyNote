"use client"

import { Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = {
  id: string
  initialTitle: string | null
}

// Subscribes to page.getById with RSC-seeded initialData so that rename /
// update mutations that invalidate the cache re-render the header title.
export function PageTitle({ id, initialTitle }: Props) {
  const query = trpc.page.getById.useQuery({ id }, { staleTime: 0 })
  const title = query.data?.title ?? initialTitle
  return <Typography variant="h5">{title ?? "Без названия"}</Typography>
}
