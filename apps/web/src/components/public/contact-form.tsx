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

export function ContactForm() {
  const [form, setForm] = useState<ContactFormState>(initialState)
  const [agree, setAgree] = useState(false)
  const [agreeError, setAgreeError] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleChange =
    (field: keyof ContactFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [field]: event.target.value }))
    }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!agree) {
      setAgreeError(true)
      return
    }
    console.log('Любые заметки contact request', form)
    setSubmitted(true)
    setForm(initialState)
    setAgree(false)
    setAgreeError(false)
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
                inputProps={{
                  'aria-label': 'Согласие на обработку персональных данных',
                  'aria-required': true,
                }}
                data-testid="contact-form-consent"
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
        <Box sx={{ gridColumn: { md: '1 / -1' }, pt: 0.5 }}>
          <Button type="submit" size="large">
            Отправить запрос
          </Button>
        </Box>
      </Box>

      {submitted ? (
        <Alert severity="success">Заявка отправлена. Мы свяжемся в течение дня.</Alert>
      ) : null}
    </Stack>
  )
}
