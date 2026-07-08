// @vitest-environment jsdom
import * as React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dateTimePickerProps: [] as Array<Record<string, unknown>>,
  members: [
    {
      id: 'member-1',
      userId: 'user-1',
      role: 'OWNER',
      user: {
        id: 'user-1',
        firstName: 'Иван',
        lastName: 'Петров',
        email: 'ivan@example.com',
        image: null,
      },
    },
    {
      id: 'member-2',
      userId: 'user-2',
      role: 'EDITOR',
      user: {
        id: 'user-2',
        firstName: 'Анна',
        lastName: 'Смирнова',
        email: 'anna@example.com',
        image: null,
      },
    },
  ],
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    workspace: {
      listMembers: {
        useQuery: () => ({ data: mocks.members, isLoading: false }),
      },
    },
  },
}))

vi.mock('@repo/ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/ui/components')>()
  return {
    ...actual,
    DateTimePicker: (props: Record<string, unknown>) => {
      mocks.dateTimePickerProps.push(props)
      return React.createElement(actual.TextField, {
        label: String(props.label ?? ''),
        disabled: Boolean(props.disabled),
        size: 'small',
        fullWidth: true,
        value: '',
        inputProps: { 'data-testid': 'deadline-input', readOnly: true },
      })
    },
  }
})

import { ReminderPopover, type ReminderFormValue } from '@/components/page/reminder-popover'

const initial: ReminderFormValue = {
  id: 'reminder-1',
  dueAt: '2030-06-15T11:00:00.000Z',
  offsets: [0],
  audience: 'ME',
  label: null,
  recipients: [],
  doneAt: null,
}

function renderReminderPopover({
  mode = 'create',
  initialValue = initial,
  onSave = vi.fn<(value: ReminderFormValue) => void>(),
}: {
  mode?: 'create' | 'edit'
  initialValue?: ReminderFormValue
  onSave?: (value: ReminderFormValue) => void
} = {}) {
  const anchorEl = document.createElement('button')
  document.body.appendChild(anchorEl)

  render(
    <ReminderPopover
      open
      anchorEl={anchorEl}
      mode={mode}
      initial={initialValue}
      workspaceId="00000000-0000-4000-8000-000000000001"
      onClose={vi.fn()}
      onSave={onSave}
      onDelete={vi.fn()}
    />,
  )

  return { onSave }
}

describe('ReminderPopover', () => {
  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
    mocks.dateTimePickerProps.length = 0
  })

  it('keeps only required fields on the main tab and localizes DateTimePicker actions', async () => {
    const actor = userEvent.setup()
    const onSave = vi.fn<(value: ReminderFormValue) => void>()

    renderReminderPopover({ onSave })

    expect(screen.getByRole('tab', { name: 'Основное' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Лейбл')).toBeInTheDocument()
    expect(screen.getByLabelText('Дедлайн')).toBeInTheDocument()
    expect(screen.queryByText('В момент истечения')).not.toBeInTheDocument()
    expect(screen.queryByText('Только я')).not.toBeInTheDocument()

    expect(mocks.dateTimePickerProps.at(-1)?.localeText).toMatchObject({
      cancelButtonLabel: 'Отмена',
      okButtonLabel: 'Применить',
    })

    await actor.click(screen.getByRole('button', { name: 'Создать' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ offsets: [0], audience: 'ME' }))
  })

  it('uses compact tabs and shows selected list recipients as name and email chips', async () => {
    const actor = userEvent.setup()

    renderReminderPopover()

    await actor.click(screen.getByRole('tab', { name: 'Заранее' }))
    expect(screen.getByLabelText('В момент истечения')).toBeChecked()

    await actor.click(screen.getByRole('tab', { name: 'Для кого' }))
    expect(screen.getByLabelText('Только я')).toBeChecked()

    await actor.click(screen.getByLabelText('Выбрать участников'))
    await actor.click(screen.getByLabelText('Участники'))

    const listbox = screen.getByRole('listbox')
    await actor.click(within(listbox).getByText('Иван Петров'))
    await actor.click(within(listbox).getByText('Анна Смирнова'))
    await actor.keyboard('{Escape}')

    expect(screen.getByText('Иван Петров · ivan@example.com')).toBeInTheDocument()
    expect(screen.getByText('Анна Смирнова · anna@example.com')).toBeInTheDocument()
  })

  it('moves postpone controls to the main edit tab and replaces delete with a done toggle button', async () => {
    const actor = userEvent.setup()
    const onSave = vi.fn<(value: ReminderFormValue) => void>()

    renderReminderPopover({ mode: 'edit', onSave })

    expect(screen.getByRole('tab', { name: 'Основное' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Перенести:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+1 день' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Выполнено' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ doneAt: expect.any(String) }))
  })

  it('highlights the done toggle and switches it to not done when reminder is completed', async () => {
    const actor = userEvent.setup()
    const onSave = vi.fn<(value: ReminderFormValue) => void>()

    renderReminderPopover({
      mode: 'edit',
      initialValue: { ...initial, doneAt: '2030-06-15T12:00:00.000Z' },
      onSave,
    })

    const undoDone = screen.getByRole('button', { name: 'Не выполнено' })
    expect(undoDone).toHaveClass('MuiButton-containedWarning')

    await actor.click(undoDone)

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ doneAt: null }))
  })
})
