// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SexToggle } from './SexToggle'

describe('SexToggle', () => {
  it('renders both options and highlights value', () => {
    render(<SexToggle value="male" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Мужской' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Женский' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onChange when other option clicked', async () => {
    const onChange = vi.fn()
    render(<SexToggle value="male" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Женский' }))
    expect(onChange).toHaveBeenCalledWith('female')
  })

  it('does not call onChange when current option clicked', async () => {
    const onChange = vi.fn()
    render(<SexToggle value="male" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Мужской' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
