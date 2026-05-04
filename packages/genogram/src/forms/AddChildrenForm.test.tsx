// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddChildrenForm } from './AddChildrenForm'

describe('AddChildrenForm', () => {
  it('renders empty existing — count rows = initialCount', () => {
    render(
      <AddChildrenForm
        existingChildren={[]}
        initialCount={2}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    // Each row uses ChildEntryRow which has 3 toggle buttons (Ребёнок/Выкидыш/Аборт).
    // 2 rows = 6 toggle buttons.
    expect(screen.getAllByRole('button', { name: 'Ребёнок' }).length).toBe(2)
  })

  it('renders existing children first as readOnly rows with their label', () => {
    const existing = [
      {
        entry: { kind: 'person' as const, personId: 'p1' as never },
        label: 'Иванов И.',
      },
    ]
    render(
      <AddChildrenForm
        existingChildren={existing}
        initialCount={2}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('Иванов И.')).toBeInTheDocument()
  })

  it('submit emits empty new entries when count = K (existing only)', async () => {
    const onSubmit = vi.fn()
    const existing = [
      {
        entry: { kind: 'person' as const, personId: 'p1' as never },
        label: 'Лиза',
      },
    ]
    render(
      <AddChildrenForm
        existingChildren={existing}
        initialCount={1}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onSubmit).toHaveBeenCalledWith([], undefined)
  })

  it('cannot set count below K (existing children count)', async () => {
    const existing = [
      { entry: { kind: 'person' as const, personId: 'p1' as never }, label: 'A' },
      { entry: { kind: 'person' as const, personId: 'p2' as never }, label: 'B' },
    ]
    render(
      <AddChildrenForm
        existingChildren={existing}
        initialCount={2}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    const countInput = screen.getByLabelText('Укажите количество детей') as HTMLInputElement
    expect(countInput.min).toBe('2')
  })

  it('cancel emits onCancel', async () => {
    const onCancel = vi.fn()
    render(
      <AddChildrenForm
        existingChildren={[]}
        initialCount={1}
        onSubmit={() => {}}
        onCancel={onCancel}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
