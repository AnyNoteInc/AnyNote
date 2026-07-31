'use client'

import Link from 'next/link'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  FormHelperText,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

type ContactFormState = {
  name: string
  company: string
  email: string
  phone: string
  message: string
}

const initialState: ContactFormState = {
  name: '',
  company: '',
  email: '',
  phone: '',
  message: '',
}

const CONTACT_ERROR_MESSAGE = 'Не удалось отправить заявку. Попробуйте ещё раз.'

export function ContactForm() {
  const [form, setForm] = useState<ContactFormState>(initialState)
  const [agree, setAgree] = useState(false)
  const [agreeError, setAgreeError] = useState(false)
  const [agreeMarketing, setAgreeMarketing] = useState(false)
  const [agreeMarketingError, setAgreeMarketingError] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleChange =
    (field: keyof ContactFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [field]: event.target.value }))
      setSubmitError(null)
    }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitError(null)
    let hasError = false
    if (!agree) {
      setAgreeError(true)
      hasError = true
    }
    if (!agreeMarketing) {
      setAgreeMarketingError(true)
      hasError = true
    }
    if (hasError) return

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          consentPersonalData: agree,
          consentMarketing: agreeMarketing,
        }),
      })
      if (!response.ok) throw new Error(CONTACT_ERROR_MESSAGE)

      setSubmitted(true)
      setForm(initialState)
      setAgree(false)
      setAgreeError(false)
      setAgreeMarketing(false)
      setAgreeMarketingError(false)
    } catch {
      setSubmitted(false)
      setSubmitError(CONTACT_ERROR_MESSAGE)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Stack spacing={3}>
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
          gap: 2,
        }}
      >
        <TextField
          label="Имя"
          name="name"
          value={form.name}
          onChange={handleChange('name')}
          required
          fullWidth
        />
        <TextField
          label="Компания"
          name="company"
          value={form.company}
          onChange={handleChange('company')}
          fullWidth
        />
        <TextField
          label="Телефон"
          name="phone"
          value={form.phone}
          onChange={handleChange('phone')}
          required
          fullWidth
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange('email')}
          required
          fullWidth
        />
        <TextField
          label="Что нужно"
          name="message"
          value={form.message}
          onChange={handleChange('message')}
          fullWidth
          multiline
          minRows={3}
          sx={{ gridColumn: { md: '1 / -1' } }}
        />
        <Box sx={{ gridColumn: { md: '1 / -1' } }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={agree}
                onChange={(event) => {
                  setAgree(event.target.checked)
                  if (event.target.checked) setAgreeError(false)
                }}

                data-testid="contact-form-consent"
                slotProps={{
                  input: {
                    'aria-label': 'Согласие на обработку персональных данных',
                    'aria-required': true,
                  },
                }}
              />
            }
            label={
              <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
                Даю согласие на обработку своих персональных данных в соответствии с{' '}
                <Link
                  href="/terms/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'inherit', textDecoration: 'underline' }}
                >
                  политикой обработки персональных данных
                </Link>
              </Typography>
            }
            sx={{ alignItems: 'flex-start', m: 0, '& .MuiCheckbox-root': { pt: 0.25 } }}
          />
          {agreeError ? (
            <FormHelperText error sx={{ ml: 4 }}>
              Необходимо дать согласие на обработку персональных данных
            </FormHelperText>
          ) : null}
        </Box>
        <Box sx={{ gridColumn: { md: '1 / -1' } }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={agreeMarketing}
                onChange={(event) => {
                  setAgreeMarketing(event.target.checked)
                  if (event.target.checked) setAgreeMarketingError(false)
                }}

                data-testid="contact-form-marketing"
                slotProps={{
                  input: {
                    'aria-label': 'Согласие на получение информационных и рекламных рассылок',
                    'aria-required': true,
                  },
                }}
              />
            }
            label={
              <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
                Я согласен получать{' '}
                <Link
                  href="/terms/marketing-consent"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'inherit', textDecoration: 'underline' }}
                >
                  информационные и рекламные рассылки
                </Link>{' '}
                на указанный email
              </Typography>
            }
            sx={{ alignItems: 'flex-start', m: 0, '& .MuiCheckbox-root': { pt: 0.25 } }}
          />
          {agreeMarketingError ? (
            <FormHelperText error sx={{ ml: 4 }}>
              Необходимо согласиться на получение рассылок
            </FormHelperText>
          ) : null}
        </Box>
        <Box sx={{ gridColumn: { md: '1 / -1' }, pt: 0.5 }}>
          <Button type="submit" size="large" disabled={isSubmitting}>
            {isSubmitting ? 'Отправка...' : 'Отправить запрос'}
          </Button>
        </Box>
      </Box>

      {submitError ? <Alert severity="error">{submitError}</Alert> : null}
      {submitted ? (
        <Alert severity="success">Заявка отправлена. Мы свяжемся в течение дня.</Alert>
      ) : null}
    </Stack>
  )
}
