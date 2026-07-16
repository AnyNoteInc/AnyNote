// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormVersionDocument } from '@repo/domain/database/forms'

const mocks = vi.hoisted(() => ({
  createProperty: vi.fn(),
  onAdd: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    database: {
      createProperty: {
        useMutation: () => ({ mutateAsync: mocks.createProperty, isPending: false }),
      },
      listSources: { useQuery: () => ({ data: [] }) },
    },
  },
}))

import { FormPropertyPicker } from '@/components/database/forms/form-property-picker'

const document: FormVersionDocument = {
  schemaVersion: 1,
  firstSectionId: 'section-1',
  presentation: { title: 'Заявка', submitButtonText: 'Отправить', hideAnyNoteBranding: false },
  sections: [{ id: 'section-1', title: 'Вопросы', questionIds: ['q-title', 'q-email'] }],
  questions: [
    {
      id: 'q-title',
      sectionId: 'section-1',
      property: { kind: 'TITLE' },
      label: 'Название',
      required: true,
      syncWithPropertyName: false,
      input: { kind: 'TEXT', multiline: false, maxLength: 200 },
    },
    {
      id: 'q-email',
      sectionId: 'section-1',
      property: { kind: 'PROPERTY', propertyId: 'property-email', propertyType: 'EMAIL' },
      label: 'Email',
      required: false,
      syncWithPropertyName: true,
      input: { kind: 'EMAIL' },
    },
  ],
  transitions: [
    {
      id: 'transition-1',
      fromSectionId: 'section-1',
      priority: 0,
      when: null,
      target: { kind: 'ENDING', endingId: 'ending-1' },
    },
  ],
  endings: [{ id: 'ending-1', title: 'Спасибо' }],
}

const properties = [
  { id: 'property-email', name: 'Email', type: 'EMAIL', settings: {} },
  {
    id: 'property-status',
    name: 'Статус',
    type: 'STATUS',
    settings: {
      options: [
        { id: 'option-new', label: 'Новая', color: 'blue' },
        { id: 'option-done', label: 'Готово', color: 'green' },
      ],
    },
  },
  { id: 'property-formula', name: 'Расчёт', type: 'FORMULA', settings: {} },
]

describe('FormPropertyPicker', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it('offers only unused compatible properties and snapshots choice options', async () => {
    const actor = userEvent.setup()
    render(
      <FormPropertyPicker
        open
        pageId="11111111-1111-4111-8111-111111111111"
        document={document}
        properties={properties}
        onClose={() => undefined}
        onAdd={mocks.onAdd}
      />,
    )

    expect(screen.queryByRole('button', { name: /Email/u })).not.toBeInTheDocument()
    expect(screen.queryByText('Расчёт')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Название/u })).not.toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: /Статус/u }))

    expect(mocks.onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        property: {
          kind: 'PROPERTY',
          propertyId: 'property-status',
          propertyType: 'STATUS',
        },
        label: 'Статус',
        input: {
          kind: 'SINGLE_CHOICE',
          appearance: 'LIST',
          options: [
            { id: 'option-new', label: 'Новая', color: 'blue' },
            { id: 'option-done', label: 'Готово', color: 'green' },
          ],
        },
      }),
    )
  })

  it('creates a choice property with matching persisted and form option ids', async () => {
    const actor = userEvent.setup()
    mocks.createProperty.mockImplementationOnce(async (input) => ({
      id: 'property-created',
      name: input.name,
      type: input.type,
      settings: input.settings,
    }))
    render(
      <FormPropertyPicker
        open
        pageId="11111111-1111-4111-8111-111111111111"
        document={document}
        properties={properties}
        onClose={() => undefined}
        onAdd={mocks.onAdd}
      />,
    )

    await actor.click(screen.getByRole('button', { name: 'Создать свойство' }))
    await actor.clear(screen.getByLabelText('Название нового свойства'))
    await actor.type(screen.getByLabelText('Название нового свойства'), 'Категория')
    await actor.click(screen.getByLabelText('Тип нового свойства'))
    await actor.click(screen.getByRole('option', { name: 'Выбор' }))
    await actor.click(screen.getByRole('button', { name: 'Создать и добавить' }))

    const createInput = mocks.createProperty.mock.calls[0]?.[0]
    expect(createInput).toMatchObject({
      type: 'SELECT',
      name: 'Категория',
      settings: { options: [{ label: 'Вариант 1' }] },
    })
    const persistedOptionId = createInput.settings.options[0].id
    expect(persistedOptionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    )
    expect(mocks.onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        property: {
          kind: 'PROPERTY',
          propertyId: 'property-created',
          propertyType: 'SELECT',
        },
        input: expect.objectContaining({
          kind: 'SINGLE_CHOICE',
          options: [expect.objectContaining({ id: persistedOptionId, label: 'Вариант 1' })],
        }),
      }),
    )
  })
})
