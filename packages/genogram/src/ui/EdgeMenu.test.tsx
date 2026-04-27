// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EdgeMenu } from './EdgeMenu'

describe('EdgeMenu', () => {
  const anchor = document.createElement('div')

  it('shows two items', () => {
    render(<EdgeMenu open anchorEl={anchor} onClose={() => {}} onAction={() => {}} />)
    expect(screen.getByText('Редактировать связь')).toBeInTheDocument()
    expect(screen.getByText('Добавить детей')).toBeInTheDocument()
  })

  it('emits action on click', async () => {
    const onAction = vi.fn()
    render(<EdgeMenu open anchorEl={anchor} onClose={() => {}} onAction={onAction} />)
    await userEvent.click(screen.getByText('Добавить детей'))
    expect(onAction).toHaveBeenCalledWith('add-children')
  })
})
