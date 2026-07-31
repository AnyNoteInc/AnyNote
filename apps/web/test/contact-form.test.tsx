// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mutateAsyncMock } = vi.hoisted(() => ({
  mutateAsyncMock: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    contact: {
      submit: {
        useMutation: () => ({ mutateAsync: mutateAsyncMock }),
      },
    },
  },
}))

import { ContactForm } from '@/components/public/contact-form'

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
  mutateAsyncMock.mockReset().mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
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

    expect(mutateAsyncMock).not.toHaveBeenCalled()
    expect(screen.getByText('Необходимо дать согласие на обработку персональных данных')).toBeVisible()
    expect(screen.getByText('Необходимо согласиться на получение рассылок')).toBeVisible()
  })

  it('posts the completed form and shows the success message', async () => {
    const user = userEvent.setup()
    render(<ContactForm />)
    await fillAndConsent(user)
    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(mutateAsyncMock).toHaveBeenCalledWith({
      name: 'Ирина',
      company: 'Acme',
      email: 'irina@example.com',
      phone: '+7 900 000-00-00',
      message: 'Нужен SSO',
      consentPersonalData: true,
      consentMarketing: true,
    })
    expect(await screen.findByText('Заявка отправлена. Мы свяжемся в течение дня.')).toBeVisible()
    expect(screen.getByLabelText(/^Имя/)).toHaveValue('')
  })

  it('disables the submit button while the request is pending', async () => {
    let resolveRequest!: (result: { ok: true }) => void
    mutateAsyncMock.mockImplementationOnce(
      () => new Promise<{ ok: true }>((resolve) => {
        resolveRequest = resolve
      }),
    )
    const user = userEvent.setup()
    render(<ContactForm />)
    await fillAndConsent(user)
    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(screen.getByRole('button', { name: 'Отправка...' })).toBeDisabled()
    resolveRequest({ ok: true })
    expect(await screen.findByText('Заявка отправлена. Мы свяжемся в течение дня.')).toBeVisible()
  })

  it('shows an error and preserves the entered values when the request fails', async () => {
    mutateAsyncMock.mockRejectedValueOnce(
      new Error('Не удалось отправить заявку. Попробуйте ещё раз.'),
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
