import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  FORM_SCHEMA_VERSION,
  buildFormAnswerSchema,
  evaluateCondition,
  evaluateConditionGroup,
  evaluateFormPath,
  projectReachableAnswers,
  toPublicFormVersion,
  validateFormGraph,
  type FormConditionGroup,
  type FormQuestion,
  type FormVersionDocument,
} from '../../../src/database/forms/public.ts'

const question = (
  id: string,
  sectionId: string,
  propertyId = id,
  overrides: Partial<FormQuestion> = {},
): FormQuestion => ({
  id,
  sectionId,
  property: { kind: 'PROPERTY', propertyId, propertyType: 'TEXT' },
  label: id,
  required: false,
  syncWithPropertyName: false,
  input: { kind: 'TEXT', multiline: false, maxLength: 200 },
  ...overrides,
})

const makeVersion = (): FormVersionDocument => ({
  schemaVersion: FORM_SCHEMA_VERSION,
  firstSectionId: 'section-1',
  presentation: {
    title: 'Form',
    submitButtonText: 'Submit',
    hideAnyNoteBranding: false,
  },
  sections: [
    { id: 'section-1', title: 'One', questionIds: ['question-1'] },
    { id: 'section-2', title: 'Two', questionIds: ['question-2'] },
  ],
  questions: [question('question-1', 'section-1'), question('question-2', 'section-2')],
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
      target: { kind: 'ENDING', endingId: 'ending-default' },
    },
  ],
  endings: [{ id: 'ending-default', title: 'Done' }],
})

const codes = (version: FormVersionDocument): string[] =>
  validateFormGraph(version).errors.map((error) => error.code)

const textEquals = (questionId: string, value = 'yes'): FormConditionGroup => ({
  kind: 'ALL',
  members: [{ kind: 'TEXT_EQUALS', questionId, value }],
})

