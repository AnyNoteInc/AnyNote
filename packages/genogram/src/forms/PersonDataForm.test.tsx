// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PersonDataForm } from './PersonDataForm'

describe('PersonDataForm — basic', () => {
  it('shows birthDate field by default', () => {
    render(
      <PersonDataForm
        initial={{ sex: 'male' }}
        context={{ kind: 'edit-data' }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByLabelText('Месяц')).toBeInTheDocument()
  })

  it('switches to ApproximateAgeInput when "Приблизительный возраст" toggled', async () => {
    render(
      <PersonDataForm
        initial={{ sex: 'male' }}
        context={{ kind: 'edit-data' }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Приблизительный возраст' }))
    expect(screen.queryByLabelText('Месяц')).not.toBeInTheDocument()
  })

  it('shows deathDate label and tragically when "Умер" selected', async () => {
    render(
      <PersonDataForm
        initial={{ sex: 'male' }}
        context={{ kind: 'edit-data' }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Умер' }))
    expect(screen.getByText('Дата смерти')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Трагически' })).toBeInTheDocument()
  })

  it('hides death fields when not "Умер"', () => {
    render(
      <PersonDataForm
        initial={{ sex: 'male' }}
        context={{ kind: 'edit-data' }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.queryByRole('checkbox', { name: 'Трагически' })).not.toBeInTheDocument()
  })

  it('Save button calls onSubmit with full draft', async () => {
    const onSubmit = vi.fn()
    render(
      <PersonDataForm
        initial={{ sex: 'male' }}
        context={{ kind: 'edit-data' }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )
    await userEvent.type(screen.getByLabelText('Имя'), 'Иван')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Иван',
        sex: 'male',
        birthMode: 'date',
        lifeStatus: 'unknown',
      }),
    )
  })
})

describe('PersonDataForm — conditional ordinal fields', () => {
  it('shows "Порядковый номер партнёра" (above lastName) for add-partner context, empty by default', () => {
    render(
      <PersonDataForm
        initial={{ sex: 'male' }}
        context={{ kind: 'add-partner', existingPartnersOfBase: 1 }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    const field = screen.getByLabelText('Порядковый номер партнёра') as HTMLInputElement
    expect(field).toBeInTheDocument()
    expect(field.value).toBe('')
  })

  it('shows "Порядковый номер партнёра" pre-filled when editing a partner', () => {
    render(
      <PersonDataForm
        initial={{ sex: 'female', partnerOrder: 2 }}
        context={{ kind: 'edit-data', isPartner: true, totalPartnersOfBase: 3 }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    const field = screen.getByLabelText('Порядковый номер партнёра') as HTMLInputElement
    expect(field.value).toBe('2')
  })

  it('shows "Порядковый номер ребёнка" only when editing a child', () => {
    render(
      <PersonDataForm
        initial={{ sex: 'female' }}
        context={{ kind: 'edit-data', isChild: true, childOrder: 1, siblingsCount: 3 }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByLabelText('Порядковый номер ребёнка')).toBeInTheDocument()
  })

  it('hides all ordinal fields when context=edit-data with no partner/child flag', () => {
    render(
      <PersonDataForm
        initial={{ sex: 'male' }}
        context={{ kind: 'edit-data' }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.queryByLabelText('Порядковый номер партнёра')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Порядковый номер ребёнка')).not.toBeInTheDocument()
    // The legacy "Укажите количество партнёров" field has been removed entirely.
    expect(screen.queryByLabelText('Укажите количество партнёров')).not.toBeInTheDocument()
  })

  it('submit omits partnerOrder when add-partner field is left empty (caller falls back to append)', async () => {
    const onSubmit = vi.fn()
    render(
      <PersonDataForm
        initial={{ sex: 'female' }}
        context={{ kind: 'add-partner', existingPartnersOfBase: 1 }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    const arg = onSubmit.mock.calls[0]![0] as { partnerOrder?: number }
    expect(arg.partnerOrder).toBeUndefined()
  })

  it('submit emits partnerOrder typed into add-partner field', async () => {
    const onSubmit = vi.fn()
    render(
      <PersonDataForm
        initial={{ sex: 'female' }}
        context={{ kind: 'add-partner', existingPartnersOfBase: 1 }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )
    await userEvent.type(screen.getByLabelText('Порядковый номер партнёра'), '3')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ partnerOrder: 3 }))
  })
})

describe('PersonDataForm — onChange callback', () => {
  it('fires onChange on every field change (per-keystroke)', async () => {
    const onChange = vi.fn()
    render(
      <PersonDataForm
        initial={{ sex: 'male' }}
        context={{ kind: 'edit-data' }}
        onSubmit={() => {}}
        onChange={onChange}
        onCancel={() => {}}
        embedded
      />,
    )
    await userEvent.type(screen.getByLabelText('Имя'), 'А')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'А' }))
  })
})
