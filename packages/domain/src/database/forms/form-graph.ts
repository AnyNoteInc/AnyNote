import type {
  FormCondition,
  FormConditionGroup,
  FormConditionNode,
  FormPropertyType,
  FormQuestion,
  FormTransition,
  FormVersionDocument,
} from './form-document.ts'

export type PublicFormQuestion = Omit<FormQuestion, 'property'> & {
  valueType: FormPropertyType | 'TITLE'
}

export type PublicFormVersion = Omit<FormVersionDocument, 'questions'> & {
  questions: PublicFormQuestion[]
}

export type EvaluatedFormPath = {
  sectionIds: string[]
  visibleQuestionIds: string[]
  endingId: string
}

export type FormGraphErrorCode =
  | 'DUPLICATE_SECTION_ID'
  | 'DUPLICATE_QUESTION_ID'
  | 'DUPLICATE_TRANSITION_ID'
  | 'DUPLICATE_ENDING_ID'
  | 'DUPLICATE_SECTION_QUESTION_ID'
  | 'FIRST_SECTION_NOT_FOUND'
  | 'QUESTION_SECTION_NOT_FOUND'
  | 'SECTION_QUESTION_NOT_FOUND'
  | 'QUESTION_SECTION_MISMATCH'
  | 'TRANSITION_SECTION_NOT_FOUND'
  | 'TRANSITION_TARGET_SECTION_NOT_FOUND'
  | 'TRANSITION_TARGET_ENDING_NOT_FOUND'
  | 'MISSING_FALLBACK_TRANSITION'
  | 'MULTIPLE_FALLBACK_TRANSITIONS'
  | 'DUPLICATE_TRANSITION_PRIORITY'
  | 'GRAPH_CYCLE'
  | 'UNREACHABLE_SECTION'
  | 'UNREACHABLE_ENDING'
  | 'SECTION_CANNOT_REACH_ENDING'
  | 'DUPLICATE_PROPERTY_QUESTION'
  | 'DUPLICATE_OPTION_ID'
  | 'QUESTION_INPUT_TYPE_MISMATCH'
  | 'RESERVED_QUESTION_ID'
  | 'CONDITION_QUESTION_NOT_FOUND'
  | 'CONDITION_QUESTION_NOT_EARLIER'
  | 'CONDITION_OPERATOR_INCOMPATIBLE'
  | 'CONDITION_OPTION_NOT_FOUND'

export type FormGraphError = {
  code: FormGraphErrorCode
  path: (string | number)[]
  message: string
  entityId?: string
  referenceId?: string
}

export type FormGraphValidationResult =
  { ok: true; errors: [] } | { ok: false; errors: FormGraphError[] }

type FormFlowVersion = FormVersionDocument | PublicFormVersion
type FormFlowQuestion = FormQuestion | PublicFormQuestion

const RESERVED_FORM_ANSWER_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export const isReservedFormAnswerKey = (key: string): boolean => RESERVED_FORM_ANSWER_KEYS.has(key)

type RuntimeAnswerState = 'EMPTY' | 'NON_EMPTY' | 'INVALID'

const classifyRuntimeAnswer = (hasOwnAnswer: boolean, value: unknown): RuntimeAnswerState => {
  if (!hasOwnAnswer || value === undefined || value === null || value === '') return 'EMPTY'
  if (typeof value === 'string' || typeof value === 'boolean') return 'NON_EMPTY'
  if (typeof value === 'number') return Number.isFinite(value) ? 'NON_EMPTY' : 'INVALID'
  if (Array.isArray(value)) {
    if (value.length === 0) return 'EMPTY'
    return value.every((item) => typeof item === 'string' && item.length > 0)
      ? 'NON_EMPTY'
      : 'INVALID'
  }
  return 'INVALID'
}

const isCalendarDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

const asValidDate = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const datePart = value.slice(0, 10)
  const isDateOnly = value.length === 10 && isCalendarDate(value)
  const isDateTime =
    isCalendarDate(datePart) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  if (!isDateOnly && !isDateTime) return undefined
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : timestamp
}

