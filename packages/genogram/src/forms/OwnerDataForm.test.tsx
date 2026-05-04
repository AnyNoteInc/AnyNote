// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OwnerDataForm } from './OwnerDataForm'

describe('OwnerDataForm', () => {
  it('mode=create — submit emits owner draft with sex', async () => {
    const onSubmit = vi.fn()
    render(
      <OwnerDataForm
        mode="create"
        initial={{ sex: 'male' }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )

    await userEvent.type(screen.getByLabelText('Фамилия'), 'Иванов')
    await userEvent.type(screen.getByLabelText('Имя'), 'Иван')
    await userEvent.click(screen.getByRole('button', { name: 'Создать генограмму' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        lastName: 'Иванов',
        firstName: 'Иван',
        sex: 'male',
      }),
    )
  })

  it('mode=edit — submit emits patch', async () => {
    const onSubmit = vi.fn()
    render(
      <OwnerDataForm
        mode="edit"
        initial={{ firstName: 'Иван', sex: 'male' }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onSubmit).toHaveBeenCalled()
  })

  it('Cancel button calls onCancel', async () => {
    const onCancel = vi.fn()
    render(
      <OwnerDataForm
        mode="create"
        initial={{ sex: 'male' }}
        onSubmit={() => {}}
        onCancel={onCancel}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
