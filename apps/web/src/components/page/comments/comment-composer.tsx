'use client'

import { useState } from 'react'

import { Button, Stack, TextField } from '@repo/ui/components'

type Props = {
  onSubmit: (c: { text: string; mentions: string[] }) => void
  autoFocus?: boolean
  pending?: boolean
}

export function CommentComposer({ onSubmit, autoFocus, pending }: Props) {
  const [text, setText] = useState('')

  const submit = () => {
    const t = text.trim()
    if (!t) return
    onSubmit({ text: t, mentions: [] })
    setText('')
  }

  return (
    <Stack direction="row" spacing={1} alignItems="flex-end">
      <TextField
        fullWidth
        size="small"
        multiline
        maxRows={6}
        placeholder="Комментарий…"
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
      />
      <Button variant="contained" size="small" onClick={submit} disabled={pending || !text.trim()}>
        Отпр.
      </Button>
    </Stack>
  )
}
