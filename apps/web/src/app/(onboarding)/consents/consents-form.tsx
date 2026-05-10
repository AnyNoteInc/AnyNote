'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

const URLS = {
  userAgreement: '/terms/user-agreement',
  privacyPolicy: '/terms/privacy-policy',
  piiConsent: '/terms/consent',
  publicOffer: '/terms/public-offer',
  marketingConsent: '/terms/marketing-consent',
} as const

const linkSx = { color: 'primary.main' } as const

export function ConsentsOnboardingForm() {
  const router = useRouter()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [agreedTerms, setAgreedTerms] = useState(false)
  const [agreedMarketing, setAgreedMarketing] = useState(false)
  const [showTermsError, setShowTermsError] = useState(false)
  const accept = trpc.consent.acceptRequired.useMutation()

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)
    if (!agreedTerms) {
      setShowTermsError(true)
      return
    }
    try {
      await accept.mutateAsync({ marketing: agreedMarketing })
      router.push('/profile')
    } catch (e) {
      setErrorMessage((e as Error).message ?? 'Не удалось сохранить согласия.')
    }
  }

  return (
    <Stack spacing={3} component="form" onSubmit={onSubmit}>
      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      <Box>
        <FormControlLabel
          sx={{ alignItems: 'flex-start', m: 0 }}
          control={
            <Checkbox
              size="small"
              checked={agreedTerms}
              onChange={(e) => {
                setAgreedTerms(e.target.checked)
                if (e.target.checked) setShowTermsError(false)
              }}
              data-testid="register-terms-checkbox"
            />
          }
          label={
            <Typography variant="body2" color="text.secondary" sx={{ pt: 0.75 }}>
              Я принимаю{' '}
              <Box component="a" href={URLS.userAgreement} target="_blank" rel="noopener noreferrer" sx={linkSx}>
                пользовательское соглашение
              </Box>
              ,{' '}
              <Box component="a" href={URLS.privacyPolicy} target="_blank" rel="noopener noreferrer" sx={linkSx}>
                политику обработки персональных данных
              </Box>
              ,{' '}
              <Box component="a" href={URLS.piiConsent} target="_blank" rel="noopener noreferrer" sx={linkSx}>
                согласие на обработку персональных данных
              </Box>{' '}
              и{' '}
              <Box component="a" href={URLS.publicOffer} target="_blank" rel="noopener noreferrer" sx={linkSx}>
                оферту на оказание услуг
              </Box>
            </Typography>
          }
        />
        {showTermsError ? (
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5, ml: 4 }}>
            Необходимо принять условия
          </Typography>
        ) : null}
        <FormControlLabel
          sx={{ alignItems: 'flex-start', m: 0, mt: 1 }}
          control={
            <Checkbox
              size="small"
              checked={agreedMarketing}
              onChange={(e) => setAgreedMarketing(e.target.checked)}
              data-testid="register-marketing-checkbox"
            />
          }
          label={
            <Typography variant="body2" color="text.secondary" sx={{ pt: 0.75 }}>
              Я согласен получать{' '}
              <Box component="a" href={URLS.marketingConsent} target="_blank" rel="noopener noreferrer" sx={linkSx}>
                информационные и рекламные рассылки
              </Box>{' '}
              на указанный email.
            </Typography>
          }
        />
      </Box>
      <Button
        type="submit"
        variant="contained"
        size="large"
        disabled={accept.isPending}
      >
        Принять и продолжить
      </Button>
    </Stack>
  )
}
