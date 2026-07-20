import type {
  FormEnding,
  FormInputConfig,
  FormPropertyRef,
  FormQuestion,
  FormSection,
  FormTransition,
  FormTransitionTarget,
  FormVersionDocument,
} from '@repo/domain/database/forms'

export type FormBuilderSelection =
  | { kind: 'SECTION'; id: string }
  | { kind: 'QUESTION'; id: string }
  | { kind: 'ENDING'; id: string }

export type FormBuilderSaveState = 'idle' | 'saving' | 'conflict' | 'error'

export interface FormBuilderState {
  document: FormVersionDocument
  serverRevision: number
  generation: number
  dirty: boolean
  saveState: FormBuilderSaveState
  selection: FormBuilderSelection
  conflictLocalJson: string | null
  propertyNameIntents: Record<string, string>
  saveError: string | null
}

type DocumentAction =
  | { type: 'SECTION_ADDED'; id?: string; transitionId?: string }
  | { type: 'SECTION_MOVED'; sectionId: string; index: number }
  | { type: 'SECTION_DELETED'; sectionId: string }
  | {
      type: 'SECTION_UPDATED'
      sectionId: string
      patch: Partial<Pick<FormSection, 'title' | 'description'>>
    }
  | {
      type: 'QUESTION_ADDED'
      id?: string
      sectionId: string
      property: FormPropertyRef
      label: string
      input?: FormInputConfig
    }
  | { type: 'QUESTION_MOVED'; questionId: string; sectionId: string; index: number }
  | { type: 'QUESTION_DELETED'; questionId: string }
  | {
      type: 'QUESTION_UPDATED'
      questionId: string
      patch: Partial<
        Pick<FormQuestion, 'label' | 'description' | 'required' | 'input' | 'visibleWhen'> &
          Pick<FormQuestion, 'icon' | 'defaultAnswer'>
      >
    }
  | { type: 'ENDING_ADDED'; id?: string }
  | { type: 'ENDING_MOVED'; endingId: string; index: number }
  | { type: 'ENDING_DELETED'; endingId: string }
  | {
      type: 'ENDING_UPDATED'
      endingId: string
      patch: Partial<Pick<FormEnding, 'title' | 'body' | 'button'>>
    }
  | {
      type: 'TRANSITION_TARGET_UPDATED'
      transitionId: string
      target: FormTransitionTarget
    }
  | {
      type: 'TRANSITION_UPDATED'
      transitionId: string
      patch: Partial<Pick<FormTransition, 'priority' | 'when' | 'target'>>
    }
  | {
      type: 'TRANSITION_ADDED'
      id?: string
      sectionId: string
      target?: FormTransitionTarget
      when?: FormTransition['when']
    }
  | { type: 'TRANSITION_DELETED'; transitionId: string }
  | { type: 'TRANSITION_MOVED'; transitionId: string; index: number }
  | {
      type: 'PRESENTATION_UPDATED'
      patch: Partial<FormVersionDocument['presentation']>
    }

export type FormBuilderAction =
  | DocumentAction
  | { type: 'ITEM_SELECTED'; selection: FormBuilderSelection }
  | { type: 'SAVE_STARTED'; generation: number }
  | { type: 'SAVE_CONFIRMED'; generation: number; revision: number }
  | { type: 'SAVE_FAILED'; message?: string }
  | { type: 'SAVE_CONFLICT' }
  | { type: 'PROPERTY_RENAME_CONFIRMED'; propertyId: string; name: string }
  | { type: 'SERVER_RELOADED'; document: FormVersionDocument; revision: number }
  | {
      type: 'QUESTION_PROPERTY_NAME_SYNC_SET'
      questionId: string
      enabled: boolean
      propertyNameIntent?: string
    }

function cloneDocument(document: FormVersionDocument): FormVersionDocument {
  return structuredClone(document)
}

function localId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
  return `${prefix}-${id}`.slice(0, 64)
}

