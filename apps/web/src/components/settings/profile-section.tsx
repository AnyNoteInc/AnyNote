"use client"

import { useState } from "react"

import { Box, Button, Stack, TextField, Typography } from "@repo/ui/components"

import ProfileAvatarUploader from "@/components/profile/profile-avatar-uploader"
import { trpc } from "@/trpc/client"

type Props = {
  initial: {
    firstName: string
    lastName: string
    email: string
    emailVerified: boolean
    image: string | null
  }
}

export function ProfileSection({ initial }: Props) {
  const [firstName, setFirstName] = useState(initial.firstName)
  const [lastName, setLastName] = useState(initial.lastName)
  const updateProfile = trpc.user.updateProfile.useMutation()
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: { xs: 2.5, md: 3 },
        backgroundColor: "background.paper",
      }}
    >
      <Typography variant="subtitle1" fontWeight={700}>
        Профиль
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Имя, email и аватар, которые видят другие
      </Typography>
      <Box sx={{ display: "flex", justifyContent: "center", mb: 3 }}>
        <ProfileAvatarUploader currentImage={initial.image} initials={initials} />
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mb: 2 }}>
        <TextField
          label="Имя"
          size="small"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
        <TextField
          label="Фамилия"
          size="small"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
        />
      </Box>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Email
        </Typography>
        <Box
          sx={{
            px: 1,
            py: 0.25,
            borderRadius: 10,
            fontSize: 10,
            fontWeight: 600,
            color: initial.emailVerified ? "success.dark" : "warning.dark",
            backgroundColor: initial.emailVerified ? "success.light" : "warning.light",
          }}
        >
          {initial.emailVerified ? "Подтверждён" : "Не подтверждён"}
        </Box>
      </Stack>
      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          value={initial.email}
          sx={{ flex: 1 }}
          InputProps={{ readOnly: true }}
        />
        <Button variant="outlined" size="small" disabled>
          Изменить
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        Смена email потребует повторного подтверждения по ссылке
      </Typography>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 3 }}>
        <Button
          variant="contained"
          size="small"
          disabled={updateProfile.isPending}
          onClick={() => updateProfile.mutate({ firstName, lastName })}
        >
          Сохранить
        </Button>
      </Box>
    </Box>
  )
}
