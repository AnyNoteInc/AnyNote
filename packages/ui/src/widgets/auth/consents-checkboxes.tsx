'use client'

import type { FieldErrors, UseFormRegister } from 'react-hook-form'

import { Box, Checkbox, FormControlLabel, Typography } from '@repo/ui/components'

export type ConsentsCheckboxesValues = {
  agreedToTerms: boolean
  agreedToMarketing: boolean
}

export type ConsentsCheckboxesUrls = {
  userAgreement: string
  privacyPolicy: string
  piiConsent: string
  publicOffer: string
  marketingConsent: string
}

export type ConsentsCheckboxesProps = {
  register: UseFormRegister<ConsentsCheckboxesValues>
  errors: FieldErrors<ConsentsCheckboxesValues>
  urls: ConsentsCheckboxesUrls
}

const linkSx = { color: 'primary.main' } as const

export function ConsentsCheckboxes({ register, errors, urls }: Readonly<ConsentsCheckboxesProps>) {
  return (
    <Box>
      <FormControlLabel
        sx={{ alignItems: 'flex-start', m: 0 }}
        control={
          <Checkbox
            {...register('agreedToTerms', { required: 'Необходимо принять условия' })}
            size="small"
            data-testid="register-terms-checkbox"
          />
        }
        label={
          <Typography variant="body2" color="text.secondary" sx={{ pt: 0.75 }}>
            Я принимаю{' '}
            <Box
              component="a"
              href={urls.userAgreement}
              target="_blank"
              rel="noopener noreferrer"
              sx={linkSx}
            >
              пользовательское соглашение
            </Box>
            ,{' '}
            <Box
              component="a"
              href={urls.privacyPolicy}
              target="_blank"
              rel="noopener noreferrer"
              sx={linkSx}
            >
              политику обработки персональных данных
            </Box>
            ,{' '}
            <Box
              component="a"
              href={urls.piiConsent}
              target="_blank"
              rel="noopener noreferrer"
              sx={linkSx}
            >
              согласие на обработку персональных данных
            </Box>{' '}
            и{' '}
            <Box
              component="a"
              href={urls.publicOffer}
              target="_blank"
              rel="noopener noreferrer"
              sx={linkSx}
            >
              оферту на оказание услуг
            </Box>
          </Typography>
        }
      />
      {errors.agreedToTerms ? (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5, ml: 4 }}>
          {errors.agreedToTerms.message}
        </Typography>
      ) : null}

      <FormControlLabel
        sx={{ alignItems: 'flex-start', m: 0, mt: 1 }}
        control={
          <Checkbox
            {...register('agreedToMarketing')}
            size="small"
            data-testid="register-marketing-checkbox"
          />
        }
        label={
          <Typography variant="body2" color="text.secondary" sx={{ pt: 0.75 }}>
            Я согласен получать{' '}
            <Box
              component="a"
              href={urls.marketingConsent}
              target="_blank"
              rel="noopener noreferrer"
              sx={linkSx}
            >
              информационные и рекламные рассылки
            </Box>{' '}
            на указанный email.
          </Typography>
        }
      />
    </Box>
  )
}
