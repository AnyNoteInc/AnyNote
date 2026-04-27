// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LifeStatusToggle } from './LifeStatusToggle'

describe('LifeStatusToggle', () => {
  it('renders three options', () => {
    render(<LifeStatusToggle value="alive" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Жив' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Умер' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Неизвестно' })).toBeInTheDocument()
  })

  it('calls onChange', async () => {
    const onChange = vi.fn()
    render(<LifeStatusToggle value="alive" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Умер' }))
    expect(onChange).toHaveBeenCalledWith('deceased')
  })
})