describe('validateFormGraph', () => {
  it.each([
    [
      'section',
      (version: FormVersionDocument) => version.sections.push({ ...version.sections[0]! }),
    ],
    [
      'question',
      (version: FormVersionDocument) => version.questions.push({ ...version.questions[0]! }),
    ],
    [
      'transition',
      (version: FormVersionDocument) =>
        version.transitions.push({ ...version.transitions[0]!, priority: 10 }),
    ],
    ['ending', (version: FormVersionDocument) => version.endings.push({ ...version.endings[0]! })],
  ] as const)('rejects duplicate %s IDs', (_name, mutate) => {
    const version = makeVersion()
    mutate(version)

    expect(codes(version)).toContain(`DUPLICATE_${_name.toUpperCase()}_ID`)
  })

  it('rejects duplicate question IDs within a section', () => {
    const version = makeVersion()
    version.sections[0]!.questionIds.push('question-1')

    expect(codes(version)).toContain('DUPLICATE_SECTION_QUESTION_ID')
  })

  it.each([
    [
      'FIRST_SECTION_NOT_FOUND',
      (version: FormVersionDocument) => (version.firstSectionId = 'missing'),
    ],
    [
      'QUESTION_SECTION_NOT_FOUND',
      (version: FormVersionDocument) => (version.questions[0]!.sectionId = 'missing'),
    ],
    [
      'SECTION_QUESTION_NOT_FOUND',
      (version: FormVersionDocument) => version.sections[0]!.questionIds.push('missing'),
    ],
    [
      'TRANSITION_SECTION_NOT_FOUND',
      (version: FormVersionDocument) => (version.transitions[0]!.fromSectionId = 'missing'),
    ],
    [
      'TRANSITION_TARGET_SECTION_NOT_FOUND',
      (version: FormVersionDocument) => {
        version.transitions[0]!.target = { kind: 'SECTION', sectionId: 'missing' }
      },
    ],
    [
      'TRANSITION_TARGET_ENDING_NOT_FOUND',
      (version: FormVersionDocument) => {
        version.transitions[1]!.target = { kind: 'ENDING', endingId: 'missing' }
      },
    ],
  ] as const)('rejects unresolved graph references: %s', (expected, mutate) => {
    const version = makeVersion()
    mutate(version)

    expect(codes(version)).toContain(expected)
  })

  it('requires exactly one fallback and unique priorities per section', () => {
    const missing = makeVersion()
    missing.transitions[0]!.when = textEquals('question-1')
    expect(codes(missing)).toContain('MISSING_FALLBACK_TRANSITION')

    const multiple = makeVersion()
    multiple.transitions.push({
      ...multiple.transitions[0]!,
      id: 'transition-extra',
      priority: 1,
    })
    expect(codes(multiple)).toContain('MULTIPLE_FALLBACK_TRANSITIONS')

    const duplicatePriority = makeVersion()
    duplicatePriority.transitions.push({
      ...duplicatePriority.transitions[0]!,
      id: 'transition-extra',
      when: textEquals('question-1'),
    })
    expect(codes(duplicatePriority)).toContain('DUPLICATE_TRANSITION_PRIORITY')
  })

  it('considers every conditional edge when finding cycles', () => {
    const version = makeVersion()
    version.transitions.push({
      id: 'conditional-cycle',
      fromSectionId: 'section-2',
      priority: 1,
      when: textEquals('question-1'),
      target: { kind: 'SECTION', sectionId: 'section-1' },
    })

    expect(codes(version)).toContain('GRAPH_CYCLE')
  })

  it('rejects unreachable content and reachable sections without a path to an ending', () => {
    const unreachable = makeVersion()
    unreachable.sections.push({ id: 'section-unused', title: 'Unused', questionIds: [] })
    unreachable.transitions.push({
      id: 'transition-unused',
      fromSectionId: 'section-unused',
      priority: 0,
      when: null,
      target: { kind: 'ENDING', endingId: 'ending-unused' },
    })
    unreachable.endings.push({ id: 'ending-unused', title: 'Unused' })
    expect(codes(unreachable)).toEqual(
      expect.arrayContaining(['UNREACHABLE_SECTION', 'UNREACHABLE_ENDING']),
    )

    const deadEnd = makeVersion()
    deadEnd.transitions[1]!.target = { kind: 'SECTION', sectionId: 'section-2' }
    expect(codes(deadEnd)).toContain('SECTION_CANNOT_REACH_ENDING')
  })

  it('rejects duplicate property mappings and duplicate local option IDs', () => {
    const duplicateProperty = makeVersion()
    duplicateProperty.questions[1]!.property = duplicateProperty.questions[0]!.property
    expect(codes(duplicateProperty)).toContain('DUPLICATE_PROPERTY_QUESTION')

    const duplicateOption = makeVersion()
    duplicateOption.questions[0] = question('question-1', 'section-1', 'question-1', {
      property: { kind: 'PROPERTY', propertyId: 'question-1', propertyType: 'SELECT' },
      input: {
        kind: 'SINGLE_CHOICE',
        appearance: 'RADIO',
        options: [
          { id: 'option-1', label: 'One' },
          { id: 'option-1', label: 'Again' },
        ],
      },
    })
    expect(codes(duplicateOption)).toContain('DUPLICATE_OPTION_ID')
  })

  it('rejects every property valueType and input-kind mismatch without needing a condition', () => {
    const version = makeVersion()
    version.questions[0] = question('question-1', 'section-1', 'number', {
      property: { kind: 'PROPERTY', propertyId: 'number', propertyType: 'NUMBER' },
      input: { kind: 'TEXT', multiline: false, maxLength: 100 },
    })

    expect(codes(version)).toContain('QUESTION_INPUT_TYPE_MISMATCH')
  })

  it.each(['constructor', 'prototype', '__proto__'])(
    'reserves unsafe question ID %s across graph publication and raw answer parsing',
    (reservedId) => {
      const version = makeVersion()
      version.questions[0]!.id = reservedId
      version.sections[0]!.questionIds = [reservedId]

      const result = validateFormGraph(version)
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'RESERVED_QUESTION_ID',
          path: ['questions', 0, 'id'],
          entityId: reservedId,
        }),
      )

      const publicVersion = toPublicFormVersion(version)
      const rawEnvelope = JSON.parse(`{"answers":{${JSON.stringify(reservedId)}:"value"}}`)
      const parsed = buildFormAnswerSchema(publicVersion).safeParse(rawEnvelope)
      expect(parsed.success).toBe(false)
      if (!parsed.success) {
        expect(parsed.error.issues).toContainEqual(
          expect.objectContaining({
            path: ['answers', reservedId],
            message: 'DANGEROUS_OBJECT_KEY',
          }),
        )
      }
    },
  )

  it.each(['constructor-id', 'prototype_value', '___proto__'])(
    'accepts safe question ID similar to a reserved key: %s',
    (questionId) => {
      const version = makeVersion()
      version.questions[0]!.id = questionId
      version.sections[0]!.questionIds = [questionId]

      expect(validateFormGraph(version)).toEqual({ ok: true, errors: [] })
      const publicVersion = toPublicFormVersion(version)
      const rawEnvelope = JSON.parse(`{"answers":{${JSON.stringify(questionId)}:"value"}}`)
      expect(buildFormAnswerSchema(publicVersion).safeParse(rawEnvelope).success).toBe(true)
    },
  )

  it('validates condition question, ordering, value family and option snapshots', () => {
    const unknown = makeVersion()
    unknown.transitions.unshift({
      id: 'unknown-condition',
      fromSectionId: 'section-1',
      priority: 1,
      when: textEquals('missing'),
      target: { kind: 'ENDING', endingId: 'ending-default' },
    })
    expect(codes(unknown)).toContain('CONDITION_QUESTION_NOT_FOUND')

    const later = makeVersion()
    later.questions[0]!.visibleWhen = textEquals('question-2')
    expect(codes(later)).toContain('CONDITION_QUESTION_NOT_EARLIER')

    const incompatible = makeVersion()
    incompatible.questions[0] = question('question-1', 'section-1', 'number', {
      property: { kind: 'PROPERTY', propertyId: 'number', propertyType: 'NUMBER' },
      input: { kind: 'NUMBER' },
    })
    incompatible.transitions.unshift({
      id: 'bad-operator',
      fromSectionId: 'section-1',
      priority: 1,
      when: textEquals('question-1'),
      target: { kind: 'ENDING', endingId: 'ending-default' },
    })
    expect(codes(incompatible)).toContain('CONDITION_OPERATOR_INCOMPATIBLE')

    const missingOption = makeVersion()
    missingOption.questions[0] = question('question-1', 'section-1', 'select', {
      property: { kind: 'PROPERTY', propertyId: 'select', propertyType: 'SELECT' },
      input: {
        kind: 'SINGLE_CHOICE',
        appearance: 'RADIO',
        options: [{ id: 'option-1', label: 'One' }],
      },
    })
    missingOption.transitions.unshift({
      id: 'bad-option',
      fromSectionId: 'section-1',
      priority: 1,
      when: {
        kind: 'ALL',
        members: [{ kind: 'OPTION_IS', questionId: 'question-1', optionId: 'missing' }],
      },
      target: { kind: 'ENDING', endingId: 'ending-default' },
    })
    expect(codes(missingOption)).toContain('CONDITION_OPTION_NOT_FOUND')
  })

  it('requires a condition reference to be available on every predecessor path', () => {
    const version = makeVersion()
    version.sections.splice(1, 0, { id: 'section-alt', title: 'Alternate', questionIds: [] })
    version.transitions = [
      {
        id: 'conditional-alt',
        fromSectionId: 'section-1',
        priority: 0,
        when: textEquals('question-1'),
        target: { kind: 'SECTION', sectionId: 'section-2' },
      },
      {
        id: 'fallback-alt',
        fromSectionId: 'section-1',
        priority: 1,
        when: null,
        target: { kind: 'SECTION', sectionId: 'section-alt' },
      },
      {
        id: 'alt-to-two',
        fromSectionId: 'section-alt',
        priority: 0,
        when: null,
        target: { kind: 'SECTION', sectionId: 'section-2' },
      },
      {
        id: 'two-to-end',
        fromSectionId: 'section-2',
        priority: 0,
        when: null,
        target: { kind: 'ENDING', endingId: 'ending-default' },
      },
    ]
    version.questions[1]!.visibleWhen = textEquals('question-1')

    expect(validateFormGraph(version)).toEqual({ ok: true, errors: [] })

    version.questions[0]!.sectionId = 'section-alt'
    version.sections[0]!.questionIds = []
    version.sections[1]!.questionIds = ['question-1']
    expect(codes(version)).toContain('CONDITION_QUESTION_NOT_EARLIER')
  })

  it('accepts generated acyclic linear forms and evaluates their default ending', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (sectionCount) => {
        const sections = Array.from({ length: sectionCount }, (_, index) => ({
          id: `section-${index}`,
          title: `Section ${index}`,
          questionIds: [`question-${index}`],
        }))
        const questions = sections.map((section, index) =>
          question(`question-${index}`, section.id, `property-${index}`),
        )
        const transitions = sections.map((section, index) => ({
          id: `transition-${index}`,
          fromSectionId: section.id,
          priority: 0,
          when: null,
          target:
            index === sections.length - 1
              ? ({ kind: 'ENDING', endingId: 'ending-default' } as const)
              : ({ kind: 'SECTION', sectionId: sections[index + 1]!.id } as const),
        }))
        const version: FormVersionDocument = {
          ...makeVersion(),
          firstSectionId: sections[0]!.id,
          sections,
          questions,
          transitions,
        }

        expect(validateFormGraph(version)).toEqual({ ok: true, errors: [] })
        expect(evaluateFormPath(version, {})).toMatchObject({
          sectionIds: sections.map((section) => section.id),
          visibleQuestionIds: questions.map((item) => item.id),
          endingId: 'ending-default',
        })
      }),
    )
  })

  it('accepts generated branching DAGs with joins and evaluates them deterministically', () => {
    const branchingDag = fc
      .record({
        tailCount: fc.integer({ min: 0, max: 4 }),
        questionMask: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
        conditionalPriority: fc.integer({ min: 0, max: 20 }),
        fallbackPriority: fc.integer({ min: 0, max: 20 }),
        triggerValue: fc.constantFrom('a', 'b'),
      })
      .filter(
        ({ conditionalPriority, fallbackPriority }) => conditionalPriority !== fallbackPriority,
      )

    fc.assert(
      fc.property(branchingDag, (generated) => {
        const sectionIds = [
          'section-root',
          'section-a',
          'section-b',
          'section-join',
          ...Array.from({ length: generated.tailCount }, (_, index) => `section-tail-${index}`),
        ]
        const sections = sectionIds.map((id, index) => ({
          id,
          title: id,
          questionIds:
            id === 'section-root' || generated.questionMask[index % generated.questionMask.length]
              ? [`question-${id}`]
              : [],
        }))
        const questions = sections.flatMap((section, index) =>
          section.questionIds.map((id) => question(id, section.id, `property-${index}`)),
        )
        const tailIds = sectionIds.slice(4)
        const transitions: FormVersionDocument['transitions'] = [
          {
            id: 'transition-root-a',
            fromSectionId: 'section-root',
            priority: generated.conditionalPriority,
            when: textEquals('question-section-root', 'a'),
            target: { kind: 'SECTION', sectionId: 'section-a' },
          },
          {
            id: 'transition-root-b',
            fromSectionId: 'section-root',
            priority: generated.fallbackPriority,
            when: null,
            target: { kind: 'SECTION', sectionId: 'section-b' },
          },
          {
            id: 'transition-a-join',
            fromSectionId: 'section-a',
            priority: 0,
            when: null,
            target: { kind: 'SECTION', sectionId: 'section-join' },
          },
          {
            id: 'transition-b-join',
            fromSectionId: 'section-b',
            priority: 0,
            when: null,
            target: { kind: 'SECTION', sectionId: 'section-join' },
          },
          {
            id: 'transition-join',
            fromSectionId: 'section-join',
            priority: 0,
            when: null,
            target:
              tailIds.length === 0
                ? { kind: 'ENDING', endingId: 'ending-default' }
                : { kind: 'SECTION', sectionId: tailIds[0]! },
          },
          ...tailIds.map((sectionId, index) => ({
            id: `transition-tail-${index}`,
            fromSectionId: sectionId,
            priority: 0,
            when: null,
            target:
              index === tailIds.length - 1
                ? ({ kind: 'ENDING', endingId: 'ending-default' } as const)
                : ({ kind: 'SECTION', sectionId: tailIds[index + 1]! } as const),
          })),
        ]
        const version: FormVersionDocument = {
          ...makeVersion(),
          firstSectionId: 'section-root',
          sections,
          questions,
          transitions,
        }
        const answers = Object.fromEntries(
          questions.map(({ id }) => [
            id,
            id === 'question-section-root' ? generated.triggerValue : 'answer',
          ]),
        )

        expect(validateFormGraph(version)).toEqual({ ok: true, errors: [] })
        const firstEvaluation = evaluateFormPath(version, answers)
        expect(evaluateFormPath(version, answers)).toEqual(firstEvaluation)
        expect(firstEvaluation.endingId).toBe('ending-default')

        const publicVersion = toPublicFormVersion(version)
        const projected = projectReachableAnswers(publicVersion, answers)
        expect(projectReachableAnswers(publicVersion, projected)).toEqual(projected)
      }),
      { numRuns: 60, seed: 20_260_715 },
    )
  })
})

