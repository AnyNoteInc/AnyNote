// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PartialDateInput } from './PartialDateInput'

describe('PartialDateInput', () => {
  it('renders three independent fields', () => {
    render(<PartialDateInput value={{}} onChange={() => {}} />)
    expect(screen.getByLabelText('День')).toBeInTheDocument()
    expect(screen.getByLabelText('Месяц')).toBeInTheDocument()
    expect(screen.getByLabelText('Год')).toBeInTheDocument()
  })

  it('emits onChange when day changes', async () => {
    const onChange = vi.fn()
    render(<PartialDateInput value={{}} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('День'), '15')
    expect(onChange).toHaveBeenLastCalledWith({ day: 15 })
  })

  it('clears field on empty input', async () => {
    const onChange = vi.fn()
    render(<PartialDateInput value={{ day: 15 }} onChange={onChange} />)
    await userEvent.clear(screen.getByLabelText('День'))
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('preserves other fields on partial update', async () => {
    const onChange = vi.fn()
    render(<PartialDateInput value={{ year: 2020 }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('День'), '1')
    expect(onChange).toHaveBeenLastCalledWith({ day: 1, year: 2020 })
  })
})
