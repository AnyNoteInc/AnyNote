'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Alert, Box, Button, Stack, TextField } from '@repo/ui/components'

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
  const [submitted, setSubmitted] = useState(false)

  const handleChange =
    (field: keyof ContactFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [field]: event.target.value }))
    }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    console.log('Любые заметки contact request', form)
    setSubmitted(true)
    setForm(initialState)
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
