// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3'
import { describe, expect, it } from 'vitest'

import { RecaptchaProvider } from '@/components/recaptcha-provider'

function RecaptchaProbe() {
  const { executeRecaptcha } = useGoogleReCaptcha()
  return <div>executor: {executeRecaptcha ? 'ready' : 'disabled'}</div>
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
})
