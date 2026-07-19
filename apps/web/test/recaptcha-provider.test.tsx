// @vitest-environment jsdom
import { useState } from 'react'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3'
import { describe, expect, it } from 'vitest'

import { RecaptchaProvider } from '@/components/recaptcha-provider'

function RecaptchaProbe() {
  const { executeRecaptcha } = useGoogleReCaptcha()
  const [token, setToken] = useState('')
  return (
    <div>
      <span>executor: {executeRecaptcha ? 'ready' : 'disabled'}</span>
      {executeRecaptcha ? (
        <button type="button" onClick={() => void executeRecaptcha('form_submit').then(setToken)}>
          execute
        </button>
      ) : null}
      <span>token: {token}</span>
    </div>
  )
}

describe('RecaptchaProvider', () => {
  it('provides a disabled context when no site key is configured', () => {
    render(
      <RecaptchaProvider siteKey="">
        <RecaptchaProbe />
      </RecaptchaProvider>,
    )

    expect(screen.getByText('executor: disabled')).toBeInTheDocument()
  })

  it('provides a deterministic executor only when the test seam is explicit', async () => {
    const actor = userEvent.setup()
    render(
      <RecaptchaProvider siteKey="" testMode>
        <RecaptchaProbe />
      </RecaptchaProvider>,
    )

    expect(screen.getByText('executor: ready')).toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: 'execute' }))
    expect(await screen.findByText('token: playwright-form-captcha')).toBeInTheDocument()
  })
})
