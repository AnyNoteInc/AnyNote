import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm, type SubmitHandler } from 'react-hook-form'

import {
  ConsentsCheckboxes,
  type ConsentsCheckboxesValues,
} from '../src/widgets/auth/consents-checkboxes'

const URLS = {
  userAgreement: '/terms/user-agreement',
  privacyPolicy: '/terms/privacy-policy',
  piiConsent: '/terms/consent',
  publicOffer: '/terms/public-offer',
  marketingConsent: '/terms/marketing-consent',
}

function Harness({ onSubmit }: { onSubmit: SubmitHandler<ConsentsCheckboxesValues> }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ConsentsCheckboxesValues>({
    defaultValues: { agreedToTerms: false, agreedToMarketing: false },
  })
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <ConsentsCheckboxes register={register} errors={errors} urls={URLS} />
      <button type="submit">submit</button>
    </form>
  )
}

describe('ConsentsCheckboxes', () => {
  it('renders both checkboxes with correct testids', () => {
    render(<Harness onSubmit={() => {}} />)
    expect(screen.getByTestId('register-terms-checkbox')).toBeInTheDocument()
    expect(screen.getByTestId('register-marketing-checkbox')).toBeInTheDocument()
  })

  it('renders 4 required document links', () => {
    render(<Harness onSubmit={() => {}} />)
    expect(screen.getByRole('link', { name: /пользовательское соглашение/i })).toHaveAttribute(
      'href',
      '/terms/user-agreement',
    )
    expect(
      screen.getByRole('link', { name: /политику обработки персональных данных/i }),
    ).toHaveAttribute('href', '/terms/privacy-policy')
    expect(
      screen.getByRole('link', { name: /согласие на обработку персональных данных/i }),
    ).toHaveAttribute('href', '/terms/consent')
    expect(screen.getByRole('link', { name: /оферту на оказание услуг/i })).toHaveAttribute(
      'href',
      '/terms/public-offer',
    )
  })

  it('renders the marketing link', () => {
    render(<Harness onSubmit={() => {}} />)
    expect(
      screen.getByRole('link', { name: /информационные и рекламные рассылки/i }),
    ).toHaveAttribute('href', '/terms/marketing-consent')
  })

  it('blocks submit when required checkbox is unchecked', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('allows submit when required is checked, even if marketing is not', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await userEvent.click(screen.getByTestId('register-terms-checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(onSubmit).toHaveBeenCalledOnce()
    const values = onSubmit.mock.calls[0][0] as ConsentsCheckboxesValues
    expect(values.agreedToTerms).toBe(true)
    expect(values.agreedToMarketing).toBe(false)
  })
})
