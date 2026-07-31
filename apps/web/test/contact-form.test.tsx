// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ContactForm } from '@/components/public/contact-form'

const fetchMock = vi.fn<typeof fetch>()

function successResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function fillAndConsent(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Имя/), 'Ирина')
  await user.type(screen.getByLabelText(/^Компания/), 'Acme')
  await user.type(screen.getByLabelText(/^Телефон/), '+7 900 000-00-00')
  await user.type(screen.getByLabelText(/^Email/), 'irina@example.com')
  await user.type(screen.getByLabelText(/^Что нужно/), 'Нужен SSO')
  await user.click(screen.getByTestId('contact-form-consent'))
  await user.click(screen.getByTestId('contact-form-marketing'))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ContactForm', () => {
  it('renders all five fields', () => {
    render(<ContactForm />)
    expect(screen.getByLabelText(/^Имя/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Компания/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Email/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Телефон/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Что нужно/)).toBeInTheDocument()
  })

  it('does not submit when the required consents are missing', async () => {
    const user = userEvent.setup()
    render(<ContactForm />)
    await user.type(screen.getByLabelText(/^Имя/), 'Ирина')
    await user.type(screen.getByLabelText(/^Телефон/), '+7 900 000-00-00')
    await user.type(screen.getByLabelText(/^Email/), 'irina@example.com')
    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('Необходимо дать согласие на обработку персональных данных')).toBeVisible()
    expect(screen.getByText('Необходимо согласиться на получение рассылок')).toBeVisible()
  })

  it('posts the completed form and shows the success message', async () => {
    fetchMock.mockResolvedValueOnce(successResponse())
    const user = userEvent.setup()
    render(<ContactForm />)
    await fillAndConsent(user)
    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Ирина',
        company: 'Acme',
        email: 'irina@example.com',
        phone: '+7 900 000-00-00',
        message: 'Нужен SSO',
        consentPersonalData: true,
        consentMarketing: true,
      }),
    })
    expect(await screen.findByText('Заявка отправлена. Мы свяжемся в течение дня.')).toBeVisible()
    expect(screen.getByLabelText(/^Имя/)).toHaveValue('')
  })

  it('disables the submit button while the request is pending', async () => {
    let resolveRequest!: (response: Response) => void
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => {
        resolveRequest = resolve
      }),
    )
    const user = userEvent.setup()
    render(<ContactForm />)
    await fillAndConsent(user)
    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(screen.getByRole('button', { name: 'Отправка...' })).toBeDisabled()
    resolveRequest(successResponse())
    expect(await screen.findByText('Заявка отправлена. Мы свяжемся в течение дня.')).toBeVisible()
  })

  it('shows an error and preserves the entered values when the request fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Не удалось отправить заявку. Попробуйте ещё раз.' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const user = userEvent.setup()
    render(<ContactForm />)
    await fillAndConsent(user)
    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(await screen.findByText('Не удалось отправить заявку. Попробуйте ещё раз.')).toBeVisible()
    expect(screen.getByLabelText(/^Имя/)).toHaveValue('Ирина')
    expect(screen.getByLabelText('Согласие на обработку персональных данных')).toBeChecked()
  })
})
