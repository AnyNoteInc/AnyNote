import {
  formVersionDocumentSchema,
  validateFormGraph,
  type FormOptionSnapshot,
  type FormVersionDocument,
} from '@repo/domain/database/forms'

type IssuePath = Array<string | number>

export interface FormPublishReadinessIssue {
  code: string
  path: IssuePath
  entityId?: string
  transitionId?: string
  message: string
}

export interface FormPublishProperty {
  id: string
  type: string
  settings: unknown
  relationTargetWorkspaceId?: string | null
}

export interface FormPublishPlanFeatures {
  formConditionalLogicEnabled: boolean
  formCustomSlugEnabled: boolean
  formBrandingRemovalEnabled: boolean
}

export interface FormPublishReadinessInput {
  document: unknown
  properties: readonly FormPublishProperty[]
  sourceWorkspaceId: string
  audience: 'ANYONE_WITH_LINK' | 'SIGNED_IN_WITH_LINK' | 'WORKSPACE_MEMBERS_WITH_LINK'
  customSlug: string | null
  features: FormPublishPlanFeatures
}

export interface FormPublishReadinessResult {
  ok: boolean
  issues: FormPublishReadinessIssue[]
}

const INTERNAL_PROPERTY_TYPES = new Set(['PERSON', 'RELATION', 'PAGE_LINK'])

const issue = (
  code: string,
  path: IssuePath,
  message: string,
  entityId?: string,
): FormPublishReadinessIssue => ({
  code,
  path,
  ...(entityId === undefined ? {} : { entityId }),
  message,
})

const zodPath = (path: PropertyKey[]): IssuePath =>
  path.filter(
    (part): part is string | number => typeof part === 'string' || typeof part === 'number',
  )

const propertyOptions = (settings: unknown): FormOptionSnapshot[] | undefined => {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) return undefined
  const options = (settings as { options?: unknown }).options
  if (!Array.isArray(options)) return undefined

  const snapshots: FormOptionSnapshot[] = []
  for (const option of options) {
    if (option === null || typeof option !== 'object' || Array.isArray(option)) return undefined
    const { id, label, color } = option as { id?: unknown; label?: unknown; color?: unknown }
    if (
      typeof id !== 'string' ||
      typeof label !== 'string' ||
      (color !== undefined && color !== null && typeof color !== 'string')
    ) {
      return undefined
    }
    snapshots.push({ id, label, ...(typeof color === 'string' ? { color } : {}) })
  }
  return snapshots
}

const includesSnapshotOptionIds = (
  snapshot: readonly FormOptionSnapshot[],
  current: readonly FormOptionSnapshot[] | undefined,
): boolean =>
  current !== undefined &&
  snapshot.every((option) => current.some((currentOption) => currentOption.id === option.id))

const validateProperties = (
  document: FormVersionDocument,
  properties: readonly FormPublishProperty[],
  sourceWorkspaceId: string,
): FormPublishReadinessIssue[] => {
  const issues: FormPublishReadinessIssue[] = []
  const propertiesById = new Map(properties.map((property) => [property.id, property]))

  document.questions.forEach((question, questionIndex) => {
    if (question.property.kind === 'TITLE') return
    const path = ['questions', questionIndex, 'property'] satisfies IssuePath
    const property = propertiesById.get(question.property.propertyId)
    if (property === undefined) {
      issues.push(
        issue(
          'FORM_PROPERTY_NOT_FOUND',
          path,
          'The database property used by this question no longer exists.',
          question.id,
        ),
      )
      return
    }
    if (property.type !== question.property.propertyType) {
      issues.push(
        issue(
          'FORM_PROPERTY_TYPE_MISMATCH',
          [...path, 'propertyType'],
          'The database property type changed after this question was configured.',
          question.id,
        ),
      )
      return
    }
    if (property.type === 'RELATION') {
      if (property.relationTargetWorkspaceId == null) {
        issues.push(
          issue(
            'FORM_RELATION_TARGET_NOT_FOUND',
            [...path, 'propertyId'],
            'The relation target database no longer exists.',
            question.id,
          ),
        )
      } else if (property.relationTargetWorkspaceId !== sourceWorkspaceId) {
        issues.push(
          issue(
            'FORM_RELATION_TARGET_WORKSPACE_MISMATCH',
            [...path, 'propertyId'],
            'The relation target database belongs to another workspace.',
            question.id,
          ),
        )
      }
    }
    if (
      (question.input.kind === 'SINGLE_CHOICE' || question.input.kind === 'MULTI_CHOICE') &&
      !includesSnapshotOptionIds(question.input.options, propertyOptions(property.settings))
    ) {
      issues.push(
        issue(
          'FORM_PROPERTY_OPTIONS_MISMATCH',
          ['questions', questionIndex, 'input', 'options'],
          'One or more selected database options no longer exist.',
          question.id,
        ),
      )
    }
  })

  return issues
}

