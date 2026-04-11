"use client"

import { useEffect } from "react"

import { Box, Button, Paper, Stack, Typography } from "@repo/ui/components"

export type PageErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
  title?: string
  hint?: string
}

export function PageError({
  error,
  reset,
  title = "Что-то пошло не так",
  hint = "Попробуйте повторить запрос — мы уже получили отчёт об ошибке.",
}: PageErrorProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <Box
      sx={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: { xs: 2, md: 4 },
      }}
    >
      <Paper
        elevation={0}
        sx={{
          p: { xs: 3, md: 4 },
          borderRadius: 2,
          border: "1px solid",
          borderColor: "divider",
          maxWidth: 520,
          width: "100%",
          textAlign: "center",
        }}
      >
        <Stack spacing={2} alignItems="center">
          <Typography variant="overline" color="error">
            Ошибка
          </Typography>
          <Typography variant="h5" fontWeight={700}>
            {title}
          </Typography>
          <Typography color="text.secondary">{hint}</Typography>
          {error.digest ? (
            <Typography variant="caption" color="text.secondary">
              ID: {error.digest}
            </Typography>
          ) : null}
          <Button variant="contained" onClick={reset}>
            Повторить
          </Button>
        </Stack>
      </Paper>
    </Box>
  )
}
