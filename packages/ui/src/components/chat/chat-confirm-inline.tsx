'use client'

import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import { alpha } from '@mui/material/styles'
import Typography from '@mui/material/Typography'

export type ChatConfirmInlineProps = Readonly<{
  confirmationId: string
  tool: string
  summary: string
  argsPreview?: unknown
  onResolve: (confirmationId: string, action: 'allow' | 'deny') => void
  onAllowAll?: (tool: string) => void
}>

export function ChatConfirmInline(props: ChatConfirmInlineProps) {
  return (
    <Box
      data-testid="chat-confirm-inline"
      sx={{
        bgcolor: (theme) => alpha(theme.palette.warning.light, 0.12),
        border: 1,
        borderColor: 'warning.light',
        borderRadius: 2.5,
        my: 1,
        p: 1.75,
        width: '100%',
      }}
    >
      <Typography sx={{ color: 'warning.dark', fontSize: 14, fontWeight: 600 }}>
        ⚠️ Требуется подтверждение
      </Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: 14, my: 1 }}>{props.summary}</Typography>
      {props.argsPreview ? (
        <Box
          component="pre"
          sx={{
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1.5,
            fontSize: 12.5,
            m: 0,
            mb: 1.25,
            overflow: 'auto',
            p: 1,
          }}
        >
          {JSON.stringify(props.argsPreview, null, 2)}
        </Box>
      ) : null}
      <Stack direction="row" flexWrap="wrap" spacing={1} useFlexGap>
        <Button
          color="primary"
          onClick={() => props.onResolve(props.confirmationId, 'allow')}
          size="small"
          startIcon={<CheckRoundedIcon />}
          variant="contained"
        >
          Разрешить
        </Button>
        {props.onAllowAll ? (
          <Button onClick={() => props.onAllowAll?.(props.tool)} size="small" variant="outlined">
            Разрешать в этом чате
          </Button>
        ) : null}
        <Button
          color="inherit"
          onClick={() => props.onResolve(props.confirmationId, 'deny')}
          size="small"
          startIcon={<CloseRoundedIcon />}
        >
          Отклонить
        </Button>
      </Stack>
    </Box>
  )
}
