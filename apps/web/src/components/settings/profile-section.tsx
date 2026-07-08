'use client'

import { useState } from 'react'

import { Alert, Box, Button, Stack, TextField, Typography } from '@repo/ui/components'

import ProfileAvatarUploader from '@/components/profile/profile-avatar-uploader'
import { trpc } from '@/trpc/client'

type Props = Readonly<{
  initial: {
    firstName: string
    lastName: string
    email: string
    emailVerified: boolean
    image: string | null
  }
}>

export function ProfileSection({ initial }: Props) {
  const [firstName, setFirstName] = useState(initial.firstName)
  const [lastName, setLastName] = useState(initial.lastName)
  const [verifyMessage, setVerifyMessage] = useState<{
    severity: 'success' | 'error'
    text: string
  } | null>(null)
  const updateProfile = trpc.user.updateProfile.useMutation()
  const resendVerification = trpc.user.resendVerificationEmail.useMutation({
    onSuccess: () => {
      setVerifyMessage({
        severity: 'success',
        text: 'Письмо с подтверждением отправлено на ваш email',
      })
    },
    onError: (error) => {
      setVerifyMessage({
        severity: 'error',
        text: error.message || 'Не удалось отправить письмо. Попробуйте позже.',
      })
    },
  })
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
  const handleResendVerification = (): void => {
    if (initial.emailVerified || resendVerification.isPending) return
    setVerifyMessage(null)
    resendVerification.mutate()
  }

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: { xs: 2.5, md: 3 },
        backgroundColor: 'background.paper',
      }}
    >
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        Профиль
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Имя, email и аватар, которые видят другие
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
        <ProfileAvatarUploader currentImage={initial.image} initials={initials} />
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
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
      <Stack direction="row" spacing={1.5} sx={{ mb: 1, alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          Email
        </Typography>
        <Box
          component={initial.emailVerified ? 'span' : 'button'}
          type={initial.emailVerified ? undefined : 'button'}
          onClick={initial.emailVerified ? undefined : handleResendVerification}
          disabled={initial.emailVerified ? undefined : resendVerification.isPending}
          aria-label={initial.emailVerified ? undefined : 'Отправить письмо подтверждения'}
          sx={{
            px: 1,
            py: 0.25,
            border: 'none',
            borderRadius: 10,
            fontSize: 10,
            fontWeight: 600,
            color: initial.emailVerified ? 'success.dark' : 'warning.dark',
            backgroundColor: initial.emailVerified ? 'success.light' : 'warning.light',
            cursor: initial.emailVerified ? 'default' : 'pointer',
            opacity: !initial.emailVerified && resendVerification.isPending ? 0.6 : 1,
            transition: 'opacity 0.15s ease',
            '&:hover': initial.emailVerified
              ? undefined
              : { backgroundColor: 'warning.main', color: 'warning.contrastText' },
          }}
        >
          {(() => {
            if (initial.emailVerified) return 'Подтверждён'
            return resendVerification.isPending ? 'Отправка…' : 'Не подтверждён'
          })()}
        </Box>
      </Stack>
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          px: 1.5,
          py: 1,
          backgroundColor: 'action.hover',
        }}
      >
        <Typography variant="body2">{initial.email}</Typography>
      </Box>
      {verifyMessage ? (
        <Alert severity={verifyMessage.severity} sx={{ mt: 1.5 }}>
          {verifyMessage.text}
        </Alert>
      ) : null}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
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