function defaultInput(property: FormPropertyRef): FormInputConfig {
  if (property.kind === 'TITLE') return { kind: 'TEXT', multiline: false, maxLength: 200 }
  switch (property.propertyType) {
    case 'TEXT':
      return { kind: 'TEXT', multiline: false, maxLength: 2_000 }
    case 'NUMBER':
      return { kind: 'NUMBER' }
    case 'STATUS':
    case 'SELECT':
      return {
        kind: 'SINGLE_CHOICE',
        appearance: 'LIST',
        options: [{ id: localId('option'), label: 'Вариант' }],
      }
    case 'MULTI_SELECT':
      return {
        kind: 'MULTI_CHOICE',
        appearance: 'CHECKLIST',
        options: [{ id: localId('option'), label: 'Вариант' }],
        maxSelections: 1,
      }
    case 'CHECKBOX':
      return { kind: 'CHECKBOX', consent: false }
    case 'DATE':
      return { kind: 'DATE', includeTime: false }
    case 'PERSON':
      return { kind: 'PERSON', maxSelections: 1 }
    case 'FILE':
      return {
        kind: 'FILE',
        allowedMimeTypes: [],
        maxBytesPerFile: 10 * 1_024 * 1_024,
        maxFiles: 1,
      }
    case 'URL':
      return { kind: 'URL' }
    case 'EMAIL':
      return { kind: 'EMAIL' }
    case 'PHONE':
      return { kind: 'PHONE' }
    case 'RELATION':
      return { kind: 'RELATION', maxSelections: 1 }
    case 'PAGE_LINK':
      return { kind: 'PAGE_LINK' }
  }
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || items.length === 0) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  if (item === undefined) return items
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item)
  return next
}

function fallbackTarget(
  document: FormVersionDocument,
  fromSectionId: string,
): FormTransitionTarget {
  const fromIndex = document.sections.findIndex(({ id }) => id === fromSectionId)
  const nextSection = fromIndex >= 0 ? document.sections[fromIndex + 1] : undefined
  if (nextSection) return { kind: 'SECTION', sectionId: nextSection.id }
  return { kind: 'ENDING', endingId: document.endings[0]!.id }
}

function normalizeTransitions(document: FormVersionDocument): FormVersionDocument {
  const sectionIds = new Set(document.sections.map(({ id }) => id))
  const endingIds = new Set(document.endings.map(({ id }) => id))
  const transitions = document.transitions
    .filter(({ fromSectionId }) => sectionIds.has(fromSectionId))
    .map((transition) => {
      const validTarget =
        transition.target.kind === 'SECTION'
          ? sectionIds.has(transition.target.sectionId) &&
            transition.target.sectionId !== transition.fromSectionId
          : endingIds.has(transition.target.endingId)
      return validTarget
        ? transition
        : { ...transition, target: fallbackTarget(document, transition.fromSectionId) }
    })

  for (const section of document.sections) {
    if (
      !transitions.some(({ fromSectionId, when }) => fromSectionId === section.id && when === null)
    ) {
      transitions.push({
        id: localId('transition'),
        fromSectionId: section.id,
        priority: 0,
        when: null,
        target: fallbackTarget(document, section.id),
      })
    }
  }

  const normalized: FormTransition[] = []
  for (const section of document.sections) {
    const sectionTransitions = transitions
      .filter(({ fromSectionId }) => fromSectionId === section.id)
      .sort((left, right) => {
        const fallbackOrder = Number(left.when === null) - Number(right.when === null)
        return fallbackOrder || left.priority - right.priority
      })
    normalized.push(
      ...sectionTransitions.map((transition, priority) => ({ ...transition, priority })),
    )
  }

  return { ...document, transitions: normalized }
}

function withDocument(state: FormBuilderState, document: FormVersionDocument): FormBuilderState {
  return {
    ...state,
    document: normalizeTransitions(document),
    generation: state.generation + 1,
    dirty: true,
    saveState: state.saveState === 'conflict' ? 'conflict' : 'idle',
  }
}

export function initialBuilderState(
  document: FormVersionDocument,
  serverRevision: number,
): FormBuilderState {
  const copy = cloneDocument(document)
  return {
    document: copy,
    serverRevision,
    generation: 0,
    dirty: false,
    saveState: 'idle',
    selection: { kind: 'SECTION', id: copy.firstSectionId },
    conflictLocalJson: null,
    propertyNameIntents: {},
    saveError: null,
  }
}

