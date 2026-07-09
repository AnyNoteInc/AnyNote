'use client'

import Box from '@mui/material/Box'
import Collapse from '@mui/material/Collapse'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

type ChatThinkingBlockProps = Readonly<{ text: string }>

export function ChatThinkingBlock({ text }: ChatThinkingBlockProps) {
  const [open, setOpen] = useState(false)
  return (
    <Box sx={{ my: 0.5 }}>
      <Stack
        direction="row"
        onClick={() => setOpen((v) => !v)}
        spacing={0.9}
        sx={{
          alignItems: 'center',
          color: 'text.secondary',
          cursor: 'pointer',
          fontSize: 13.5,
          userSelect: 'none',
        }}
      >
        <Box sx={{ bgcolor: 'warning.light', borderRadius: '50%', height: 5, width: 5 }} />
        <Typography sx={{ fontWeight: 600 }} variant="caption">
          Размышления
        </Typography>
        <Typography variant="caption">{open ? '▾' : '▸'}</Typography>
      </Stack>
      <Collapse in={open}>
        <Typography
          sx={{
            borderColor: 'divider',
            borderLeft: 2,
            color: 'text.secondary',
            fontSize: 14,
            fontStyle: 'italic',
            mt: 1,
            pl: 1.75,
            whiteSpace: 'pre-wrap',
          }}
        >
          {text}
        </Typography>
      </Collapse>
    </Box>
  )
}
