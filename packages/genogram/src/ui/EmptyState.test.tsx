// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('shows CTA in editor mode', () => {
    render(<EmptyState mode="editor" onCreate={() => {}} />)
    expect(screen.getByRole('button', { name: 'Создать генограмму' })).toBeInTheDocument()
  })

  it('hides CTA in readonly mode', () => {
    render(<EmptyState mode="readonly" onCreate={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Создать генограмму' })).not.toBeInTheDocument()
  })

  it('emits onCreate when CTA clicked', async () => {
    const onCreate = vi.fn()
    render(<EmptyState mode="editor" onCreate={onCreate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Создать генограмму' }))
    expect(onCreate).toHaveBeenCalled()
  })
})
