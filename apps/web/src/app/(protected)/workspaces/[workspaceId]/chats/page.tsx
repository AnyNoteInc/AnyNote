import { redirect } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"
import { Box, ChatBubbleOutlineIcon, Typography } from "@repo/ui/components"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function ChatsIndexPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const chats = await trpc.chat.listChats({ workspaceId })
  if (chats.length > 0) {
    redirect(`/workspaces/${workspaceId}/chats/${chats[0]!.id}`)
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 2,
        color: "text.disabled",
      }}
    >
      <ChatBubbleOutlineIcon sx={{ fontSize: 48 }} />
      <Typography variant="body1">Создайте первый чат с помощью кнопки «+ Новый чат»</Typography>
    </Box>
  )
}