const validateAudience = (
  document: FormVersionDocument,
  audience: FormPublishReadinessInput['audience'],
): FormPublishReadinessIssue[] => {
  if (audience === 'WORKSPACE_MEMBERS_WITH_LINK') return []

  return document.questions.flatMap((question, questionIndex) =>
    question.property.kind === 'PROPERTY' &&
    INTERNAL_PROPERTY_TYPES.has(question.property.propertyType)
      ? [
          issue(
            'FORM_AUDIENCE_INCOMPATIBLE',
            ['questions', questionIndex, 'property', 'propertyType'],
            'This property can only be published to workspace members.',
            question.id,
          ),
        ]
      : [],
  )
}

const validatePlan = (
  document: FormVersionDocument,
  customSlug: string | null,
  features: FormPublishPlanFeatures,
): FormPublishReadinessIssue[] => {
  const issues: FormPublishReadinessIssue[] = []
  const hasConditionalTransition = document.transitions.some(({ when }) => when !== null)
  const hasConditionalQuestion = document.questions.some(
    ({ visibleWhen }) => visibleWhen !== undefined,
  )
  const hasConditionalFeatures =
    document.endings.length > 1 || hasConditionalQuestion || hasConditionalTransition

  if (hasConditionalFeatures && !features.formConditionalLogicEnabled) {
    const path: IssuePath = hasConditionalTransition
      ? ['transitions']
      : hasConditionalQuestion
        ? ['questions']
        : ['endings']
    issues.push(
      issue(
        'PLAN_CONDITIONAL_LOGIC_REQUIRED',
        path,
        'Conditional logic and multiple endings require a plan upgrade.',
      ),
    )
  }
  if (customSlug !== null && !features.formCustomSlugEnabled) {
    issues.push(
      issue(
        'PLAN_CUSTOM_SLUG_REQUIRED',
        ['customSlug'],
        'A custom form address requires a plan upgrade.',
      ),
    )
  }
  if (document.presentation.hideAnyNoteBranding && !features.formBrandingRemovalEnabled) {
    issues.push(
      issue(
        'PLAN_BRANDING_REMOVAL_REQUIRED',
        ['presentation', 'hideAnyNoteBranding'],
        'Removing AnyNote branding requires a plan upgrade.',
      ),
    )
  }

  return issues
}

export function validateFormPublishReadiness({
  document: input,
  properties,
  sourceWorkspaceId,
  audience,
  customSlug,
  features,
}: FormPublishReadinessInput): FormPublishReadinessResult {
  const parsed = formVersionDocumentSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((zodIssue) =>
        issue('FORM_SCHEMA_INVALID', zodPath(zodIssue.path), zodIssue.message),
      ),
    }
  }

  const graph = validateFormGraph(parsed.data)
  const issues: FormPublishReadinessIssue[] = graph.errors.map((graphIssue) => {
    const transitionIndex =
      graphIssue.path[0] === 'transitions' && typeof graphIssue.path[1] === 'number'
        ? graphIssue.path[1]
        : undefined
    const transition =
      transitionIndex === undefined ? undefined : parsed.data.transitions[transitionIndex]
    const hasSourceSection =
      transition !== undefined &&
      parsed.data.sections.some(({ id }) => id === transition.fromSectionId)
    return {
      code: graphIssue.code,
      path: graphIssue.path,
      ...(hasSourceSection
        ? { entityId: transition.fromSectionId, transitionId: transition.id }
        : graphIssue.entityId === undefined
          ? {}
          : { entityId: graphIssue.entityId }),
      message: graphIssue.message,
    }
  })

  issues.push(...validateProperties(parsed.data, properties, sourceWorkspaceId))
  issues.push(...validateAudience(parsed.data, audience))
  issues.push(...validatePlan(parsed.data, customSlug, features))

  return { ok: issues.length === 0, issues }
}
