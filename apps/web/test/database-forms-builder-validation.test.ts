import { describe, expect, it } from 'vitest'

import type { FormVersionDocument } from '@repo/domain/database/forms'

import { validateFormPublishReadiness } from '@/components/database/forms/form-builder-validation'

const features = {
  formConditionalLogicEnabled: true,
  formCustomSlugEnabled: true,
  formBrandingRemovalEnabled: true,
}

function documentFixture(): FormVersionDocument {
  return {
    schemaVersion: 1,
    firstSectionId: 'section-1',
    presentation: {
      title: 'Contact',
      submitButtonText: 'Send',
      hideAnyNoteBranding: false,
    },
    sections: [{ id: 'section-1', title: 'Questions', questionIds: ['question-1'] }],
    questions: [
      {
        id: 'question-1',
        sectionId: 'section-1',
        property: { kind: 'PROPERTY', propertyId: 'property-1', propertyType: 'TEXT' },
        label: 'Name',
        required: false,
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
    endings: [{ id: 'ending-1', title: 'Done' }],
  }
}

const textProperty = { id: 'property-1', type: 'TEXT', settings: null }

function validate(
  document: unknown,
  overrides: Partial<Parameters<typeof validateFormPublishReadiness>[0]> = {},
) {
  return validateFormPublishReadiness({
    document,
    properties: [textProperty],
    audience: 'ANYONE_WITH_LINK',
    customSlug: null,
    features,
    ...overrides,
  })
}

describe('validateFormPublishReadiness', () => {
  it('accepts a valid linear public form', () => {
    expect(validate(documentFixture())).toEqual({ ok: true, issues: [] })
  })

  it('returns strict schema issue paths without trying graph validation', () => {
    const document = { ...documentFixture(), unexpected: true }

    const result = validate(document)

    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'FORM_SCHEMA_INVALID', path: [] }),
    )
  })

  it('preserves graph issue codes, paths, and entity ids', () => {
    const document = { ...documentFixture(), firstSectionId: 'missing' }

    const result = validate(document)

    expect(result.issues).toContainEqual({
      code: 'FIRST_SECTION_NOT_FOUND',
      path: ['firstSectionId'],
      message: expect.any(String),
    })
  })

  it('detects removed and type-changed database properties', () => {
    const missing = validate(documentFixture(), { properties: [] })
    const changed = validate(documentFixture(), {
      properties: [{ id: 'property-1', type: 'NUMBER', settings: null }],
    })

    expect(missing.issues).toContainEqual(
      expect.objectContaining({
        code: 'FORM_PROPERTY_NOT_FOUND',
        path: ['questions', 0, 'property'],
        entityId: 'question-1',
      }),
    )
    expect(changed.issues).toContainEqual(
      expect.objectContaining({
        code: 'FORM_PROPERTY_TYPE_MISMATCH',
        path: ['questions', 0, 'property', 'propertyType'],
        entityId: 'question-1',
      }),
    )
  })

  it('accepts persisted option additions, renames, colors and reordering when snapshot ids remain', () => {
    const document: FormVersionDocument = {
      ...documentFixture(),
      questions: [
        {
          ...documentFixture().questions[0]!,
          property: { kind: 'PROPERTY', propertyId: 'property-1', propertyType: 'SELECT' },
          input: {
            kind: 'SINGLE_CHOICE',
            appearance: 'RADIO',
            options: [
              { id: 'red', label: 'Red', color: '#f00' },
              { id: 'blue', label: 'Blue' },
            ],
          },
        },
      ],
    }

    const result = validate(document, {
      properties: [
        {
          id: 'property-1',
          type: 'SELECT',
          settings: {
            options: [
              { id: 'new', label: 'New database option', color: '#0f0' },
              { id: 'blue', label: 'Renamed blue', color: '#00f' },
              { id: 'red', label: 'Renamed red', color: null },
            ],
          },
        },
      ],
    })

    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('rejects a choice snapshot only when one of its persisted option ids was removed', () => {
    const document: FormVersionDocument = {
      ...documentFixture(),
      questions: [
        {
          ...documentFixture().questions[0]!,
          property: { kind: 'PROPERTY', propertyId: 'property-1', propertyType: 'SELECT' },
          input: {
            kind: 'SINGLE_CHOICE',
            appearance: 'RADIO',
            options: [
              { id: 'red', label: 'Red' },
              { id: 'blue', label: 'Blue' },
            ],
          },
        },
      ],
    }
    const result = validate(document, {
      properties: [
        {
          id: 'property-1',
          type: 'SELECT',
          settings: { options: [{ id: 'red', label: 'Red' }] },
        },
      ],
    })

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'FORM_PROPERTY_OPTIONS_MISMATCH',
        path: ['questions', 0, 'input', 'options'],
        entityId: 'question-1',
      }),
    )
  })

  it('maps transition graph issues to their source section and retains the transition id', () => {
    const document = documentFixture()
    document.transitions[0]!.target = { kind: 'ENDING', endingId: 'missing-ending' }

    const result = validate(document)

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'TRANSITION_TARGET_ENDING_NOT_FOUND',
        entityId: 'section-1',
        transitionId: 'transition-1',
      }),
    )
  })

  it('keeps fallback issues section-scoped and maps priority and condition issues to cards', () => {
    const document = documentFixture()
    document.transitions = [
      {
        id: 'transition-number-condition',
        fromSectionId: 'section-1',
        priority: 0,
        when: {
          kind: 'ALL',
          members: [{ kind: 'NUMBER_EQUALS', questionId: 'question-1', value: 1 }],
        },
        target: { kind: 'ENDING', endingId: 'ending-1' },
      },
      {
        id: 'transition-duplicate-priority',
        fromSectionId: 'section-1',
        priority: 0,
        when: { kind: 'ALL', members: [{ kind: 'IS_NOT_EMPTY', questionId: 'question-1' }] },
        target: { kind: 'ENDING', endingId: 'ending-1' },
      },
    ]

    const result = validate(document)

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_FALLBACK_TRANSITION', entityId: 'section-1' }),
        expect.objectContaining({
          code: 'DUPLICATE_TRANSITION_PRIORITY',
          entityId: 'section-1',
          transitionId: 'transition-duplicate-priority',
        }),
        expect.objectContaining({
          code: 'CONDITION_OPERATOR_INCOMPATIBLE',
          entityId: 'section-1',
          transitionId: 'transition-number-condition',
        }),
      ]),
    )
  })

  it.each(['ANYONE_WITH_LINK', 'SIGNED_IN_WITH_LINK'] as const)(
    'rejects internal property kinds for %s',
    (audience) => {
      const document: FormVersionDocument = {
        ...documentFixture(),
        questions: [
          {
            ...documentFixture().questions[0]!,
            property: { kind: 'PROPERTY', propertyId: 'property-1', propertyType: 'PERSON' },
            input: { kind: 'PERSON', maxSelections: 1 },
          },
        ],
      }

      const result = validate(document, {
        audience,
        properties: [{ id: 'property-1', type: 'PERSON', settings: null }],
      })

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'FORM_AUDIENCE_INCOMPATIBLE',
          path: ['questions', 0, 'property', 'propertyType'],
          entityId: 'question-1',
        }),
      )
    },
  )

  it('applies the conditional-logic gate to conditional transitions and multiple endings', () => {
    const document: FormVersionDocument = {
      ...documentFixture(),
      transitions: [
        {
          id: 'transition-conditional',
          fromSectionId: 'section-1',
          priority: 1,
          when: {
            kind: 'ALL',
            members: [{ kind: 'TEXT_EQUALS', questionId: 'question-1', value: 'yes' }],
          },
          target: { kind: 'ENDING', endingId: 'ending-2' },
        },
        ...documentFixture().transitions,
      ],
      endings: [...documentFixture().endings, { id: 'ending-2', title: 'Alternate' }],
    }

    const result = validate(document, {
      features: { ...features, formConditionalLogicEnabled: false },
    })

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'PLAN_CONDITIONAL_LOGIC_REQUIRED', path: ['transitions'] }),
    )
  })

  it('applies branding-removal and custom-slug plan gates independently', () => {
    const document: FormVersionDocument = {
      ...documentFixture(),
      presentation: { ...documentFixture().presentation, hideAnyNoteBranding: true },
    }

    const result = validate(document, {
      customSlug: 'contact-us',
      features: {
        ...features,
        formCustomSlugEnabled: false,
        formBrandingRemovalEnabled: false,
      },
    })

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PLAN_CUSTOM_SLUG_REQUIRED', path: ['customSlug'] }),
        expect.objectContaining({
          code: 'PLAN_BRANDING_REMOVAL_REQUIRED',
          path: ['presentation', 'hideAnyNoteBranding'],
        }),
      ]),
    )
  })
})
