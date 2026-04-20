"use client"

import { Box, Button, Stack, Typography } from "@mui/material"
import type { ReactElement } from "react"

export interface ChatEmptyStateProps {
  title?: string
  subtitle?: string
  suggestions?: string[]
  onSuggestion?: (text: string) => void
}

export function ChatEmptyState({
  title = "Чем помочь?",
  subtitle,
  suggestions,
  onSuggestion,
}: ChatEmptyStateProps): ReactElement {
  return (
    <Box
      sx={{
        flexGrow: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        px: 3,
        py: 6,
        gap: 1,
        color: "text.primary",
      }}
    >
      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body1" color="text.secondary" sx={{ textAlign: "center" }}>
          {subtitle}
        </Typography>
      )}
      {suggestions && suggestions.length > 0 && (
        <Stack direction="row" gap={1} flexWrap="wrap" justifyContent="center" sx={{ mt: 2 }}>
          {suggestions.map((s) => (
            <Button
              key={s}
              variant="outlined"
              size="small"
              onClick={() => onSuggestion?.(s)}
              sx={{ borderRadius: 999 }}
            >
              {s}
            </Button>
          ))}
        </Stack>
      )}
    </Box>
  )
}
