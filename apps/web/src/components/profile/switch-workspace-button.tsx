'use client'

import { useRouter } from 'next/navigation'

import { Button } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

export function SwitchWorkspaceButton({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const setActive = trpc.workspace.setActive.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.page.listByWorkspace.invalidate(),
        utils.page.listFavorites.invalidate(),
        utils.chat.listChats.invalidate(),
        utils.workspace.getActive.invalidate(),
      ])
      router.push('/app')
      router.refresh()
    },
  })
  return (
    <Button
      size="small"
      variant="outlined"
      disabled={setActive.isPending}
      onClick={() => setActive.mutate({ workspaceId })}
    >
      Перейти
    </Button>
  )
}
