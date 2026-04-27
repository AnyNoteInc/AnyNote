import { z } from 'zod'
import type { GenogramPageData } from '../types'

const Id = z.string().uuid()

const PartialDateSchema = z.object({
  year: z.number().int().optional(),
  month: z.number().int().min(1).max(12).optional(),
  day: z.number().int().min(1).max(31).optional(),
})

const ApproximateAgeSchema = z.union([
  z.object({ kind: z.literal('value'), value: z.number().int().nonnegative() }),
  z.object({
    kind: z.literal('range'),
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
  }),
])

const PersonIdentitySchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  middleName: z.string().optional(),
  maidenName: z.string().optional(),
  nickname: z.string().optional(),
  isUnknown: z.boolean().optional(),
})

const LifeDatesSchema = z.object({
  birthDate: PartialDateSchema.optional(),
  deathDate: PartialDateSchema.optional(),
  birthMode: z.enum(['date', 'approximate']),
  approximateAge: ApproximateAgeSchema.optional(),
  lifeStatus: z.enum(['alive', 'deceased', 'unknown']),
  tragically: z.boolean().optional(),
})

const CharacterTagSchema = z.union([
  z.object({ kind: z.literal('text'), value: z.string() }),
  z.object({ kind: z.literal('tag'), value: z.string() }),
])

const PersonProfileSchema = z.object({
  birthPlace: z.string().optional(),
  profession: z.string().optional(),
  characters: z.array(CharacterTagSchema).optional(),
  addictions: z.array(z.string()).optional(),
  diseases: z.array(z.string()).optional(),
  notes: z.string().optional(),
})

const PersonLabelConfigSchema = z.object({
  position: z.enum(['auto', 'left', 'right', 'top', 'bottom']).optional(),
  visibleFields: z
    .array(
      z.enum([
        'identity',
        'birthDate',
        'deathDate',
        'age',
        'birthPlace',
        'profession',
        'characters',
        'addictions',
        'diseases',
      ]),
    )
    .optional(),
  format: z.enum(['brief', 'full']).optional(),
  offset: z.object({ x: z.number(), y: z.number() }).optional(),
  hidden: z.boolean().optional(),
})

const PersonSchema = z.object({
  id: Id,
  sex: z.enum(['male', 'female']),
  role: z.enum(['owner', 'regular']),
  size: z.enum(['big', 'small']),
  bloodRelation: z.enum(['direct', 'partner', 'sibling', 'unknown']),
  partnerOrder: z.number().int().positive().optional(),
  identity: PersonIdentitySchema,
  lifeDates: LifeDatesSchema,
  profile: PersonProfileSchema,
  label: PersonLabelConfigSchema,
})

const UnionDivorceSchema = z.object({
  date: PartialDateSchema.optional(),
  custodySide: z.enum(['male', 'female', 'shared']).optional(),
  markPosition: z.number().min(0).max(1).optional(),
})

const UnionSchema = z.object({
  id: Id,
  kind: z.enum(['marriage', 'cohabitation']),
  malePartnerId: Id,
  femalePartnerId: Id,
  startDate: PartialDateSchema.optional(),
  endDate: PartialDateSchema.optional(),
  divorce: UnionDivorceSchema.optional(),
  childGroupId: Id.optional(),
})

const ChildEntrySchema = z.union([
  z.object({
    kind: z.literal('person'),
    personId: Id,
    birthGroupId: Id.optional(),
  }),
  z.object({
    kind: z.literal('loss'),
    lossId: Id,
  }),
])

const ChildGroupSchema = z.object({
  id: Id,
  unionId: Id,
  children: z.array(ChildEntrySchema),
})

const BirthGroupSchema = z.object({
  id: Id,
  kind: z.enum(['twins', 'fraternal']),
  memberIds: z.array(Id).min(2),
})

const PregnancyLossSchema = z.object({
  id: Id,
  kind: z.enum(['abortion', 'miscarriage']),
  childGroupId: Id,
  date: PartialDateSchema.optional(),
  note: z.string().optional(),
})

const AnnotationSchema = z.object({
  id: Id,
  targetId: Id.optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  text: z.string(),
})

const ViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
})

const LayoutMetadataSchema = z.object({
  mode: z.enum(['auto', 'manual', 'mixed']),
  positions: z.record(z.object({ x: z.number(), y: z.number() })).optional(),
  generations: z.record(z.number().int()).optional(),
  pinned: z.array(Id).optional(),
})

export const GenogramPageDataSchema = z.object({
  version: z.literal(1),
  entities: z.object({
    people: z.record(PersonSchema),
    unions: z.record(UnionSchema),
    childGroups: z.record(ChildGroupSchema),
    birthGroups: z.record(BirthGroupSchema),
    pregnancyLosses: z.record(PregnancyLossSchema),
  }),
  annotations: z.record(AnnotationSchema),
  layout: LayoutMetadataSchema.optional(),
  viewport: ViewportSchema.optional(),
})

export interface ValidationIssue {
  path: string[]
  message: string
  code: 'schema' | 'invariant'
}

export function validateSchema(input: unknown): ValidationIssue[] {
  const result = GenogramPageDataSchema.safeParse(input)
  if (result.success) return []
  return result.error.issues.map((i) => ({
    path: i.path.map((p) => String(p)),
    message: i.message,
    code: 'schema' as const,
  }))
}

export function parseGenogram(input: unknown): GenogramPageData {
  return GenogramPageDataSchema.parse(input) as GenogramPageData
}

export function safeParseGenogram(
  input: unknown,
): { ok: true; data: GenogramPageData } | { ok: false; issues: ValidationIssue[] } {
  const result = GenogramPageDataSchema.safeParse(input)
  if (result.success) return { ok: true, data: result.data as GenogramPageData }
  return { ok: false, issues: validateSchema(input) }
}
