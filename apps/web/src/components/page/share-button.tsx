'use client'

import { useState } from 'react'

import { Button, ScreenShareIcon } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { ShareDialog } from './share-dialog'

type Props = { pageId: string }

export function ShareButton({ pageId }: Props) {
  const [open, setOpen] = useState(false)
  // canManage probe: page.share.get throws FORBIDDEN for non-managers; hide the button then.
  const probe = trpc.page.share.get.useQuery({ pageId }, { retry: false })

  if (probe.isError) return null

  return (
    <>
      <Button
        size="small"
        variant="contained"
        startIcon={<ScreenShareIcon sx={{ fontSize: 18 }} />}
        onClick={() => setOpen(true)}
      >
        Поделиться
      </Button>
      <ShareDialog open={open} onClose={() => setOpen(false)} pageId={pageId} />
    </>
  )
}
