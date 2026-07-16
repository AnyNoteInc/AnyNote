// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  FormConditionGroup,
  FormInputConfig,
  FormPresentation,
  FormQuestion,
} from '@repo/domain/database/forms'

import { FormConditionEditor } from '@/components/database/forms/form-condition-editor'
import { FormInputConfigEditor } from '@/components/database/forms/form-input-config-editor'
import { FormPresentationEditor } from '@/components/database/forms/form-presentation-editor'

const questions: FormQuestion[] = [
  {
    id: 'q-text',
    sectionId: 'section',
    property: { kind: 'TITLE' },
    label: 'Имя',
    required: false,
    syncWithPropertyName: false,
    input: { kind: 'TEXT', multiline: false, maxLength: 200 },
  },
  {
    id: 'q-page-link',
    sectionId: 'section',
    property: { kind: 'PROPERTY', propertyId: 'page-link', propertyType: 'PAGE_LINK' },
    label: 'Страница',
    required: false,
    syncWithPropertyName: false,
    input: { kind: 'PAGE_LINK' },
  },
  {
    id: 'q-number',
    sectionId: 'section',
    property: { kind: 'PROPERTY', propertyId: 'number', propertyType: 'NUMBER' },
    label: 'Возраст',
    required: false,
    syncWithPropertyName: false,
    input: { kind: 'NUMBER' },
  },
]

afterEach(cleanup)

describe('form builder focused editors', () => {
  it('keeps condition creation behind the plan gate', async () => {
    const onChange = vi.fn()
    render(
      <FormConditionEditor
        value={undefined}
        availableQuestions={questions}
        disabled
        onChange={onChange}
      />,
    )

    const add = screen.getByRole('button', { name: 'Добавить условие' })
    expect(add).toBeDisabled()
    fireEvent.click(add)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('creates a condition and only offers operators valid for its question type', async () => {
    function Harness() {
      const [value, setValue] = useState<FormConditionGroup>()
      return (
        <FormConditionEditor value={value} availableQuestions={questions} onChange={setValue} />
      )
    }

    const actor = userEvent.setup()
    render(<Harness />)
    await actor.click(screen.getByRole('button', { name: 'Добавить условие' }))
    await actor.click(screen.getByLabelText('Вопрос условия'))
    await actor.click(screen.getByRole('option', { name: 'Возраст' }))
    await actor.click(screen.getByLabelText('Оператор условия'))

    expect(screen.getByRole('option', { name: 'Больше' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Содержит текст' })).not.toBeInTheDocument()
  })

  it('adds only persisted choice options and never invents synthetic ids', async () => {
    const changes: FormInputConfig[] = []
    function Harness() {
      const [input, setInput] = useState<FormInputConfig>({
        kind: 'MULTI_CHOICE',
        appearance: 'CHECKLIST',
        options: [{ id: 'first', label: 'Первый' }],
        maxSelections: 1,
      })
      return (
        <FormInputConfigEditor
          input={input}
          persistedOptions={[
            { id: 'first', label: 'Первый' },
            { id: 'second-persisted', label: 'Второй из базы', color: 'blue' },
          ]}
          onChange={(next) => {
            changes.push(next)
            setInput(next)
          }}
        />
      )
    }

    const actor = userEvent.setup()
    render(<Harness />)
    await actor.click(screen.getByRole('combobox', { name: 'Добавить сохранённый вариант' }))
    await actor.click(screen.getByRole('option', { name: 'Второй из базы' }))

    expect(screen.getAllByLabelText(/Название варианта/u)).toHaveLength(2)
    expect(screen.getByLabelText('Максимум выбранных')).toHaveValue(2)
    expect(changes.at(-1)).toMatchObject({
      options: [
        { id: 'first', label: 'Первый' },
        { id: 'second-persisted', label: 'Второй из базы', color: 'blue' },
      ],
    })
    await actor.click(screen.getByRole('button', { name: 'Поднять вариант 2' }))
    await actor.clear(screen.getAllByLabelText(/Название варианта/u)[0]!)
    await actor.type(screen.getAllByLabelText(/Название варианта/u)[0]!, 'Своя подпись')
    expect(changes.at(-1)).toMatchObject({
      options: [
        { id: 'second-persisted', label: 'Своя подпись', color: 'blue' },
        { id: 'first', label: 'Первый' },
      ],
    })
    expect(JSON.stringify(changes)).not.toContain('option-')
  })

  it('offers only empty operations for opaque page links', async () => {
    const value: FormConditionGroup = {
      kind: 'ALL',
      members: [{ kind: 'IS_NOT_EMPTY', questionId: 'q-page-link' }],
    }
    const actor = userEvent.setup()
    render(<FormConditionEditor value={value} availableQuestions={questions} onChange={vi.fn()} />)

    await actor.click(screen.getByLabelText('Оператор условия'))
    expect(screen.getByRole('option', { name: 'Не заполнено' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Заполнено' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Равно тексту' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Содержит текст' })).not.toBeInTheDocument()
  })

  it('edits presentation cover without taking ownership of branding', async () => {
    function Harness() {
      const [presentation, setPresentation] = useState<FormPresentation>({
        title: 'Форма',
        submitButtonText: 'Отправить',
        hideAnyNoteBranding: false,
      })
      return <FormPresentationEditor presentation={presentation} onChange={setPresentation} />
    }

    const actor = userEvent.setup()
    render(<Harness />)
    await actor.clear(screen.getByLabelText('Название формы'))
    await actor.type(screen.getByLabelText('Название формы'), 'Анкета')
    await actor.click(screen.getByLabelText('Тип обложки'))
    await actor.click(screen.getByRole('option', { name: 'Цвет' }))

    expect(screen.getByDisplayValue('Анкета')).toBeInTheDocument()
    expect(screen.getByLabelText('Значение обложки')).toBeInTheDocument()
    expect(screen.queryByLabelText(/брендинг/iu)).not.toBeInTheDocument()
  })
})
