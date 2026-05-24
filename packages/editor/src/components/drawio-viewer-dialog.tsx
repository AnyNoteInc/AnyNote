'use client'

import CloseIcon from '@mui/icons-material/Close'
import { Box, Dialog, IconButton } from '@mui/material'

type Props = {
  open: boolean
  svg: string
  onClose: () => void
}

export function DrawioViewerDialog({ open, svg, onClose }: Props) {
  return (
    <Dialog open={open} onClose={onClose} fullScreen>
      <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
        <IconButton onClick={onClose} aria-label="Закрыть">
          <CloseIcon />
        </IconButton>
      </Box>
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 4,
        }}
      >
        {svg ? (
          <Box
            component="img"
            src={svg}
            alt=""
            sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        ) : null}
      </Box>
    </Dialog>
  )
}
