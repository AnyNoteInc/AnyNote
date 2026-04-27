// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PersonDataForm } from './PersonDataForm'

describe('PersonDataForm — basic', () => {
  it('shows birthDate field by default', () => {
    render(<PersonDataForm initial={{ sex: 'male' }} onSubmit={() => {}} onCancel={() => {}} />)
    expect(screen.getByLabelText('Месяц')).toBeInTheDocument()
  })

  it('switches to ApproximateAgeInput when "Приблизительный возраст" toggled', async () => {
    render(<PersonDataForm initial={{ sex: 'male' }} onSubmit={() => {}} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Приблизительный возраст' }))
    expect(screen.queryByLabelText('Месяц')).not.toBeInTheDocument()
  })

  it('shows deathDate label and tragically when "Умер" selected', async () => {
    render(<PersonDataForm initial={{ sex: 'male' }} onSubmit={() => {}} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Умер' }))
    expect(screen.getByText('Дата смерти')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Трагически' })).toBeInTheDocument()
  })

  it('hides death fields when not "Умер"', () => {
    render(<PersonDataForm initial={{ sex: 'male' }} onSubmit={() => {}} onCancel={() => {}} />)
    expect(screen.queryByRole('checkbox', { name: 'Трагически' })).not.toBeInTheDocument()
  })

  it('Save button calls onSubmit with full draft', async () => {
    const onSubmit = vi.fn()
    render(<PersonDataForm initial={{ sex: 'male' }} onSubmit={onSubmit} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText('Имя'), 'Иван')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      firstName: 'Иван',
      sex: 'male',
      birthMode: 'date',
      lifeStatus: 'unknown',
    }))
  })
})