describe('evaluateFormPath', () => {
  it('orders conditionals before fallback and rejects corrupted cycles at runtime', () => {
    const version = makeVersion()
    version.transitions.push({
      id: 'conditional-end',
      fromSectionId: 'section-1',
      priority: 100,
      when: textEquals('question-1'),
      target: { kind: 'ENDING', endingId: 'ending-default' },
    })

    expect(evaluateFormPath(version, { 'question-1': 'yes' }).sectionIds).toEqual(['section-1'])

    version.transitions[0]!.target = { kind: 'SECTION', sectionId: 'section-1' }
    expect(() => evaluateFormPath(version, {})).toThrowError('FORM_GRAPH_CYCLE')
  })
})

describe('condition evaluation', () => {
  it('implements empty, text, number, date, checkbox and option operators', () => {
    expect(evaluateCondition({ kind: 'IS_EMPTY', questionId: 'q' }, { q: [] })).toBe(true)
    expect(evaluateCondition({ kind: 'IS_NOT_EMPTY', questionId: 'q' }, { q: 0 })).toBe(true)
    expect(
      evaluateCondition(
        { kind: 'TEXT_CONTAINS', questionId: 'q', value: 'note' },
        { q: 'AnyNote' },
      ),
    ).toBe(false)
    expect(
      evaluateCondition(
        { kind: 'TEXT_NOT_EQUALS', questionId: 'q', value: 'other' },
        { q: 'value' },
      ),
    ).toBe(true)
    expect(
      evaluateCondition(
        { kind: 'NUMBER_GREATER_THAN_OR_EQUAL', questionId: 'q', value: 10 },
        { q: 10 },
      ),
    ).toBe(true)
    expect(
      evaluateCondition(
        { kind: 'DATE_BEFORE', questionId: 'q', value: '2026-07-16T00:00:00Z' },
        { q: '2026-07-15T00:00:00Z' },
      ),
    ).toBe(true)
    expect(
      evaluateCondition({ kind: 'CHECKBOX_IS', questionId: 'q', value: false }, { q: false }),
    ).toBe(true)
    expect(
      evaluateCondition(
        { kind: 'OPTION_IS', questionId: 'q', optionId: 'option-a' },
        { q: 'option-a' },
      ),
    ).toBe(true)
    expect(
      evaluateCondition(
        { kind: 'OPTION_CONTAINS', questionId: 'q', optionId: 'option-a' },
        { q: ['option-a', 'option-b'] },
      ),
    ).toBe(true)
  })

  it('fails closed for wrong runtime types, including negative operators', () => {
    expect(
      evaluateCondition({ kind: 'TEXT_NOT_EQUALS', questionId: 'q', value: 'value' }, { q: 123 }),
    ).toBe(false)
    expect(
      evaluateCondition({ kind: 'NUMBER_NOT_EQUALS', questionId: 'q', value: 1 }, { q: '2' }),
    ).toBe(false)
    expect(
      evaluateCondition(
        { kind: 'DATE_AFTER', questionId: 'q', value: '2026-07-15T00:00:00Z' },
        { q: '1' },
      ),
    ).toBe(false)
    expect(
      evaluateCondition(
        { kind: 'OPTION_IS_NOT', questionId: 'q', optionId: 'option-a' },
        { q: ['option-b'] },
      ),
    ).toBe(false)
    expect(
      evaluateCondition(
        { kind: 'OPTION_NOT_CONTAINS', questionId: 'q', optionId: 'option-a' },
        { q: 'option-b' },
      ),
    ).toBe(false)
  })

  it('treats inherited and malformed empty-condition answers as missing or invalid', () => {
    const inherited = Object.create({ toString: 'inherited' }) as Record<string, unknown>
    expect(evaluateCondition({ kind: 'IS_EMPTY', questionId: 'toString' }, inherited)).toBe(true)
    expect(evaluateCondition({ kind: 'IS_NOT_EMPTY', questionId: 'toString' }, inherited)).toBe(
      false,
    )

    for (const malformed of [
      {},
      () => undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      [''],
      [1],
    ]) {
      expect(evaluateCondition({ kind: 'IS_EMPTY', questionId: 'q' }, { q: malformed })).toBe(false)
      expect(evaluateCondition({ kind: 'IS_NOT_EMPTY', questionId: 'q' }, { q: malformed })).toBe(
        false,
      )
    }

    for (const supported of ['value', 0, false, ['option-a']]) {
      expect(evaluateCondition({ kind: 'IS_NOT_EMPTY', questionId: 'q' }, { q: supported })).toBe(
        true,
      )
    }
  })

  it('evaluates nested ALL and ANY groups recursively', () => {
    expect(
      evaluateConditionGroup(
        {
          kind: 'ALL',
          members: [
            { kind: 'IS_NOT_EMPTY', questionId: 'q' },
            {
              kind: 'ANY',
              members: [
                { kind: 'TEXT_EQUALS', questionId: 'q', value: 'yes' },
                { kind: 'TEXT_EQUALS', questionId: 'q', value: 'okay' },
              ],
            },
          ],
        },
        { q: 'okay' },
      ),
    ).toBe(true)
  })
})
