import { describe, expect, it } from 'vitest'

import type { FormVersionDocument } from '@repo/domain/database/forms'

import { initialBuilderState, reduceBuilder } from '@/components/database/forms/form-builder-state'

function documentFixture(): FormVersionDocument {
  return {
    schemaVersion: 1,
    firstSectionId: 'section-contact',
    presentation: {
      title: 'Заявка',
      submitButtonText: 'Отправить',
      hideAnyNoteBranding: false,
    },
    sections: [
      {
        id: 'section-contact',
        title: 'Контакты',
        questionIds: ['q-name', 'q-email'],
      },
      { id: 'section-details', title: 'Детали', questionIds: ['q-note'] },
    ],
    questions: [
      {
        id: 'q-name',
        sectionId: 'section-contact',
        property: { kind: 'TITLE' },
        label: 'Имя',
        required: true,
        syncWithPropertyName: false,
        input: { kind: 'TEXT', multiline: false, maxLength: 200 },
      },
      {
        id: 'q-email',
        sectionId: 'section-contact',
        property: { kind: 'PROPERTY', propertyId: 'property-email', propertyType: 'EMAIL' },
        label: 'Email',
        required: true,
        syncWithPropertyName: true,
        input: { kind: 'EMAIL' },
      },
      {
        id: 'q-note',
        sectionId: 'section-details',
        property: { kind: 'PROPERTY', propertyId: 'property-note', propertyType: 'TEXT' },
        label: 'Комментарий',
        required: false,
        syncWithPropertyName: false,
        input: { kind: 'TEXT', multiline: true, maxLength: 4000 },
      },
    ],
    transitions: [
      {
        id: 'transition-contact',
        fromSectionId: 'section-contact',
        priority: 0,
        when: null,
        target: { kind: 'SECTION', sectionId: 'section-details' },
      },
      {
        id: 'transition-details',
        fromSectionId: 'section-details',
        priority: 0,
        when: null,
        target: { kind: 'ENDING', endingId: 'ending-success' },
      },
    ],
    endings: [
      { id: 'ending-success', title: 'Спасибо' },
      { id: 'ending-later', title: 'Мы свяжемся' },
    ],
  }
}