export const evaluateCondition = (
  condition: FormCondition,
  answers: Record<string, unknown>,
): boolean => {
  const hasOwnAnswer = Object.prototype.hasOwnProperty.call(answers, condition.questionId)
  const answer = hasOwnAnswer ? answers[condition.questionId] : undefined
  const answerState = classifyRuntimeAnswer(hasOwnAnswer, answer)

  switch (condition.kind) {
    case 'IS_EMPTY':
      return answerState === 'EMPTY'
    case 'IS_NOT_EMPTY':
      return answerState === 'NON_EMPTY'
    case 'TEXT_EQUALS':
      return typeof answer === 'string' && answer === condition.value
    case 'TEXT_NOT_EQUALS':
      return typeof answer === 'string' && answer !== condition.value
    case 'TEXT_CONTAINS':
      return typeof answer === 'string' && answer.includes(condition.value)
    case 'TEXT_NOT_CONTAINS':
      return typeof answer === 'string' && !answer.includes(condition.value)
    case 'NUMBER_EQUALS':
      return typeof answer === 'number' && Number.isFinite(answer) && answer === condition.value
    case 'NUMBER_NOT_EQUALS':
      return typeof answer === 'number' && Number.isFinite(answer) && answer !== condition.value
    case 'NUMBER_GREATER_THAN':
      return typeof answer === 'number' && Number.isFinite(answer) && answer > condition.value
    case 'NUMBER_GREATER_THAN_OR_EQUAL':
      return typeof answer === 'number' && Number.isFinite(answer) && answer >= condition.value
    case 'NUMBER_LESS_THAN':
      return typeof answer === 'number' && Number.isFinite(answer) && answer < condition.value
    case 'NUMBER_LESS_THAN_OR_EQUAL':
      return typeof answer === 'number' && Number.isFinite(answer) && answer <= condition.value
    case 'DATE_BEFORE': {
      const answerDate = asValidDate(answer)
      const conditionDate = asValidDate(condition.value)
      return answerDate !== undefined && conditionDate !== undefined && answerDate < conditionDate
    }
    case 'DATE_AFTER': {
      const answerDate = asValidDate(answer)
      const conditionDate = asValidDate(condition.value)
      return answerDate !== undefined && conditionDate !== undefined && answerDate > conditionDate
    }
    case 'DATE_ON': {
      const answerDate = asValidDate(answer)
      const conditionDate = asValidDate(condition.value)
      return answerDate !== undefined && conditionDate !== undefined && answerDate === conditionDate
    }
    case 'CHECKBOX_IS':
      return typeof answer === 'boolean' && answer === condition.value
    case 'OPTION_IS':
      return typeof answer === 'string' && answer === condition.optionId
    case 'OPTION_IS_NOT':
      return typeof answer === 'string' && answer !== condition.optionId
    case 'OPTION_CONTAINS':
      return (
        Array.isArray(answer) &&
        answer.every((item) => typeof item === 'string') &&
        answer.includes(condition.optionId)
      )
    case 'OPTION_NOT_CONTAINS':
      return (
        Array.isArray(answer) &&
        answer.every((item) => typeof item === 'string') &&
        !answer.includes(condition.optionId)
      )
  }
}

export const evaluateConditionGroup = (
  group: FormConditionGroup,
  answers: Record<string, unknown>,
): boolean => {
  const evaluateNode = (node: FormConditionNode): boolean =>
    node.kind === 'ALL' || node.kind === 'ANY'
      ? evaluateConditionGroup(node, answers)
      : evaluateCondition(node, answers)

  return group.kind === 'ALL' ? group.members.every(evaluateNode) : group.members.some(evaluateNode)
}

const orderedTransitions = (transitions: FormTransition[]): FormTransition[] =>
  [...transitions].sort((left, right) => {
    const leftFallback = left.when === null ? 1 : 0
    const rightFallback = right.when === null ? 1 : 0
    return (
      leftFallback - rightFallback ||
      left.priority - right.priority ||
      left.id.localeCompare(right.id)
    )
  })

