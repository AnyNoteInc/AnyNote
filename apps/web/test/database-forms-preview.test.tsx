// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FormVersionDocument } from '@repo/domain/database/forms'

import { initialBuilderState } from '@/components/database/forms/form-builder-state'
import { FormPreviewCanvas } from '@/components/database/forms/form-preview-canvas'

const document: FormVersionDocument = {
  schemaVersion: 1,
  firstSectionId: 'section-1',
  presentation: { title: 'Заявка', submitButtonText: 'Отправить', hideAnyNoteBranding: false },
  sections: [
    { id: 'section-1', title: 'Контакты', questionIds: ['question-1'] },
    { id: 'section-2', title: 'Детали', questionIds: [] },
  ],
  questions: [
    {
      id: 'question-1',
      sectionId: 'section-1',
      property: { kind: 'TITLE' },
      label: 'Имя',
      required: true,
      syncWithPropertyName: false,
      input: { kind: 'TEXT', multiline: false, maxLength: 200 },
    },
  ],
  transitions: [
    {
      id: 'transition-1',
      fromSectionId: 'section-1',
      priority: 0,
      when: null,
      target: { kind: 'SECTION', sectionId: 'section-2' },
    },
    {
      id: 'transition-2',
      fromSectionId: 'section-2',
      priority: 0,
      when: null,
      target: { kind: 'ENDING', endingId: 'ending-1' },
    },
  ],
  endings: [
    {
      id: 'ending-1',
      title: 'Готово',
      body: 'Ответ принят',
      button: { label: 'На главную', href: 'https://anynote.ru' },
    },
  ],
}

afterEach(cleanup)

describe('FormPreviewCanvas', () => {
  it('follows an ending selection and keeps the section map synchronized', async () => {
    const actor = userEvent.setup()
    const dispatch = vi.fn()
    const state = {
      ...initialBuilderState(document, 1),
      selection: { kind: 'ENDING' as const, id: 'ending-1' },
    }

    render(<FormPreviewCanvas state={state} dispatch={dispatch} />)

    expect(screen.getByRole('heading', { name: 'Готово' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'На главную' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Отправить' })).not.toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: /Контакты/u }))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'ITEM_SELECTED',
      selection: { kind: 'SECTION', id: 'section-1' },
    })
  })

  it('shows the section containing the selected question', () => {
    const state = {
      ...initialBuilderState(document, 1),
      selection: { kind: 'QUESTION' as const, id: 'question-1' },
    }

    render(<FormPreviewCanvas state={state} dispatch={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Контакты' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Имя/u)).toBeInTheDocument()
  })
})
