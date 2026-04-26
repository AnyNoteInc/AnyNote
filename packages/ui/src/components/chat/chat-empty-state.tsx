'use client'

import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

type ChatEmptyStateProps = {
  title?: string
  description?: string
}

export function ChatEmptyState({
  title = 'Сообщений пока нет',
  description = 'Отправьте первое сообщение, чтобы начать диалог.',
}: ChatEmptyStateProps) {
  return (
    <Box
      alignItems="center"
      display="flex"
      flexDirection="column"
      gap={1.5}
      justifyContent="center"
      px={3}
      py={6}
      textAlign="center"
    >
      <Box
        alignItems="center"
        borderRadius="50%"
        display="flex"
        height={56}
        justifyContent="center"
        sx={{ bgcolor: 'action.hover', color: 'text.secondary' }}
        width={56}
      >
        <ChatBubbleOutlineIcon />
      </Box>
      <Typography variant="h6">{title}</Typography>
      <Typography color="text.secondary" maxWidth={420} variant="body2">
        {description}
      </Typography>
    </Box>
  )
}
