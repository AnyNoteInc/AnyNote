// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FormVersionDocument } from '@repo/domain/database/forms'

import { decodeFormFieldKey, encodeFormFieldKey } from '@/components/forms/form-field-key'
import { FormRenderer } from '@/components/forms/form-renderer'

const QUESTION_ID = 'profile.name[0].поле'

const version: FormVersionDocument = {
  schemaVersion: 1,
  firstSectionId: 'section-1',
  presentation: {
    title: 'Анкета',
    submitButtonText: 'Отправить',
    hideAnyNoteBranding: false,
  },
  sections: [{ id: 'section-1', title: 'Данные', questionIds: [QUESTION_ID] }],
  questions: [
    {
      id: QUESTION_ID,
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
      target: { kind: 'ENDING', endingId: 'ending-1' },
    },
  ],
  endings: [{ id: 'ending-1', title: 'Готово' }],
}

describe('FormRenderer field keys', () => {
  afterEach(cleanup)

  it('encodes arbitrary UTF-8 question ids to a reversible path-safe key', () => {
    const key = encodeFormFieldKey(QUESTION_ID)

    expect(key).toMatch(/^q_[0-9a-f]+$/u)
    expect(key).not.toContain('.')
    expect(key).not.toContain('[')
    expect(decodeFormFieldKey(key)).toBe(QUESTION_ID)
  })

  it('validates through the safe key and submits answers under the original question id', async () => {
    const actor = userEvent.setup()
    const onSubmit = vi.fn()
    render(<FormRenderer version={version} mode="public" onSubmit={onSubmit} />)

    const input = screen.getByLabelText('Имя *')
    expect(input).toHaveAttribute('name', `answers.${encodeFormFieldKey(QUESTION_ID)}`)

    await actor.click(screen.getByRole('button', { name: 'Отправить' }))
    expect(await screen.findByText('REQUIRED_ANSWER')).toBeInTheDocument()

    await actor.type(input, 'Виктор')
    await actor.click(screen.getByRole('button', { name: 'Отправить' }))

    expect(onSubmit).toHaveBeenCalledWith({ answers: { [QUESTION_ID]: 'Виктор' } })
  })
})
