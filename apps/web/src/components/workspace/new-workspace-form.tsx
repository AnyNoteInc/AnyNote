"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Alert, Box, Button, Stack, TextField, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

export function NewWorkspaceForm() {
  const [name, setName] = useState("")
  const [icon, setIcon] = useState("📒")
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const create = trpc.workspace.create.useMutation({
    onSuccess: (workspace) => {
      router.push(`/workspaces/${workspace.id}`)
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        create.mutate({ name: name.trim(), icon })
      }}
      sx={{ maxWidth: 480, mx: "auto", mt: { xs: 4, md: 8 } }}
    >
      <Stack spacing={3}>
        <Stack spacing={1} textAlign="center">
          <Typography variant="h4" fontWeight={800} letterSpacing="-0.02em">
            Создайте рабочее пространство
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Каждое пространство — это контейнер для ваших страниц, баз и медиа
          </Typography>
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Название"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          inputProps={{ maxLength: 64 }}
          autoFocus
        />
        <TextField
          label="Иконка (эмодзи)"
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          inputProps={{ maxLength: 4 }}
          helperText="Один эмодзи для украшения сайдбара"
        />
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={create.isPending || !name.trim()}
        >
          Создать пространство
        </Button>
      </Stack>
    </Box>
  )
}
