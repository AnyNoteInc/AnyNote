// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PersonDataForm } from './PersonDataForm'

describe('PersonDataForm — basic', () => {
  it('shows birthDate field by default', () => {
    render(<PersonDataForm initial={{ sex: 'male' }} context={{ kind: 'edit-data' }} onSubmit={() => {}} onCancel={() => {}} />)
    expect(screen.getByLabelText('Месяц')).toBeInTheDocument()
  })

  it('switches to ApproximateAgeInput when "Приблизительный возраст" toggled', async () => {
    render(<PersonDataForm initial={{ sex: 'male' }} context={{ kind: 'edit-data' }} onSubmit={() => {}} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Приблизительный возраст' }))
    expect(screen.queryByLabelText('Месяц')).not.toBeInTheDocument()
  })

  it('shows deathDate label and tragically when "Умер" selected', async () => {
    render(<PersonDataForm initial={{ sex: 'male' }} context={{ kind: 'edit-data' }} onSubmit={() => {}} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Умер' }))
    expect(screen.getByText('Дата смерти')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Трагически' })).toBeInTheDocument()
  })

  it('hides death fields when not "Умер"', () => {
    render(<PersonDataForm initial={{ sex: 'male' }} context={{ kind: 'edit-data' }} onSubmit={() => {}} onCancel={() => {}} />)
    expect(screen.queryByRole('checkbox', { name: 'Трагически' })).not.toBeInTheDocument()
  })

  it('Save button calls onSubmit with full draft', async () => {
    const onSubmit = vi.fn()
    render(<PersonDataForm initial={{ sex: 'male' }} context={{ kind: 'edit-data' }} onSubmit={onSubmit} onCancel={() => {}} />)
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

describe('PersonDataForm — conditional ordinal fields', () => {
  it('shows "Укажите количество партнёров" only when context=add-partner', () => {
    const { rerender } = render(<PersonDataForm
      initial={{ sex: 'male' }}
      context={{ kind: 'add-partner', existingPartnersOfBase: 1 }}
      onSubmit={() => {}}
      onCancel={() => {}}
    />)
    expect(screen.getByLabelText('Укажите количество партнёров')).toBeInTheDocument()

    rerender(<PersonDataForm
      initial={{ sex: 'male' }}
      context={{ kind: 'edit-data' }}
      onSubmit={() => {}}
      onCancel={() => {}}
    />)
    expect(screen.queryByLabelText('Укажите количество партнёров')).not.toBeInTheDocument()
  })

  it('shows "Порядковый номер партнёра" only when editing partner of base with >1 partners', () => {
    render(<PersonDataForm
      initial={{ sex: 'female' }}
      context={{ kind: 'edit-data', isPartnerOfMultiBase: true, totalPartnersOfBase: 2 }}
      onSubmit={() => {}}
      onCancel={() => {}}
    />)
    expect(screen.getByLabelText('Порядковый номер партнёра')).toBeInTheDocument()
  })

  it('shows "Порядковый номер ребёнка" only when editing a child', () => {
    render(<PersonDataForm
      initial={{ sex: 'female' }}
      context={{ kind: 'edit-data', isChild: true, childOrder: 1, siblingsCount: 3 }}
      onSubmit={() => {}}
      onCancel={() => {}}
    />)
    expect(screen.getByLabelText('Порядковый номер ребёнка')).toBeInTheDocument()
  })

  it('hides all ordinal fields when context=edit-data with no flags', () => {
    render(<PersonDataForm
      initial={{ sex: 'male' }}
      context={{ kind: 'edit-data' }}
      onSubmit={() => {}}
      onCancel={() => {}}
    />)
    expect(screen.queryByLabelText('Укажите количество партнёров')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Порядковый номер партнёра')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Порядковый номер ребёнка')).not.toBeInTheDocument()
  })

  it('submit emits partnerCount when in add-partner context', async () => {
    const onSubmit = vi.fn()
    render(<PersonDataForm
      initial={{ sex: 'female' }}
      context={{ kind: 'add-partner', existingPartnersOfBase: 1 }}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />)
    // partnerCount default = existingPartnersOfBase + 1 = 2
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ partnerCount: 2 }))
  })
})