export const evaluateFormPath = (
  version: FormFlowVersion,
  answers: Record<string, unknown>,
): EvaluatedFormPath => {
  const sectionsById = new Map(version.sections.map((section) => [section.id, section]))
  const questionsById = new Map(version.questions.map((question) => [question.id, question]))
  const endingsById = new Map(version.endings.map((ending) => [ending.id, ending]))
  const transitionsBySection = new Map<string, FormTransition[]>()

  for (const transition of version.transitions) {
    const existing = transitionsBySection.get(transition.fromSectionId) ?? []
    existing.push(transition)
    transitionsBySection.set(transition.fromSectionId, existing)
  }

  const sectionIds: string[] = []
  const visibleQuestionIds: string[] = []
  const visited = new Set<string>()
  let currentSectionId = version.firstSectionId

  while (true) {
    if (visited.has(currentSectionId)) throw new Error('FORM_GRAPH_CYCLE')
    visited.add(currentSectionId)

    const section = sectionsById.get(currentSectionId)
    if (section === undefined) throw new Error('FORM_GRAPH_SECTION_NOT_FOUND')
    sectionIds.push(section.id)

    for (const questionId of section.questionIds) {
      const question = questionsById.get(questionId)
      if (question === undefined) throw new Error('FORM_GRAPH_QUESTION_NOT_FOUND')
      if (
        question.visibleWhen === undefined ||
        evaluateConditionGroup(question.visibleWhen, answers)
      ) {
        visibleQuestionIds.push(question.id)
      }
    }

    const transitions = orderedTransitions(transitionsBySection.get(section.id) ?? [])
    const selected = transitions.find(
      (transition) => transition.when === null || evaluateConditionGroup(transition.when, answers),
    )
    if (selected === undefined) throw new Error('FORM_GRAPH_TRANSITION_NOT_FOUND')

    if (selected.target.kind === 'ENDING') {
      if (!endingsById.has(selected.target.endingId)) {
        throw new Error('FORM_GRAPH_ENDING_NOT_FOUND')
      }
      return { sectionIds, visibleQuestionIds, endingId: selected.target.endingId }
    }

    currentSectionId = selected.target.sectionId
  }
}

const addError = (
  errors: FormGraphError[],
  code: FormGraphErrorCode,
  path: (string | number)[],
  entityId?: string,
  referenceId?: string,
): void => {
  errors.push({ code, path, message: code, entityId, referenceId })
}

const findDuplicateIds = (
  values: readonly { id: string }[],
  code: FormGraphErrorCode,
  pathRoot: string,
  errors: FormGraphError[],
): void => {
  const firstIndexById = new Map<string, number>()
  values.forEach((value, index) => {
    if (firstIndexById.has(value.id)) {
      addError(errors, code, [pathRoot, index, 'id'], value.id, value.id)
    } else {
      firstIndexById.set(value.id, index)
    }
  })
}

const intersection = (sets: Set<string>[]): Set<string> => {
  if (sets.length === 0) return new Set()
  return new Set([...sets[0]!].filter((value) => sets.slice(1).every((set) => set.has(value))))
}

const collectConditions = (group: FormConditionGroup): FormCondition[] => {
  const conditions: FormCondition[] = []
  const visit = (node: FormConditionNode): void => {
    if (node.kind === 'ALL' || node.kind === 'ANY') {
      node.members.forEach(visit)
    } else {
      conditions.push(node)
    }
  }
  visit(group)
  return conditions
}

const conditionFamily = (condition: FormCondition): string => {
  if (condition.kind === 'IS_EMPTY' || condition.kind === 'IS_NOT_EMPTY') return 'EMPTY'
  if (condition.kind.startsWith('TEXT_')) return 'TEXT'
  if (condition.kind.startsWith('NUMBER_')) return 'NUMBER'
  if (condition.kind.startsWith('DATE_')) return 'DATE'
  if (condition.kind === 'CHECKBOX_IS') return 'CHECKBOX'
  if (condition.kind === 'OPTION_IS' || condition.kind === 'OPTION_IS_NOT') return 'SINGLE_OPTION'
  return 'MULTI_OPTION'
}

