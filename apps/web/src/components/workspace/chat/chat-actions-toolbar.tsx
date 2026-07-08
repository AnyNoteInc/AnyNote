'use client'

import { IconButton, Stack, StarBorderIcon, StarIcon } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

type Props = {
  chatId: string
  workspaceId: string
}

export function ChatActionsToolbar({ chatId, workspaceId }: Props) {
  const utils = trpc.useUtils()
  const favorites = trpc.chat.listFavorites.useQuery({ workspaceId })
  const isFavorite = (favorites.data ?? []).some((chat) => chat.id === chatId)

  const addFavorite = trpc.chat.addFavorite.useMutation({
    onSuccess: async () => {
      await utils.chat.listFavorites.invalidate({ workspaceId })
    },
  })

  const removeFavorite = trpc.chat.removeFavorite.useMutation({
    onSuccess: async () => {
      await utils.chat.listFavorites.invalidate({ workspaceId })
    },
  })

  const toggleFavorite = () => {
    if (isFavorite) {
      removeFavorite.mutate({ chatId })
    } else {
      addFavorite.mutate({ chatId })
    }
  }

  return (
    <Stack
      direction="row"
      spacing={0.5}
      className="chat-actions-toolbar"
      sx={{ alignItems: 'center' }}
    >
      <IconButton
        size="small"
        onClick={toggleFavorite}
        aria-label={isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}
        disabled={addFavorite.isPending || removeFavorite.isPending}
        sx={{ color: 'text.secondary' }}
      >
        {isFavorite ? (
          <StarIcon sx={{ color: 'warning.main', fontSize: 20 }} />
        ) : (
          <StarBorderIcon sx={{ fontSize: 20 }} />
        )}
      </IconButton>
    </Stack>
  )
}