export function reduceBuilder(
  state: FormBuilderState,
  action: FormBuilderAction,
): FormBuilderState {
  if (action.type === 'ITEM_SELECTED') return { ...state, selection: action.selection }
  if (action.type === 'SAVE_STARTED') {
    if (state.saveState === 'conflict') return state
    return { ...state, saveState: 'saving', saveError: null }
  }
  if (action.type === 'SAVE_CONFIRMED') {
    return {
      ...state,
      serverRevision: action.revision,
      dirty:
        state.generation !== action.generation || Object.keys(state.propertyNameIntents).length > 0,
      saveState: 'idle',
      saveError: null,
    }
  }
  if (action.type === 'SAVE_FAILED') {
    return {
      ...state,
      dirty: true,
      saveState: 'error',
      saveError: action.message ?? 'FORM_AUTOSAVE_FAILED',
    }
  }
  if (action.type === 'SAVE_CONFLICT') {
    return {
      ...state,
      saveState: 'conflict',
      conflictLocalJson: JSON.stringify(state.document, null, 2),
      saveError: null,
    }
  }
  if (action.type === 'PROPERTY_RENAME_CONFIRMED') {
    if (state.propertyNameIntents[action.propertyId] !== action.name) return state
    const propertyNameIntents = { ...state.propertyNameIntents }
    delete propertyNameIntents[action.propertyId]
    return { ...state, propertyNameIntents }
  }
  if (action.type === 'SERVER_RELOADED') {
    return initialBuilderState(action.document, action.revision)
  }
  if (action.type === 'QUESTION_PROPERTY_NAME_SYNC_SET') {
    const document = cloneDocument(state.document)
    const question = document.questions.find(({ id }) => id === action.questionId)
    if (!question) return state
    question.syncWithPropertyName = action.enabled
    const propertyNameIntents = { ...state.propertyNameIntents }
    if (question.property.kind === 'PROPERTY') {
      if (action.propertyNameIntent) {
        propertyNameIntents[question.property.propertyId] = action.propertyNameIntent
      } else {
        delete propertyNameIntents[question.property.propertyId]
      }
    }
    return { ...withDocument(state, document), propertyNameIntents }
  }

  const document = cloneDocument(state.document)
  switch (action.type) {
    case 'SECTION_ADDED': {
      const id = action.id ?? localId('section')
      document.sections.push({ id, title: 'Новый раздел', questionIds: [] })
      document.transitions.push({
        id: action.transitionId ?? localId('transition'),
        fromSectionId: id,
        priority: 0,
        when: null,
        target: { kind: 'ENDING', endingId: document.endings[0]!.id },
      })
      return {
        ...withDocument(state, document),
        selection: { kind: 'SECTION', id },
      }
    }
    case 'SECTION_MOVED': {
      const from = document.sections.findIndex(({ id }) => id === action.sectionId)
      document.sections = moveItem(document.sections, from, action.index)
      document.firstSectionId = document.sections[0]?.id ?? document.firstSectionId
      return withDocument(state, document)
    }
    case 'SECTION_DELETED': {
      if (document.sections.length <= 1) return state
      const index = document.sections.findIndex(({ id }) => id === action.sectionId)
      if (index < 0) return state
      const questionIds = new Set(document.sections[index]!.questionIds)
      document.sections.splice(index, 1)
      document.questions = document.questions.filter(({ id }) => !questionIds.has(id))
      document.transitions = document.transitions.filter(
        ({ fromSectionId }) => fromSectionId !== action.sectionId,
      )
      if (document.firstSectionId === action.sectionId) {
        document.firstSectionId = document.sections[0]!.id
      }
      const selection =
        state.selection.id === action.sectionId ||
        (state.selection.kind === 'QUESTION' && questionIds.has(state.selection.id))
          ? ({
              kind: 'SECTION',
              id: document.sections[Math.min(index, document.sections.length - 1)]!.id,
            } as const)
          : state.selection
      return { ...withDocument(state, document), selection }
    }
    case 'SECTION_UPDATED': {
      const section = document.sections.find(({ id }) => id === action.sectionId)
      if (!section) return state
      Object.assign(section, action.patch)
      return withDocument(state, document)
    }
    case 'QUESTION_ADDED': {
      const section = document.sections.find(({ id }) => id === action.sectionId)
      if (!section) return state
      const id = action.id ?? localId('question')
      section.questionIds.push(id)
      document.questions.push({
        id,
        sectionId: section.id,
        property: action.property,
        label: action.label,
        required: false,
        syncWithPropertyName: action.property.kind === 'PROPERTY',
        input: action.input ?? defaultInput(action.property),
      })
      return { ...withDocument(state, document), selection: { kind: 'QUESTION', id } }
    }
    case 'QUESTION_MOVED': {
      const question = document.questions.find(({ id }) => id === action.questionId)
      const target = document.sections.find(({ id }) => id === action.sectionId)
      if (!question || !target) return state
      for (const section of document.sections) {
        section.questionIds = section.questionIds.filter((id) => id !== question.id)
      }
      target.questionIds.splice(
        Math.max(0, Math.min(action.index, target.questionIds.length)),
        0,
        question.id,
      )
      question.sectionId = target.id
      return withDocument(state, document)
    }
    case 'QUESTION_DELETED': {
      const question = document.questions.find(({ id }) => id === action.questionId)
      if (!question || document.questions.length <= 1) return state
      document.questions = document.questions.filter(({ id }) => id !== action.questionId)
      for (const section of document.sections) {
        section.questionIds = section.questionIds.filter((id) => id !== action.questionId)
      }
      const selection =
        state.selection.kind === 'QUESTION' && state.selection.id === action.questionId
          ? ({ kind: 'SECTION', id: question.sectionId } as const)
          : state.selection
      return { ...withDocument(state, document), selection }
    }
    case 'QUESTION_UPDATED': {
      const question = document.questions.find(({ id }) => id === action.questionId)
      if (!question) return state
      Object.assign(question, action.patch)
      return withDocument(state, document)
    }
    case 'ENDING_ADDED': {
      const id = action.id ?? localId('ending')
      document.endings.push({ id, title: 'Спасибо' })
      return { ...withDocument(state, document), selection: { kind: 'ENDING', id } }
    }
    case 'ENDING_MOVED': {
      const from = document.endings.findIndex(({ id }) => id === action.endingId)
      document.endings = moveItem(document.endings, from, action.index)
      return withDocument(state, document)
    }
    case 'ENDING_DELETED': {
      if (document.endings.length <= 1) return state
      const index = document.endings.findIndex(({ id }) => id === action.endingId)
      if (index < 0) return state
      document.endings.splice(index, 1)
      const selection =
        state.selection.kind === 'ENDING' && state.selection.id === action.endingId
          ? ({
              kind: 'ENDING',
              id: document.endings[Math.min(index, document.endings.length - 1)]!.id,
            } as const)
          : state.selection
      return { ...withDocument(state, document), selection }
    }
    case 'ENDING_UPDATED': {
      const ending = document.endings.find(({ id }) => id === action.endingId)
      if (!ending) return state
      Object.assign(ending, action.patch)
      return withDocument(state, document)
    }
    case 'TRANSITION_TARGET_UPDATED': {
      const transition = document.transitions.find(({ id }) => id === action.transitionId)
      if (!transition) return state
      transition.target = action.target
      return withDocument(state, document)
    }
    case 'TRANSITION_UPDATED': {
      const transition = document.transitions.find(({ id }) => id === action.transitionId)
      if (!transition) return state
      Object.assign(transition, action.patch)
      return withDocument(state, document)
    }
    case 'TRANSITION_ADDED': {
      const section = document.sections.find(({ id }) => id === action.sectionId)
      const firstQuestionId = section?.questionIds[0]
      if (!section || (!action.when && !firstQuestionId)) return state
      document.transitions.push({
        id: action.id ?? localId('transition'),
        fromSectionId: section.id,
        priority: Number.MAX_SAFE_INTEGER - 1,
        when: action.when ?? {
          kind: 'ALL',
          members: [{ kind: 'IS_NOT_EMPTY', questionId: firstQuestionId! }],
        },
        target: action.target ?? fallbackTarget(document, section.id),
      })
      return withDocument(state, document)
    }
    case 'TRANSITION_DELETED': {
      if (!document.transitions.some(({ id }) => id === action.transitionId)) return state
      document.transitions = document.transitions.filter(({ id }) => id !== action.transitionId)
      return withDocument(state, document)
    }
    case 'TRANSITION_MOVED': {
      const transition = document.transitions.find(({ id }) => id === action.transitionId)
      if (!transition || transition.when === null) return state
      const sectionTransitions = document.transitions
        .filter(
          ({ fromSectionId, when }) => fromSectionId === transition.fromSectionId && when !== null,
        )
        .sort((left, right) => left.priority - right.priority)
      const from = sectionTransitions.findIndex(({ id }) => id === transition.id)
      const reordered = moveItem(sectionTransitions, from, action.index)
      const priorityById = new Map(reordered.map(({ id }, index) => [id, index]))
      document.transitions = document.transitions.map((candidate) =>
        candidate.fromSectionId === transition.fromSectionId && candidate.when !== null
          ? { ...candidate, priority: priorityById.get(candidate.id) ?? candidate.priority }
          : candidate,
      )
      return withDocument(state, document)
    }
    case 'PRESENTATION_UPDATED':
      document.presentation = { ...document.presentation, ...action.patch }
      return withDocument(state, document)
  }
}