const questionInputFamily = (question: FormFlowQuestion): string => {
  switch (question.input.kind) {
    case 'TEXT':
    case 'URL':
    case 'EMAIL':
    case 'PHONE':
      return 'TEXT'
    case 'NUMBER':
      return 'NUMBER'
    case 'DATE':
      return 'DATE'
    case 'CHECKBOX':
      return 'CHECKBOX'
    case 'SINGLE_CHOICE':
      return 'SINGLE_OPTION'
    case 'MULTI_CHOICE':
      return 'MULTI_OPTION'
    case 'FILE':
    case 'PERSON':
    case 'RELATION':
    case 'PAGE_LINK':
      return 'OPAQUE'
  }
}

const questionValueType = (question: FormFlowQuestion): FormPropertyType | 'TITLE' =>
  'valueType' in question
    ? question.valueType
    : question.property.kind === 'TITLE'
      ? 'TITLE'
      : question.property.propertyType

const expectedInputKind = (
  valueType: FormPropertyType | 'TITLE',
): FormQuestion['input']['kind'] => {
  switch (valueType) {
    case 'TITLE':
    case 'TEXT':
      return 'TEXT'
    case 'NUMBER':
      return 'NUMBER'
    case 'STATUS':
    case 'SELECT':
      return 'SINGLE_CHOICE'
    case 'MULTI_SELECT':
      return 'MULTI_CHOICE'
    case 'CHECKBOX':
      return 'CHECKBOX'
    case 'DATE':
      return 'DATE'
    case 'URL':
      return 'URL'
    case 'EMAIL':
      return 'EMAIL'
    case 'PHONE':
      return 'PHONE'
    case 'FILE':
      return 'FILE'
    case 'PERSON':
      return 'PERSON'
    case 'RELATION':
      return 'RELATION'
    case 'PAGE_LINK':
      return 'PAGE_LINK'
  }
}

export const isFormQuestionInputCompatible = (question: FormFlowQuestion): boolean =>
  question.input.kind === expectedInputKind(questionValueType(question))

const questionValueFamily = (question: FormFlowQuestion): string => {
  const valueType = questionValueType(question)

  switch (valueType) {
    case 'TITLE':
    case 'TEXT':
    case 'URL':
    case 'EMAIL':
    case 'PHONE':
      return 'TEXT'
    case 'NUMBER':
      return 'NUMBER'
    case 'DATE':
      return 'DATE'
    case 'CHECKBOX':
      return 'CHECKBOX'
    case 'STATUS':
    case 'SELECT':
      return 'SINGLE_OPTION'
    case 'MULTI_SELECT':
      return 'MULTI_OPTION'
    case 'FILE':
    case 'PERSON':
    case 'RELATION':
    case 'PAGE_LINK':
      return 'OPAQUE'
  }
}

const questionFamily = (question: FormFlowQuestion): string => {
  const inputFamily = questionInputFamily(question)
  return inputFamily === questionValueFamily(question) ? inputFamily : 'INCOMPATIBLE'
}

const validateConditionGroup = (
  group: FormConditionGroup,
  allowedQuestionIds: Set<string>,
  questionsById: Map<string, FormFlowQuestion>,
  path: (string | number)[],
  errors: FormGraphError[],
): void => {
  for (const condition of collectConditions(group)) {
    const question = questionsById.get(condition.questionId)
    if (question === undefined) {
      addError(errors, 'CONDITION_QUESTION_NOT_FOUND', path, undefined, condition.questionId)
      continue
    }

    if (!allowedQuestionIds.has(condition.questionId)) {
      addError(errors, 'CONDITION_QUESTION_NOT_EARLIER', path, undefined, condition.questionId)
    }

    const expectedFamily = conditionFamily(condition)
    const actualFamily = questionFamily(question)
    if (expectedFamily !== 'EMPTY' && expectedFamily !== actualFamily) {
      addError(errors, 'CONDITION_OPERATOR_INCOMPATIBLE', path, question.id, condition.kind)
      continue
    }

    if ('optionId' in condition) {
      if (
        (question.input.kind === 'SINGLE_CHOICE' || question.input.kind === 'MULTI_CHOICE') &&
        !question.input.options.some(({ id }) => id === condition.optionId)
      ) {
        addError(errors, 'CONDITION_OPTION_NOT_FOUND', path, question.id, condition.optionId)
      }
    }
  }
}