describe('form builder reducer', () => {
  it('adds stable section/question/ending ids and marks the document dirty', () => {
    let state = initialBuilderState(documentFixture(), 4)
    state = reduceBuilder(state, {
      type: 'SECTION_ADDED',
      id: 'section-new',
      transitionId: 'transition-new',
    })
    state = reduceBuilder(state, {
      type: 'QUESTION_ADDED',
      id: 'q-new',
      sectionId: 'section-new',
      property: { kind: 'PROPERTY', propertyId: 'property-phone', propertyType: 'PHONE' },
      label: 'Телефон',
    })
    state = reduceBuilder(state, { type: 'ENDING_ADDED', id: 'ending-new' })
    state = reduceBuilder(state, {
      type: 'QUESTION_UPDATED',
      questionId: 'q-new',
      patch: { label: 'Контактный телефон' },
    })

    expect(state.document.sections.at(-1)?.id).toBe('section-new')
    expect(state.document.questions.at(-1)).toMatchObject({
      id: 'q-new',
      sectionId: 'section-new',
      label: 'Контактный телефон',
      input: { kind: 'PHONE' },
    })
    expect(state.document.endings.at(-1)?.id).toBe('ending-new')
    expect(state.document.transitions.some(({ id }) => id === 'transition-new')).toBe(true)
    expect(state.dirty).toBe(true)
  })

  it('moves a question between sections without changing its local id', () => {
    const state = reduceBuilder(initialBuilderState(documentFixture(), 1), {
      type: 'QUESTION_MOVED',
      questionId: 'q-email',
      sectionId: 'section-details',
      index: 0,
    })

    expect(state.document.sections[0]?.questionIds).toEqual(['q-name'])
    expect(state.document.sections[1]?.questionIds).toEqual(['q-email', 'q-note'])
    expect(state.document.questions.find(({ id }) => id === 'q-email')).toMatchObject({
      id: 'q-email',
      sectionId: 'section-details',
    })
    expect(state.dirty).toBe(true)
  })

  it('reorders sections and preserves the selected stable id', () => {
    const selected = reduceBuilder(initialBuilderState(documentFixture(), 1), {
      type: 'ITEM_SELECTED',
      selection: { kind: 'SECTION', id: 'section-details' },
    })
    const state = reduceBuilder(selected, {
      type: 'SECTION_MOVED',
      sectionId: 'section-details',
      index: 0,
    })

    expect(state.document.sections.map(({ id }) => id)).toEqual([
      'section-details',
      'section-contact',
    ])
    expect(state.selection).toEqual({ kind: 'SECTION', id: 'section-details' })
  })

  it('falls selection back to the containing section when a question is deleted', () => {
    const selected = reduceBuilder(initialBuilderState(documentFixture(), 1), {
      type: 'ITEM_SELECTED',
      selection: { kind: 'QUESTION', id: 'q-email' },
    })
    const state = reduceBuilder(selected, { type: 'QUESTION_DELETED', questionId: 'q-email' })

    expect(state.document.questions.some(({ id }) => id === 'q-email')).toBe(false)
    expect(state.selection).toEqual({ kind: 'SECTION', id: 'section-contact' })
  })

  it('retargets fallback transitions when a section or ending is deleted', () => {
    let state = reduceBuilder(initialBuilderState(documentFixture(), 1), {
      type: 'SECTION_DELETED',
      sectionId: 'section-details',
    })

    expect(state.document.transitions).toContainEqual(
      expect.objectContaining({
        fromSectionId: 'section-contact',
        when: null,
        target: { kind: 'ENDING', endingId: 'ending-success' },
      }),
    )

    state = reduceBuilder(state, { type: 'ENDING_DELETED', endingId: 'ending-success' })
    expect(state.document.transitions).toContainEqual(
      expect.objectContaining({
        fromSectionId: 'section-contact',
        when: null,
        target: { kind: 'ENDING', endingId: 'ending-later' },
      }),
    )
  })

  it('keeps newer edits dirty when an older autosave generation succeeds', () => {
    let state = initialBuilderState(documentFixture(), 7)
    state = reduceBuilder(state, {
      type: 'QUESTION_UPDATED',
      questionId: 'q-name',
      patch: { label: 'Ваше имя' },
    })
    const firstGeneration = state.generation
    state = reduceBuilder(state, { type: 'SAVE_STARTED', generation: firstGeneration })
    state = reduceBuilder(state, {
      type: 'QUESTION_UPDATED',
      questionId: 'q-name',
      patch: { description: 'Как к вам обращаться?' },
    })
    state = reduceBuilder(state, {
      type: 'SAVE_CONFIRMED',
      generation: firstGeneration,
      revision: 8,
    })

    expect(state.serverRevision).toBe(8)
    expect(state.dirty).toBe(true)
    expect(state.saveState).toBe('idle')
  })

  it('stops autosave on conflict and reload restores the server snapshot', () => {
    const local = reduceBuilder(initialBuilderState(documentFixture(), 2), {
      type: 'QUESTION_UPDATED',
      questionId: 'q-email',
      patch: { label: 'Почта' },
    })
    const conflicted = reduceBuilder(local, { type: 'SAVE_CONFLICT' })
    expect(conflicted.saveState).toBe('conflict')
    expect(conflicted.conflictLocalJson).toContain('Почта')

    const reloadedDocument = documentFixture()
    reloadedDocument.presentation.title = 'Версия сервера'
    const reloaded = reduceBuilder(conflicted, {
      type: 'SERVER_RELOADED',
      document: reloadedDocument,
      revision: 3,
    })
    expect(reloaded.saveState).toBe('idle')
    expect(reloaded.dirty).toBe(false)
    expect(reloaded.document.presentation.title).toBe('Версия сервера')
  })

  it('records explicit syncWithPropertyName rename intent', () => {
    const state = reduceBuilder(initialBuilderState(documentFixture(), 1), {
      type: 'QUESTION_PROPERTY_NAME_SYNC_SET',
      questionId: 'q-email',
      enabled: false,
      propertyNameIntent: 'Email для ответа',
    })

    expect(state.document.questions.find(({ id }) => id === 'q-email')).toMatchObject({
      syncWithPropertyName: false,
    })
    expect(state.propertyNameIntents['property-email']).toBe('Email для ответа')
  })

  it('adds, reorders and deletes conditional transitions while keeping one fallback last', () => {
    let state = initialBuilderState(documentFixture(), 1)
    state = reduceBuilder(state, {
      type: 'TRANSITION_ADDED',
      id: 'transition-conditional',
      sectionId: 'section-contact',
      target: { kind: 'ENDING', endingId: 'ending-later' },
      when: { kind: 'ALL', members: [{ kind: 'IS_NOT_EMPTY', questionId: 'q-name' }] },
    })

    let contactTransitions = state.document.transitions.filter(
      ({ fromSectionId }) => fromSectionId === 'section-contact',
    )
    expect(contactTransitions.map(({ id, priority, when }) => ({ id, priority, when }))).toEqual([
      expect.objectContaining({ id: 'transition-conditional', priority: 0 }),
      { id: 'transition-contact', priority: 1, when: null },
    ])

    state = reduceBuilder(state, {
      type: 'TRANSITION_ADDED',
      id: 'transition-second',
      sectionId: 'section-contact',
      target: { kind: 'ENDING', endingId: 'ending-success' },
      when: { kind: 'ANY', members: [{ kind: 'IS_EMPTY', questionId: 'q-name' }] },
    })
    state = reduceBuilder(state, {
      type: 'TRANSITION_MOVED',
      transitionId: 'transition-second',
      index: 0,
    })
    contactTransitions = state.document.transitions.filter(
      ({ fromSectionId }) => fromSectionId === 'section-contact',
    )
    expect(contactTransitions.map(({ id }) => id)).toEqual([
      'transition-second',
      'transition-conditional',
      'transition-contact',
    ])
    expect(contactTransitions.map(({ priority }) => priority)).toEqual([0, 1, 2])
    expect(contactTransitions.at(-1)?.when).toBeNull()

    state = reduceBuilder(state, {
      type: 'TRANSITION_DELETED',
      transitionId: 'transition-conditional',
    })
    expect(state.document.transitions.some(({ id }) => id === 'transition-conditional')).toBe(false)
    expect(
      state.document.transitions.filter(
        ({ fromSectionId, when }) => fromSectionId === 'section-contact' && when === null,
      ),
    ).toHaveLength(1)
  })

  it('accepts a property snapshot input instead of inventing choice option ids', () => {
    const state = reduceBuilder(initialBuilderState(documentFixture(), 1), {
      type: 'QUESTION_ADDED',
      id: 'q-status',
      sectionId: 'section-details',
      property: { kind: 'PROPERTY', propertyId: 'property-status', propertyType: 'STATUS' },
      label: 'Статус',
      input: {
        kind: 'SINGLE_CHOICE',
        appearance: 'LIST',
        options: [
          { id: 'option-new', label: 'Новая', color: 'blue' },
          { id: 'option-done', label: 'Готово', color: 'green' },
        ],
      },
    })

    expect(state.document.questions.find(({ id }) => id === 'q-status')?.input).toEqual({
      kind: 'SINGLE_CHOICE',
      appearance: 'LIST',
      options: [
        { id: 'option-new', label: 'Новая', color: 'blue' },
        { id: 'option-done', label: 'Готово', color: 'green' },
      ],
    })
  })

  it('keeps save errors dirty and clears only the exact acknowledged rename intent', () => {
    let state = reduceBuilder(initialBuilderState(documentFixture(), 3), {
      type: 'QUESTION_PROPERTY_NAME_SYNC_SET',
      questionId: 'q-email',
      enabled: true,
      propertyNameIntent: 'Почта',
    })
    const generation = state.generation
    state = reduceBuilder(state, { type: 'SAVE_STARTED', generation })
    state = reduceBuilder(state, { type: 'SAVE_FAILED', message: 'RENAME_FAILED' })
    expect(state).toMatchObject({ dirty: true, saveState: 'error', saveError: 'RENAME_FAILED' })
    expect(state.propertyNameIntents['property-email']).toBe('Почта')

    state = reduceBuilder(state, {
      type: 'QUESTION_PROPERTY_NAME_SYNC_SET',
      questionId: 'q-email',
      enabled: true,
      propertyNameIntent: 'Рабочая почта',
    })
    state = reduceBuilder(state, {
      type: 'PROPERTY_RENAME_CONFIRMED',
      propertyId: 'property-email',
      name: 'Почта',
    })
    expect(state.propertyNameIntents['property-email']).toBe('Рабочая почта')

    state = reduceBuilder(state, {
      type: 'PROPERTY_RENAME_CONFIRMED',
      propertyId: 'property-email',
      name: 'Рабочая почта',
    })
    expect(state.propertyNameIntents['property-email']).toBeUndefined()
    const currentGeneration = state.generation
    state = reduceBuilder(state, {
      type: 'SAVE_CONFIRMED',
      generation: currentGeneration,
      revision: 4,
    })
    expect(state).toMatchObject({ dirty: false, saveState: 'idle', saveError: null })
  })
})
