// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChildEntryRow } from './ChildEntryRow'

describe('ChildEntryRow', () => {
  it('default child shows person fields', () => {
    render(<ChildEntryRow value={{ type: 'person', data: { sex: 'male', lifeStatus: 'alive', birthMode: 'date' } }} onChange={() => {}} />)
    expect(screen.getByLabelText('Имя')).toBeInTheDocument()
  })

  it('switching to "Выкидыш" emits {type:"miscarriage"}', async () => {
    const onChange = vi.fn()
    render(<ChildEntryRow value={{ type: 'person', data: { sex: 'male', lifeStatus: 'alive', birthMode: 'date' } }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Выкидыш' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'miscarriage' }))
  })

  it('readOnly mode shows label instead of full PersonDataForm', () => {
    const value = { type: 'person' as const, data: { sex: 'female' as const, lifeStatus: 'alive' as const, birthMode: 'date' as const, firstName: 'Лиза', lastName: 'Иванова' } }
    render(<ChildEntryRow value={value} onChange={() => {}} readOnly />)
    expect(screen.getByText(/Лиза/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Имя')).not.toBeInTheDocument()
  })
})
