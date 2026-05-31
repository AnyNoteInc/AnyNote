import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChatConfirmInline } from '../src/components/chat/chat-confirm-inline'

function renderInline(overrides: Partial<Parameters<typeof ChatConfirmInline>[0]> = {}) {
  const onResolve = vi.fn()
  render(
    <ChatConfirmInline
      argsPreview={{ title: 'Smoke', type: 'TEXT' }}
      confirmationId="c1"
      onResolve={onResolve}
      summary="Создать страницу «Smoke»"
      tool="anynote__createPage"
      {...overrides}
    />,
  )
  return { onResolve }
}

describe('ChatConfirmInline', () => {
  it('renders the summary and the args preview', () => {
    renderInline()
    expect(screen.getByText('Создать страницу «Smoke»')).toBeTruthy()
    expect(screen.getByText(/"title": "Smoke"/)).toBeTruthy()
  })

  it('renders Разрешить and Отклонить by default (no Разрешать в этом чате)', () => {
    renderInline()
    expect(screen.getByRole('button', { name: /разрешить/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /отклонить/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /разрешать в этом чате/i })).toBeNull()
  })

  it('calls onResolve with "allow" when Разрешить is clicked', async () => {
    const user = userEvent.setup()
    const { onResolve } = renderInline()
    await user.click(screen.getByRole('button', { name: /разрешить/i }))
    expect(onResolve).toHaveBeenCalledWith('c1', 'allow')
  })

  it('calls onResolve with "deny" when Отклонить is clicked', async () => {
    const user = userEvent.setup()
    const { onResolve } = renderInline()
    await user.click(screen.getByRole('button', { name: /отклонить/i }))
    expect(onResolve).toHaveBeenCalledWith('c1', 'deny')
  })

  it('renders Разрешать в этом чате and fires onAllowAll with the tool name', async () => {
    const user = userEvent.setup()
    const onAllowAll = vi.fn()
    renderInline({ onAllowAll })
    await user.click(screen.getByRole('button', { name: /разрешать в этом чате/i }))
    expect(onAllowAll).toHaveBeenCalledWith('anynote__createPage')
  })

  it('omits the args preview block when argsPreview is undefined', () => {
    renderInline({ argsPreview: undefined })
    expect(screen.queryByText(/"title": "Smoke"/)).toBeNull()
    expect(screen.getByText('Создать страницу «Smoke»')).toBeTruthy()
  })

  it('caps the panel width so it does not stretch the full column', () => {
    renderInline()
    const panel = screen.getByTestId('chat-confirm-inline')
    expect(getComputedStyle(panel).maxWidth).toBe('440px')
  })
})
