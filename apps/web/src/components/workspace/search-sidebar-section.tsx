"use client"

import Link from "next/link"
import { useState } from "react"

import { Box, Stack, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = { workspaceId: string; collapsed: boolean }

export function SearchSidebarSection({ workspaceId, collapsed }: Props) {
  const [open, setOpen] = useState(true)
  const chats = trpc.search.listChats.useQuery({ workspaceId })
  const create = trpc.search.createChat.useMutation()

  if (collapsed) {
    return (
      <Link href={`/workspaces/${workspaceId}/search`} style={{ textDecoration: "none" }}>
        <Box
          title="Поиск"
          sx={{
            display: "flex",
            justifyContent: "center",
            py: 0.75,
            color: "text.secondary",
            "&:hover": { color: "text.primary" },
          }}
        >
          ⌕
        </Box>
      </Link>
    )
  }

  return (
    <Box>
      <Box
        onClick={() => setOpen((prev) => !prev)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.75,
          cursor: "pointer",
          color: "text.secondary",
          "&:hover": { color: "text.primary" },
        }}
      >
        <span>⌕</span>
        <span style={{ fontSize: 13, flex: 1 }}>Поиск</span>
        <span style={{ fontSize: 11 }}>{open ? "▾" : "▸"}</span>
      </Box>
      {open ? (
        <Stack spacing={0.25} sx={{ pl: 3 }}>
          {chats.data?.map((chat) => (
            <Link
              key={chat.id}
              href={`/workspaces/${workspaceId}/search/${chat.id}`}
              style={{ textDecoration: "none" }}
            >
              <Typography
                variant="body2"
                noWrap
                sx={{ py: 0.5, color: "text.secondary", "&:hover": { color: "text.primary" } }}
              >
                {chat.title}
              </Typography>
            </Link>
          ))}
          <Box
            onClick={() => create.mutate({ workspaceId })}
            sx={{
              cursor: "pointer",
              py: 0.5,
              color: "text.disabled",
              "&:hover": { color: "text.primary" },
              fontSize: 13,
            }}
          >
            ＋ Новый чат
          </Box>
        </Stack>
      ) : null}
    </Box>
  )
}