export const validateFormGraph = (version: FormFlowVersion): FormGraphValidationResult => {
  const errors: FormGraphError[] = []
  const questions: FormFlowQuestion[] = [...version.questions]

  findDuplicateIds(version.sections, 'DUPLICATE_SECTION_ID', 'sections', errors)
  findDuplicateIds(questions, 'DUPLICATE_QUESTION_ID', 'questions', errors)
  findDuplicateIds(version.transitions, 'DUPLICATE_TRANSITION_ID', 'transitions', errors)
  findDuplicateIds(version.endings, 'DUPLICATE_ENDING_ID', 'endings', errors)

  const sectionsById = new Map(version.sections.map((section) => [section.id, section]))
  const questionsById = new Map(questions.map((question) => [question.id, question]))
  const endingIds = new Set(version.endings.map(({ id }) => id))

  if (!sectionsById.has(version.firstSectionId)) {
    addError(
      errors,
      'FIRST_SECTION_NOT_FOUND',
      ['firstSectionId'],
      undefined,
      version.firstSectionId,
    )
  }

  version.sections.forEach((section, sectionIndex) => {
    const seenQuestionIds = new Set<string>()
    section.questionIds.forEach((questionId, questionIndex) => {
      if (seenQuestionIds.has(questionId)) {
        addError(
          errors,
          'DUPLICATE_SECTION_QUESTION_ID',
          ['sections', sectionIndex, 'questionIds', questionIndex],
          section.id,
          questionId,
        )
      }
      seenQuestionIds.add(questionId)

      const question = questionsById.get(questionId)
      if (question === undefined) {
        addError(
          errors,
          'SECTION_QUESTION_NOT_FOUND',
          ['sections', sectionIndex, 'questionIds', questionIndex],
          section.id,
          questionId,
        )
      } else if (question.sectionId !== section.id) {
        addError(
          errors,
          'QUESTION_SECTION_MISMATCH',
          ['sections', sectionIndex, 'questionIds', questionIndex],
          question.id,
          section.id,
        )
      }
    })
  })

  questions.forEach((question, questionIndex) => {
    if (isReservedFormAnswerKey(question.id)) {
      addError(errors, 'RESERVED_QUESTION_ID', ['questions', questionIndex, 'id'], question.id)
    }

    const section = sectionsById.get(question.sectionId)
    if (section === undefined) {
      addError(
        errors,
        'QUESTION_SECTION_NOT_FOUND',
        ['questions', questionIndex, 'sectionId'],
        question.id,
        question.sectionId,
      )
    } else if (!section.questionIds.includes(question.id)) {
      addError(
        errors,
        'QUESTION_SECTION_MISMATCH',
        ['questions', questionIndex, 'sectionId'],
        question.id,
        question.sectionId,
      )
    }

    if (!isFormQuestionInputCompatible(question)) {
      addError(
        errors,
        'QUESTION_INPUT_TYPE_MISMATCH',
        ['questions', questionIndex, 'input', 'kind'],
        question.id,
        expectedInputKind(questionValueType(question)),
      )
    }
  })

  const transitionsBySection = new Map<string, FormTransition[]>()
  const adjacency = new Map<string, Set<string>>()
  const predecessors = new Map<string, Set<string>>()
  for (const section of version.sections) {
    adjacency.set(section.id, new Set())
    predecessors.set(section.id, new Set())
  }

  version.transitions.forEach((transition, transitionIndex) => {
    if (!sectionsById.has(transition.fromSectionId)) {
      addError(
        errors,
        'TRANSITION_SECTION_NOT_FOUND',
        ['transitions', transitionIndex, 'fromSectionId'],
        transition.id,
        transition.fromSectionId,
      )
    } else {
      const sectionTransitions = transitionsBySection.get(transition.fromSectionId) ?? []
      sectionTransitions.push(transition)
      transitionsBySection.set(transition.fromSectionId, sectionTransitions)
    }

    if (transition.target.kind === 'SECTION') {
      if (!sectionsById.has(transition.target.sectionId)) {
        addError(
          errors,
          'TRANSITION_TARGET_SECTION_NOT_FOUND',
          ['transitions', transitionIndex, 'target', 'sectionId'],
          transition.id,
          transition.target.sectionId,
        )
      } else if (sectionsById.has(transition.fromSectionId)) {
        adjacency.get(transition.fromSectionId)?.add(transition.target.sectionId)
        predecessors.get(transition.target.sectionId)?.add(transition.fromSectionId)
      }
    } else if (!endingIds.has(transition.target.endingId)) {
      addError(
        errors,
        'TRANSITION_TARGET_ENDING_NOT_FOUND',
        ['transitions', transitionIndex, 'target', 'endingId'],
        transition.id,
        transition.target.endingId,
      )
    }
  })

  version.sections.forEach((section, sectionIndex) => {
    const transitions = transitionsBySection.get(section.id) ?? []
    const fallbackCount = transitions.filter(({ when }) => when === null).length
    if (fallbackCount === 0) {
      addError(errors, 'MISSING_FALLBACK_TRANSITION', ['sections', sectionIndex], section.id)
    } else if (fallbackCount > 1) {
      addError(errors, 'MULTIPLE_FALLBACK_TRANSITIONS', ['sections', sectionIndex], section.id)
    }

    const seenPriorities = new Set<number>()
    for (const transition of transitions) {
      if (seenPriorities.has(transition.priority)) {
        addError(
          errors,
          'DUPLICATE_TRANSITION_PRIORITY',
          ['transitions', version.transitions.indexOf(transition), 'priority'],
          transition.id,
          String(transition.priority),
        )
      }
      seenPriorities.add(transition.priority)
    }
  })

  const color = new Map<string, 'VISITING' | 'VISITED'>()
  const visitForCycles = (sectionId: string): void => {
    color.set(sectionId, 'VISITING')
    for (const targetId of adjacency.get(sectionId) ?? []) {
      if (color.get(targetId) === 'VISITING') {
        addError(errors, 'GRAPH_CYCLE', ['sections'], sectionId, targetId)
      } else if (color.get(targetId) === undefined) {
        visitForCycles(targetId)
      }
    }
    color.set(sectionId, 'VISITED')
  }
  for (const section of version.sections) {
    if (color.get(section.id) === undefined) visitForCycles(section.id)
  }

  const reachableSections = new Set<string>()
  const reachableEndings = new Set<string>()
  const pending = sectionsById.has(version.firstSectionId) ? [version.firstSectionId] : []
  while (pending.length > 0) {
    const sectionId = pending.pop()!
    if (reachableSections.has(sectionId)) continue
    reachableSections.add(sectionId)
    for (const transition of transitionsBySection.get(sectionId) ?? []) {
      if (transition.target.kind === 'SECTION' && sectionsById.has(transition.target.sectionId)) {
        pending.push(transition.target.sectionId)
      } else if (transition.target.kind === 'ENDING' && endingIds.has(transition.target.endingId)) {
        reachableEndings.add(transition.target.endingId)
      }
    }
  }

  version.sections.forEach((section, index) => {
    if (!reachableSections.has(section.id)) {
      addError(errors, 'UNREACHABLE_SECTION', ['sections', index], section.id)
    }
  })
  version.endings.forEach((ending, index) => {
    if (!reachableEndings.has(ending.id)) {
      addError(errors, 'UNREACHABLE_ENDING', ['endings', index], ending.id)
    }
  })

  const canReachEnding = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const section of version.sections) {
      if (canReachEnding.has(section.id)) continue
      const transitions = transitionsBySection.get(section.id) ?? []
      const canReach = transitions.some(
        (transition) =>
          (transition.target.kind === 'ENDING' && endingIds.has(transition.target.endingId)) ||
          (transition.target.kind === 'SECTION' && canReachEnding.has(transition.target.sectionId)),
      )
      if (canReach) {
        canReachEnding.add(section.id)
        changed = true
      }
    }
  }
  version.sections.forEach((section, index) => {
    if (reachableSections.has(section.id) && !canReachEnding.has(section.id)) {
      addError(errors, 'SECTION_CANNOT_REACH_ENDING', ['sections', index], section.id)
    }
  })

  if ('property' in (questions[0] ?? {})) {
    const firstQuestionByProperty = new Map<string, string>()
    ;(questions as FormQuestion[]).forEach((question, index) => {
      const propertyKey =
        question.property.kind === 'TITLE' ? 'TITLE' : `PROPERTY:${question.property.propertyId}`
      const firstQuestionId = firstQuestionByProperty.get(propertyKey)
      if (firstQuestionId !== undefined) {
        addError(
          errors,
          'DUPLICATE_PROPERTY_QUESTION',
          ['questions', index, 'property'],
          question.id,
          firstQuestionId,
        )
      } else {
        firstQuestionByProperty.set(propertyKey, question.id)
      }
    })
  }

  questions.forEach((question, questionIndex) => {
    if (question.input.kind !== 'SINGLE_CHOICE' && question.input.kind !== 'MULTI_CHOICE') return
    const optionIds = new Set<string>()
    question.input.options.forEach((option, optionIndex) => {
      if (optionIds.has(option.id)) {
        addError(
          errors,
          'DUPLICATE_OPTION_ID',
          ['questions', questionIndex, 'input', 'options', optionIndex, 'id'],
          question.id,
          option.id,
        )
      }
      optionIds.add(option.id)
    })
  })

  const indegrees = new Map(version.sections.map((section) => [section.id, 0]))
  for (const targets of adjacency.values()) {
    for (const targetId of targets) indegrees.set(targetId, (indegrees.get(targetId) ?? 0) + 1)
  }
  const queue = version.sections
    .filter((section) => indegrees.get(section.id) === 0)
    .map(({ id }) => id)
  const topologicalOrder: string[] = []
  while (queue.length > 0) {
    const sectionId = queue.shift()!
    topologicalOrder.push(sectionId)
    for (const targetId of adjacency.get(sectionId) ?? []) {
      const next = (indegrees.get(targetId) ?? 1) - 1
      indegrees.set(targetId, next)
      if (next === 0) queue.push(targetId)
    }
  }
  for (const section of version.sections) {
    if (!topologicalOrder.includes(section.id)) topologicalOrder.push(section.id)
  }

  const availableAtEntry = new Map<string, Set<string>>()
  const availableAtExit = new Map<string, Set<string>>()
  for (const sectionId of topologicalOrder) {
    const predecessorIds = [...(predecessors.get(sectionId) ?? [])]
    const entry =
      sectionId === version.firstSectionId
        ? new Set<string>()
        : intersection(
            predecessorIds.map((predecessorId) => availableAtExit.get(predecessorId) ?? new Set()),
          )
    availableAtEntry.set(sectionId, entry)
    const section = sectionsById.get(sectionId)
    availableAtExit.set(sectionId, new Set([...entry, ...(section?.questionIds ?? [])]))
  }

  version.sections.forEach((section) => {
    const available = new Set(availableAtEntry.get(section.id) ?? [])
    section.questionIds.forEach((questionId) => {
      const question = questionsById.get(questionId)
      if (question?.visibleWhen !== undefined) {
        validateConditionGroup(
          question.visibleWhen,
          available,
          questionsById,
          ['questions', questions.indexOf(question), 'visibleWhen'],
          errors,
        )
      }
      if (question !== undefined) available.add(question.id)
    })
  })

  version.transitions.forEach((transition, transitionIndex) => {
    if (transition.when === null) return
    validateConditionGroup(
      transition.when,
      availableAtExit.get(transition.fromSectionId) ?? new Set(),
      questionsById,
      ['transitions', transitionIndex, 'when'],
      errors,
    )
  })

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors }
}
