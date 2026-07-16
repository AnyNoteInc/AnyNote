# Database Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioned Notion-style database forms to AnyNote, with a protected builder, an A2 public renderer at `/f/{key-or-slug}`, React Hook Form client validation, independently compiled server Zod validation, reCAPTCHA, atomic row creation, files, respondent access, notifications and webhooks.

**Architecture:** Keep a FORM database view as the UI entry point and store lifecycle/routing in `DatabaseForm`, immutable published JSON in `DatabaseFormVersion`, provenance in `DatabaseFormSubmission`, and pending uploads in `DatabaseFormUpload`. Put pure form-document, graph and answer-schema code behind the client-safe `@repo/domain/database/forms` export; keep Prisma repositories and services inside the domain container; expose management procedures under `database.*` and public procedures under `form.*`.

**Tech Stack:** Prisma 7/PostgreSQL, TypeScript 6, Inversify domain services, tRPC 11, Next.js 16 App Router, React 19, React Hook Form 7.81, `@hookform/resolvers` 5.4, Zod 4.4, MUI 9, Google reCAPTCHA v3, S3-compatible `@repo/storage`, Vitest/Jest/Playwright.

**Design specification:** `docs/superpowers/specs/2026-07-15-database-forms-design.md` is authoritative for product decisions, security invariants, stored document shape and the approved A2 presentation.

---

## Delivery shape

This is one integrated feature, but execution is split into four merge-safe phases:

1. **Foundation:** schema, pure form compiler, graph evaluator, file-array compatibility and plan flags.
2. **Management:** persistence services, lifecycle, protected APIs and the database form builder.
3. **Collection:** public access, CAPTCHA/tokens/rate limits, A2 renderer, uploads and atomic submission.
4. **Operations:** respondent access, notifications/webhooks/audit, cleanup, E2E coverage and rollout.

Do not expose `/f/*` in production until all four phases and the final gates pass. During development, keep the route unavailable unless `DatabaseForm.state=OPEN` and a published version exists.

## File map

### Database and shared contracts

- Modify `packages/db/prisma/schema.prisma`: add FORM enum value, form enums/models, reverse relations and `FORM_SUBMITTED` notification type.
- Create `packages/db/prisma/migrations/20260715170000_database_forms/migration.sql`: create all form tables/indexes/FKs, migrate legacy FILE JSON strings to arrays and add enum values.
- Modify `packages/db/src/index.ts`: export generated enums and form model types.
- Create `packages/db/test/database-forms-schema.test.ts`: generated-client and migration-contract smoke tests.
- Modify `packages/db/prisma/seed.ts`: enable advanced form tokens on Pro and Max plans.

### Pure domain compiler

- Create `packages/domain/src/database/forms/form-document.ts`: versioned Zod document, question/input/condition/endings types and hard limits.
- Create `packages/domain/src/database/forms/form-graph.ts`: publication graph validation and deterministic path evaluation.
- Create `packages/domain/src/database/forms/form-answer-schema.ts`: dynamic Zod compiler, reachable-answer projection and public DTO sanitization.
- Create `packages/domain/src/database/forms/public.ts`: client-safe exports only.
- Modify `packages/domain/package.json`: explicit `./database/forms` export and direct `fast-check` dev dependency.
- Create tests under `packages/domain/test/database/forms/` for document bounds, graph properties and every answer type.

### Domain persistence and services

- Create `packages/domain/src/database/forms/database-form.repository.ts`: all form/version/submission/upload persistence on the active UnitOfWork client.
- Create `packages/domain/src/database/forms/database-form.service.ts`: protected lifecycle, settings, optimistic drafts, publication and response listing.
- Create `packages/domain/src/database/forms/form-access-resolver.ts`: public availability/audience/policy and own-response authority.
- Create `packages/domain/src/database/forms/form-submission.service.ts`: server validation, idempotency and atomic create/update transactions.
- Create `packages/domain/src/database/forms/form-audit.ts`: audit action catalog and metadata builder.
- Create `packages/domain/src/database/forms/database-forms.tokens.ts` and `database-forms.module.ts`: DI wiring.
- Create `packages/domain/src/database/forms/index.ts`: server-side domain exports.
- Modify `packages/domain/src/database/database.module.ts`, `database.tokens.ts`, `database/index.ts`, `container.ts`: register and expose form services.
- Modify `packages/domain/src/database/services/database.service.ts` and `repositories/database.repository.ts`: FORM view guard, FILE arrays, property dependency guard and nullable form-response actor path.
- Modify `packages/domain/src/shared/item-page-creator.ts` and `packages/domain/src/pages/repositories/pages.repository.ts`: permit a null actor only for the focused item-page creation port.

### tRPC and server protections

- Create `packages/trpc/src/routers/database/form.ts`: protected management procedures.
- Modify `packages/trpc/src/routers/database/index.ts`, `view.ts` and `cell.ts`: merge form management, delegate FORM view behavior and validate FILE arrays.
- Create `packages/trpc/src/routers/form.ts`: public schema/submit/picker and own-response procedures.
- Create `packages/trpc/src/helpers/form-version-token.ts`: HMAC version token signer/verifier.
- Create `packages/trpc/src/helpers/form-captcha.ts`: Google reCAPTCHA v3 verifier.
- Create `packages/trpc/src/helpers/form-rate-limit.ts`: injectable bounded sliding-window limiter.
- Create `packages/trpc/src/helpers/form-notify.ts`: post-commit owner notification fan-out.
- Modify `packages/trpc/src/index.ts`: mount `formRouter` and export server helpers used by the multipart upload route.
- Add focused integration tests under `packages/trpc/test/database-forms-*.test.ts` and helper unit tests.

### Protected builder UI

- Modify `apps/web/src/components/database/database-view-tabs.tsx`, `database-page-renderer.tsx` and `types.ts`: create/select/dispatch FORM views.
- Create `apps/web/src/components/database/forms/form-builder.tsx`: data loading, optimistic autosave and panel orchestration.
- Create `apps/web/src/components/database/forms/form-outline-panel.tsx`: ordered sections/endings and add/reorder actions.
- Create `apps/web/src/components/database/forms/form-preview-canvas.tsx`: selected-section preview using the shared renderer.
- Create `apps/web/src/components/database/forms/form-settings-panel.tsx`: question/section/ending/transition editors.
- Create `apps/web/src/components/database/forms/form-share-panel.tsx`: audience, access, link, slug, schedule, limit, branding and publish controls.
- Create `apps/web/src/components/database/forms/form-responses-panel.tsx`: keyset response list opening the existing row modal.
- Create `apps/web/src/components/database/forms/form-builder-state.ts`: reducer and conflict-safe draft helpers.
- Add focused component tests under `apps/web/test/database-forms-*.test.tsx`.

### Public renderer and uploads

- Modify `apps/web/package.json` and `pnpm-lock.yaml`: direct `react-hook-form@7.81.0` and `@hookform/resolvers@5.4.0` dependencies.
- Create `apps/web/src/app/(form)/layout.tsx`: public form layout, runtime reCAPTCHA provider and noindex metadata.
- Create `apps/web/src/app/(form)/f/[key]/page.tsx`: server schema lookup and unavailable states.
- Create `apps/web/src/app/(form)/f/[key]/form-page-client.tsx`: public-page controller and success transition.
- Create `apps/web/src/app/(form)/f/[key]/responses/[submissionId]/page.tsx`: signed-in own-response page.
- Create `apps/web/src/components/forms/form-renderer.tsx`: React Hook Form orchestration and section navigation.
- Create `apps/web/src/components/forms/form-field.tsx`: scalar and choice fields.
- Create `apps/web/src/components/forms/form-internal-picker.tsx`: PERSON/RELATION/PAGE_LINK lazy picker.
- Create `apps/web/src/components/forms/form-upload-field.tsx`: leased multipart file upload.
- Create `apps/web/src/components/forms/form-section-map.tsx`, `form-ending.tsx` and `form-unavailable.tsx`: A2 presentation states.
- Create `apps/web/src/lib/form-draft-storage.ts`: seven-day version-scoped browser draft storage/remapping.
- Create `apps/web/src/app/api/forms/[locator]/uploads/route.ts`: CAPTCHA-protected multipart upload lease.
- Add renderer, draft, accessibility and route tests under `apps/web/test/forms/` and `apps/web/test/api-form-uploads.test.ts`.

### Integrations, cleanup and rollout

- Modify `packages/notifications` catalog/templates/tests and Prisma notification enum for `FORM_SUBMITTED`.
- Modify `packages/webhooks/src/catalog.ts`, `payload.ts`, `worker/fan-out.ts` and tests for `database.form.submitted` metadata-only delivery.
- Modify `apps/engines/src/apps/cleanup/cleanup.service.ts` and its test: hourly expired form-upload cleanup against the main Prisma database and S3.
- Modify `.env.example`, `deploy/.env.example`, `deploy/.env.template`, `compose.yml`, `deploy/compose.yml`, `turbo.json` and CI/release/deploy workflows for `FORM_TOKEN_SECRET`.
- Create `apps/e2e/database-forms.spec.ts`: end-to-end builder, public, branch, audience, file and respondent-access coverage.

## Canonical cross-layer contracts

Use these names unchanged across domain, tRPC and web so later tasks do not invent parallel DTOs:

```ts
export type PublicFormQuestion = Omit<FormQuestion, 'property'> & {
  valueType: FormPropertyType | 'TITLE'
}

export type PublicFormVersion = Omit<FormVersionDocument, 'questions'> & {
  questions: PublicFormQuestion[]
}

export type FormAnswerEnvelope = {
  answers: Record<string, unknown>
}

export type PublishedFormDto =
  | {
      status: 'OPEN'
      version: PublicFormVersion
      versionFingerprint: string
      versionToken: string
      respondentKind: 'anonymous' | 'authenticated'
    }
  | { status: 'SCHEDULED'; opensAt: string }
  | { status: 'CLOSED' | 'CAPPED' | 'AUTH_REQUIRED' | 'POLICY_DISABLED' | 'UNAVAILABLE' }

export type SubmitFormInput = {
  locator: string
  versionToken: string
  idempotencyKey: string
  answers: Record<string, unknown>
  honeypot: string
}

export type SubmitFormResult = {
  submissionId: string
  endingId: string
  ownResponseUrl: string | null
  created: boolean
}
```

Domain service names and public method names are fixed:

```ts
DatabaseFormService.create(actorUserId, input)
DatabaseFormService.updateDraft(actorUserId, input)
DatabaseFormService.publish(actorUserId, input)
DatabaseFormService.updateSettings(actorUserId, input)
DatabaseFormService.setSlug(actorUserId, input)
DatabaseFormService.rotateKey(actorUserId, input)
DatabaseFormService.close(actorUserId, input)
DatabaseFormService.reopen(actorUserId, input)
DatabaseFormService.archive(actorUserId, input)
DatabaseFormService.duplicateByView(actorUserId, input)
FormAccessResolver.resolvePublished(locator, actorUserId)
FormAccessResolver.resolveOwnResponse(locator, submissionId, actorUserId)
FormSubmissionService.findReplay(actorUserId, input, tokenPayload)
FormSubmissionService.submit(actorUserId, input, tokenPayload)
FormSubmissionService.updateOwnResponse(actorUserId, input)
```

The locator schema is shared by management/public inputs:

```ts
export const formLocatorSchema = z.string().trim().min(3).max(64)
```

---

## Phase 1 — foundation

### Task 1: Persist forms, versions, submissions and upload leases

**Files:**

- Modify: `packages/db/prisma/schema.prisma:292-325,496-560,1094-1135,1172-1200,1599-1810`
- Create: `packages/db/prisma/migrations/20260715170000_database_forms/migration.sql`
- Modify: `packages/db/src/index.ts:35-115`
- Create: `packages/db/test/database-forms-schema.test.ts`

- [ ] **Step 1: Write the failing generated-client contract test**

```ts
import { describe, expect, it } from 'vitest'
import {
  DatabaseFormAudience,
  DatabaseFormRespondentAccess,
  DatabaseFormState,
  DatabaseViewType,
  NotificationEventType,
} from '../src/index.ts'

describe('database forms generated contract', () => {
  it('exports the form enums used across domain and tRPC', () => {
    expect(DatabaseViewType.FORM).toBe('FORM')
    expect(DatabaseFormState.OPEN).toBe('OPEN')
    expect(DatabaseFormAudience.ANYONE_WITH_LINK).toBe('ANYONE_WITH_LINK')
    expect(DatabaseFormRespondentAccess.EDIT).toBe('EDIT')
    expect(NotificationEventType.FORM_SUBMITTED).toBe('FORM_SUBMITTED')
  })
})
```

- [ ] **Step 2: Run the test and record the expected red state**

Run: `pnpm --filter @repo/db exec vitest run test/database-forms-schema.test.ts`

Expected: FAIL because the generated enums do not contain FORM/form models yet.

- [ ] **Step 3: Add the Prisma schema contract**

Add `FORM` to `DatabaseViewType`, `FORM_SUBMITTED` to `NotificationEventType`, the three form enums and the four models from the approved specification. Use named relations so current publication and history cannot collide:

```prisma
publishedVersion DatabaseFormVersion?  @relation("CurrentDatabaseFormVersion", fields: [publishedVersionId], references: [id], onDelete: SetNull)
versions         DatabaseFormVersion[] @relation("DatabaseFormVersions")

form           DatabaseForm  @relation("DatabaseFormVersions", fields: [formId], references: [id], onDelete: Cascade)
currentForForm DatabaseForm? @relation("CurrentDatabaseFormVersion")
```

Add these required inverse relations:

```prisma
// DatabaseSource
forms DatabaseForm[]

// DatabaseView
form DatabaseForm?

// DatabaseRow
formSubmission DatabaseFormSubmission?

// File
formUpload DatabaseFormUpload?
```

Use the exact unique/index contract:

```prisma
@@unique([formId, versionNumber])
@@unique([formId, idempotencyKey])
@@index([formId, submittedAt(sort: Desc)])
@@index([respondentUserId, submittedAt(sort: Desc)])
@@index([formId, versionId, questionId])
@@index([expiresAt, consumedAt])
```

- [ ] **Step 4: Write the forward migration including legacy FILE conversion**

After creating enums/tables/indexes/FKs matching Prisma, include this idempotent data conversion:

```sql
UPDATE "database_cell_values" AS c
SET "value" = jsonb_build_array(c."value")
FROM "database_properties" AS p
WHERE p."id" = c."property_id"
  AND p."type" = 'FILE'
  AND jsonb_typeof(c."value") = 'string'
  AND c."value" <> '""'::jsonb;
```

Do not convert SQL NULL, JSON null, empty arrays or already-array values.

- [ ] **Step 5: Export the new generated runtime enums and model types**

```ts
export {
  DatabaseFormAudience,
  DatabaseFormRespondentAccess,
  DatabaseFormState,
} from '@prisma/client'

export type {
  DatabaseForm,
  DatabaseFormVersion,
  DatabaseFormSubmission,
  DatabaseFormUpload,
} from '@prisma/client'
```

- [ ] **Step 6: Validate, generate and rerun the focused test**

Run:

```bash
pnpm --filter @repo/db exec prisma validate
pnpm --filter @repo/db prisma:generate
pnpm --filter @repo/db exec vitest run test/database-forms-schema.test.ts
```

Expected: Prisma schema valid; client generation succeeds; 1 test passes.

- [ ] **Step 7: Verify the migration against fresh and legacy fixtures**

Run a disposable test database twice: once empty, once with one FILE string, one FILE array and one null value. Apply all migrations, then verify:

```sql
SELECT p.type, jsonb_typeof(c.value) AS value_type, COUNT(*)
FROM database_cell_values c
JOIN database_properties p ON p.id = c.property_id
WHERE p.type = 'FILE'
GROUP BY p.type, jsonb_typeof(c.value);
```

Expected: every non-null FILE cell reports `value_type = array`.

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260715170000_database_forms/migration.sql packages/db/src/index.ts packages/db/test/database-forms-schema.test.ts
git commit -m "feat(db): add database form persistence"
```

### Task 2: Define the client-safe versioned form document

**Files:**

- Create: `packages/domain/src/database/forms/form-document.ts`
- Create: `packages/domain/src/database/forms/public.ts`
- Modify: `packages/domain/package.json`
- Create: `packages/domain/test/database/forms/form-document.test.ts`

- [ ] **Step 1: Add failing bounds and audience-safe document tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  formVersionDocumentSchema,
  MAX_FORM_QUESTIONS,
} from '../../../src/database/forms/public.ts'

describe('formVersionDocumentSchema', () => {
  it('accepts one section, one text question, fallback ending', () => {
    expect(formVersionDocumentSchema.safeParse(makeLinearTextForm()).success).toBe(true)
  })

  it('rejects a document above the question bound', () => {
    const doc = makeLinearTextForm()
    doc.questions = Array.from({ length: MAX_FORM_QUESTIONS + 1 }, (_, i) => ({
      ...doc.questions[0]!,
      id: `q-${i}`,
    }))
    expect(formVersionDocumentSchema.safeParse(doc).success).toBe(false)
  })
})
```

The test helper must construct a complete schema-version-1 document, not cast an incomplete object.

- [ ] **Step 2: Run the test to verify the module is missing**

Run: `pnpm --filter @repo/domain exec vitest run test/database/forms/form-document.test.ts`

Expected: FAIL with an unresolved `database/forms/public.ts` import.

- [ ] **Step 3: Add exact constants and discriminated contracts**

```ts
export const FORM_SCHEMA_VERSION = 1 as const
export const MAX_FORM_SECTIONS = 100
export const MAX_FORM_QUESTIONS = 500
export const MAX_FORM_TRANSITIONS = 1_000
export const MAX_FORM_CONDITION_DEPTH = 8
export const MAX_FORM_DOCUMENT_BYTES = 512 * 1024
export const MAX_FORM_SUBMIT_BYTES = 1024 * 1024

export const FORM_PROPERTY_TYPES = [
  'TEXT',
  'NUMBER',
  'STATUS',
  'SELECT',
  'MULTI_SELECT',
  'CHECKBOX',
  'DATE',
  'PERSON',
  'FILE',
  'URL',
  'EMAIL',
  'PHONE',
  'RELATION',
  'PAGE_LINK',
] as const
export type FormPropertyType = (typeof FORM_PROPERTY_TYPES)[number]

export type FormPropertyRef =
  { kind: 'TITLE' } | { kind: 'PROPERTY'; propertyId: string; propertyType: FormPropertyType }

export type FormTransitionTarget =
  { kind: 'SECTION'; sectionId: string } | { kind: 'ENDING'; endingId: string }
```

Define the full `FormInputConfig`, `FormCondition`, `FormConditionGroup`, `FormQuestion`, `FormSection`, `FormTransition`, `FormEnding` and `FormVersionDocument` unions exactly as the design specification. Every union must use `z.discriminatedUnion`; every ID is `z.string().min(1).max(64)`; titles/labels/descriptions and redirect URLs have explicit length bounds.

Use `z.enum(FORM_PROPERTY_TYPES)` rather than importing the Prisma runtime enum. Server code compares these string literals with generated enum values; client-safe files never import `@repo/db`.

- [ ] **Step 4: Validate unsafe redirects and serialized size in one exported parser**

```ts
export function parseFormVersionDocument(input: unknown): FormVersionDocument {
  const document = formVersionDocumentSchema.parse(input)
  const bytes = new TextEncoder().encode(JSON.stringify(document)).byteLength
  if (bytes > MAX_FORM_DOCUMENT_BYTES) {
    throw new z.ZodError([{ code: 'custom', path: [], message: 'FORM_DOCUMENT_TOO_LARGE', input }])
  }
  return document
}
```

Ending buttons accept relative AnyNote paths beginning with `/` or HTTPS URLs only. Reject `http:`, protocol-relative, `javascript:`, `data:` and credentials in URLs.

- [ ] **Step 5: Expose only pure code from the package subpath**

Add an explicit export before the wildcard in `packages/domain/package.json`:

```json
"./database/forms": {
  "types": "./src/database/forms/public.ts",
  "import": "./src/database/forms/public.ts",
  "default": "./src/database/forms/public.ts"
}
```

`public.ts` exports only document types/schemas and later graph/answer functions. It must not import Prisma, Node crypto, repositories, Inversify or the domain container.

- [ ] **Step 6: Run focused tests and architecture check**

Run:

```bash
pnpm --filter @repo/domain exec vitest run test/database/forms/form-document.test.ts
pnpm --filter @repo/domain check-types
pnpm check-architecture
```

Expected: focused tests pass; no client-safe export crosses a server boundary.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/package.json packages/domain/src/database/forms/form-document.ts packages/domain/src/database/forms/public.ts packages/domain/test/database/forms/form-document.test.ts
git commit -m "feat(domain): define database form documents"
```

### Task 3: Validate branching graphs and compile dynamic answer schemas

**Files:**

- Create: `packages/domain/src/database/forms/form-graph.ts`
- Create: `packages/domain/src/database/forms/form-answer-schema.ts`
- Modify: `packages/domain/src/database/forms/public.ts`
- Modify: `packages/domain/package.json`
- Create: `packages/domain/test/database/forms/form-graph.test.ts`
- Create: `packages/domain/test/database/forms/form-answer-schema.test.ts`

- [ ] **Step 1: Add failing graph tests including generated acyclic forms**

Add `fast-check@3.23.2` as a direct domain dev dependency, then write tests that cover duplicate IDs, missing targets, cycles, unreachable sections, missing/multiple fallback transitions, invalid condition ordering and every reachable section reaching an ending.

```ts
fc.assert(
  fc.property(linearFormArbitrary, (document) => {
    expect(validateFormGraph(document)).toEqual({ ok: true, errors: [] })
    expect(evaluateFormPath(document, {}).endingId).toBe('ending-default')
  }),
)
```

- [ ] **Step 2: Add failing dynamic validation tests for every value family**

Use a table test for TEXT, NUMBER, SINGLE_CHOICE, MULTI_CHOICE, CHECKBOX, DATE, URL, EMAIL, PHONE, FILE, PERSON, RELATION and PAGE_LINK. Include required/optional, invalid option IDs, min/max selections, unreachable extra answers and required-consent false.

```ts
const schema = buildFormAnswerSchema(makePublicForm({ question: emailQuestion }))
expect(schema.safeParse({ answers: { 'q-email': 'not-an-email' } }).success).toBe(false)
expect(schema.safeParse({ answers: { 'q-email': 'person@example.com' } }).success).toBe(true)
```

- [ ] **Step 3: Run both suites and confirm the red state**

Run:

```bash
pnpm --filter @repo/domain exec vitest run test/database/forms/form-graph.test.ts
pnpm --filter @repo/domain exec vitest run test/database/forms/form-answer-schema.test.ts
```

Expected: FAIL because graph and answer compiler exports do not exist.

- [ ] **Step 4: Implement typed conditions and deterministic path evaluation**

```ts
export type EvaluatedFormPath = {
  sectionIds: string[]
  visibleQuestionIds: string[]
  endingId: string
}

export function evaluateFormPath(
  document: PublicFormVersion,
  answers: Record<string, unknown>,
): EvaluatedFormPath {
  const sections: string[] = []
  const visible = new Set<string>()
  let current = document.firstSectionId

  while (true) {
    sections.push(current)
    const section = requireSection(document, current)
    for (const questionId of section.questionIds) {
      const question = requireQuestion(document, questionId)
      if (!question.visibleWhen || evaluateConditionGroup(question.visibleWhen, answers)) {
        visible.add(questionId)
      }
    }
    const transition = orderedTransitions(document, current).find(
      (candidate) => !candidate.when || evaluateConditionGroup(candidate.when, answers),
    )!
    if (transition.target.kind === 'ENDING') {
      return {
        sectionIds: sections,
        visibleQuestionIds: [...visible],
        endingId: transition.target.endingId,
      }
    }
    current = transition.target.sectionId
  }
}
```

`validateFormGraph` performs all publication checks before this function is callable; the evaluator still uses a visited-set guard and throws `FORM_GRAPH_CYCLE` for corrupted stored data.

- [ ] **Step 5: Implement the dynamic Zod compiler and reachable projection**

```ts
export const buildFormAnswerSchema = (version: PublicFormVersion) =>
  z.object({ answers: z.record(z.string(), z.unknown()) }).superRefine(({ answers }, ctx) => {
    const path = evaluateFormPath(version, answers)
    const allowed = new Set(path.visibleQuestionIds)
    for (const key of Object.keys(answers)) {
      if (!allowed.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['answers', key], message: 'UNREACHABLE_ANSWER' })
      }
    }
    for (const questionId of path.visibleQuestionIds) {
      validateQuestionValue(requireQuestion(version, questionId), answers[questionId], ctx)
    }
  })

export function projectReachableAnswers(
  version: PublicFormVersion,
  answers: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set(evaluateFormPath(version, answers).visibleQuestionIds)
  return Object.fromEntries(Object.entries(answers).filter(([key]) => allowed.has(key)))
}
```

FILE answers are lease bearer tokens, never raw File IDs. PERSON, RELATION and PAGE_LINK remain opaque target IDs until asynchronous server semantic validation.

- [ ] **Step 6: Add stored-to-public sanitization**

```ts
export function toPublicFormVersion(stored: FormVersionDocument): PublicFormVersion {
  return {
    schemaVersion: stored.schemaVersion,
    firstSectionId: stored.firstSectionId,
    presentation: stored.presentation,
    sections: stored.sections,
    questions: stored.questions.map(({ property, ...question }) => ({
      ...question,
      valueType: property.kind === 'TITLE' ? 'TEXT' : property.propertyType,
    })),
    transitions: stored.transitions,
    endings: stored.endings,
  }
}
```

Assert in tests that serialized public JSON contains no `propertyId`, `sourceId`, `pageId` or hidden property name.

- [ ] **Step 7: Run tests, type checks and commit**

Run:

```bash
pnpm --filter @repo/domain exec vitest run test/database/forms/form-graph.test.ts test/database/forms/form-answer-schema.test.ts
pnpm --filter @repo/domain check-types
```

Expected: all form compiler tests pass.

```bash
git add packages/domain/package.json packages/domain/src/database/forms packages/domain/test/database/forms pnpm-lock.yaml
git commit -m "feat(domain): compile database form flows"
```

### Task 4: Add form plan flags and make FILE cells arrays everywhere

**Files:**

- Modify: `packages/domain/src/billing/dto/billing.dto.ts`
- Modify: `packages/domain/src/billing/repositories/billing.repository.ts`
- Modify: `packages/domain/test/billing/services/billing.service.test.ts`
- Modify: `packages/db/prisma/seed.ts`
- Modify: `packages/domain/src/database/services/database.service.ts:810-870`
- Modify: `packages/domain/src/database/repositories/database.repository.ts:604-620`
- Modify: `packages/trpc/src/routers/database/cell.ts:25-65`
- Modify: `apps/web/src/components/database/cell-editors/file-cell.tsx`
- Modify: `apps/web/test/server/database-table.test.ts`
- Create: `apps/web/test/database-file-cell.test.tsx`

- [ ] **Step 1: Add failing plan-feature and FILE-array tests**

```ts
expect(
  features({ raw: ['forms:conditional', 'forms:customSlug', 'forms:hideBranding'] }),
).toMatchObject({
  formConditionalLogicEnabled: true,
  formCustomSlugEnabled: true,
  formBrandingRemovalEnabled: true,
})
```

Add database service/router tests that accept `['file-a', 'file-b']`, reject non-string/duplicate IDs, and accept a legacy string only on reads. Add a FileCell test that renders two chips and removes only the selected ID.

- [ ] **Step 2: Run focused suites and confirm failures**

Run:

```bash
pnpm --filter @repo/domain exec vitest run test/billing/services/billing.service.test.ts test/database/services/database.service.test.ts
pnpm --filter @repo/trpc exec vitest run test/database-rich.test.ts
pnpm --filter web exec vitest run test/database-file-cell.test.tsx
```

Expected: FAIL on missing plan fields and scalar-only FILE validation/UI.

- [ ] **Step 3: Parse form flags without hard-coded plan slugs**

```ts
export function hasPlanFeature(features: unknown, token: string): boolean {
  return Array.isArray(features) && features.some((entry) => entry === token)
}

formConditionalLogicEnabled: hasPlanFeature(plan.features, 'forms:conditional'),
formCustomSlugEnabled: hasPlanFeature(plan.features, 'forms:customSlug'),
formBrandingRemovalEnabled: hasPlanFeature(plan.features, 'forms:hideBranding'),
```

Add all three tokens to Pro and Max seed arrays; Personal remains false.

- [ ] **Step 4: Normalize FILE values to a unique string array**

```ts
case DatabasePropertyType.FILE: {
  if (!Array.isArray(raw) || raw.some((value) => typeof value !== 'string' || value === '')) {
    throw badRequest('Ожидался список файлов')
  }
  const values = raw as string[]
  if (new Set(values).size !== values.length) throw badRequest('Файлы не должны повторяться')
  return values
}
```

Update repository value types to `string[]`, tRPC existence checking to fetch every ID in the current workspace and require an exact count, and FileCell to coerce legacy string to `[value]` while writing arrays only.

- [ ] **Step 5: Verify export/read compatibility**

`stringifyCellValue` already joins arrays. Add an assertion that two file IDs export in stable order and that legacy strings still export unchanged.

- [ ] **Step 6: Run focused and package checks**

Run:

```bash
pnpm --filter @repo/domain test
pnpm --filter @repo/trpc exec vitest run test/database-rich.test.ts test/plan.test.ts
pnpm --filter web exec vitest run test/database-file-cell.test.tsx test/server/database-table.test.ts
pnpm --filter @repo/domain check-types
pnpm --filter @repo/trpc check-types
pnpm --filter web check-types
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/seed.ts packages/domain/src/billing packages/domain/src/database packages/domain/test packages/trpc/src/routers/database/cell.ts packages/trpc/test apps/web/src/components/database/cell-editors/file-cell.tsx apps/web/test pnpm-lock.yaml
git commit -m "feat(database): add form plan flags and multi-file cells"
```

---

## Phase 2 — management and builder

### Task 5: Add form persistence repositories, shared access checks and DI wiring

**Files:**

- Create: `packages/domain/src/database/forms/database-form.repository.ts`
- Create: `packages/domain/src/database/forms/database-forms.tokens.ts`
- Create: `packages/domain/src/database/forms/database-forms.module.ts`
- Create: `packages/domain/src/database/forms/index.ts`
- Create: `packages/domain/src/database/services/database-structure-access.ts`
- Modify: `packages/domain/src/database/services/database.service.ts:125-185`
- Modify: `packages/domain/src/database/database.module.ts`
- Modify: `packages/domain/src/database/database.tokens.ts`
- Modify: `packages/domain/src/database/index.ts`
- Modify: `packages/domain/src/container.ts:20-135`
- Create: `packages/domain/test/database/forms/database-form.repository.test.ts`
- Create: `packages/domain/test/database/services/database-structure-access.test.ts`

- [ ] **Step 1: Extract the existing structure-edit authority under tests**

Write tests for the exact current policy: OWNER/ADMIN always pass; the source-page creator passes only when unlocked; EDITOR/VIEWER/non-creator fail; missing source is NOT_FOUND.

```ts
await expect(assertCanEditDatabaseStructure(repo, 'owner', source)).resolves.toBeUndefined()
await expect(
  assertCanEditDatabaseStructure(repo, 'creator', { ...source, structureLocked: true }),
).rejects.toMatchObject({ code: 'FORBIDDEN' })
```

- [ ] **Step 2: Run the access test and confirm the missing module**

Run: `pnpm --filter @repo/domain exec vitest run test/database/services/database-structure-access.test.ts`

Expected: FAIL because `database-structure-access.ts` does not exist.

- [ ] **Step 3: Extract and reuse the helper without changing existing behavior**

```ts
export async function assertCanEditDatabaseStructure(
  repo: Pick<DatabaseRepository, 'findWorkspaceRole'>,
  actorUserId: string,
  source: SourceWithLock,
): Promise<void> {
  const role = await repo.findWorkspaceRole(actorUserId, source.workspaceId)
  if (role === 'OWNER' || role === 'ADMIN') return
  if (!source.structureLocked && source.pageCreatedById === actorUserId) return
  throw forbidden(
    source.structureLocked
      ? 'Структура заблокирована'
      : 'Недостаточно прав для изменения структуры',
  )
}
```

Replace `DatabaseService.assertCanEditStructure` calls with this helper and rerun existing database service tests before adding forms.

- [ ] **Step 4: Define the repository surface and write failing active-UnitOfWork tests**

The repository exposes these exact operations:

```ts
export interface FormRepositoryContract {
  createFormWithView(input: CreateFormRecord): Promise<ManagedFormRecord>
  findManagedForm(pageId: string, formId: string): Promise<ManagedFormRecord | null>
  listManagedForms(pageId: string): Promise<ManagedFormRecord[]>
  updateDraftIfRevision(input: UpdateFormDraftRecord): Promise<ManagedFormRecord | null>
  publishVersion(input: PublishFormVersionRecord): Promise<ManagedFormRecord>
  updateSettings(input: UpdateFormSettingsRecord): Promise<ManagedFormRecord>
  duplicateForm(input: DuplicateFormRecord): Promise<ManagedFormRecord>
  archiveForm(input: ArchiveFormRecord): Promise<void>
  listVersions(formId: string): Promise<FormVersionRecord[]>
  listResponses(input: ListFormResponsesRecord): Promise<FormResponsePage>
  findByLocator(locator: string): Promise<PublicFormRecord | null>
  findVersion(formId: string, versionNumber: number): Promise<FormVersionRecord | null>
  findSubmission(submissionId: string): Promise<FormSubmissionRecord | null>
  findSubmissionByIdempotency(formId: string, key: string): Promise<FormSubmissionRecord | null>
  hasProtectedPropertyDependency(propertyId: string, now: Date): Promise<boolean>
}
```

Repository tests must prove every write uses `uow.client()` and therefore joins the service transaction. Include keyset response pagination ordered by `(submittedAt DESC, id DESC)`.

- [ ] **Step 5: Implement focused Prisma selects and no-row schema reads**

`findManagedForm` selects source/page/workspace/creator/lock, form settings, current version and properties, but never database rows. `findByLocator` selects only the fields needed for availability plus current/grace versions, workspace policy and membership lookup inputs. Do not use `include: true` for large relations.

Use locator lookup with one OR branch:

```ts
where: {
  OR: [{ routeKey: locator }, { customSlug: locator.toLowerCase() }],
}
```

- [ ] **Step 6: Register the repository token without binding unfinished services**

```ts
export const DATABASE_FORMS = {
  Repository: Symbol.for('domain/DatabaseFormRepository'),
} as const
```

Bind only `DatabaseFormRepository` in this task. Keep `@repo/domain/database/forms` client-safe and expose the repository type through the server/root domain barrel only. Service tokens and `Domain` properties are added in the task that introduces each concrete class, so every intermediate commit compiles.

- [ ] **Step 7: Run repository, access, existing database and architecture tests**

Run:

```bash
pnpm --filter @repo/domain exec vitest run test/database/services/database-structure-access.test.ts test/database/forms/database-form.repository.test.ts test/database/services/database.service.test.ts
pnpm --filter @repo/domain check-types
pnpm check-architecture
```

Expected: all commands exit 0 and existing database permissions remain unchanged.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/database packages/domain/src/container.ts packages/domain/test/database
git commit -m "feat(domain): add database form repository"
```

### Task 6: Implement form lifecycle, publication and property dependency guards

**Files:**

- Create: `packages/domain/src/database/forms/database-form.dto.ts`
- Create: `packages/domain/src/database/forms/form-audit.ts`
- Create: `packages/domain/src/database/forms/database-form.service.ts`
- Modify: `packages/domain/src/database/forms/database-forms.module.ts`
- Modify: `packages/domain/src/database/forms/database-forms.tokens.ts`
- Modify: `packages/domain/src/database/forms/index.ts`
- Modify: `packages/domain/src/container.ts`
- Modify: `packages/domain/src/database/services/database.service.ts:500-760`
- Modify: `packages/domain/src/database/repositories/database.repository.ts`
- Create: `packages/domain/test/database/forms/database-form.service.test.ts`
- Modify: `packages/domain/test/database/services/database.service.test.ts`

- [ ] **Step 1: Add failing lifecycle tests**

Cover:

- create form and FORM view atomically with an `anf_` route key;
- multiple forms on one source;
- stale `draftRevision` returns CONFLICT;
- first publish changes DRAFT to OPEN and creates version 1;
- republish creates version 2, preserves state and sets version 1 `acceptUntil=now+24h`;
- published version rows are append-only and their JSON is immutable;
- graph/property/audience/plan failures create no version;
- custom slug normalization/reserved names/uniqueness;
- key/slug changes increment `linkRevision`;
- schedule/limit/access invariants;
- `acceptedResponses` is historical, increments once per accepted submission and never decrements after row deletion;
- duplicate creates a fresh DRAFT without slug/version/submission/count;
- archive clears `viewId` and preserves rows/submissions;
- destructive property changes fail while current/grace versions depend on them.

```ts
await expect(
  service.updateDraft('owner', { formId: 'form-1', pageId: 'page-1', expectedRevision: 3, schema }),
).rejects.toMatchObject({ code: 'CONFLICT', message: 'FORM_DRAFT_CONFLICT' })
```

- [ ] **Step 2: Run lifecycle tests and confirm the missing service**

Run: `pnpm --filter @repo/domain exec vitest run test/database/forms/database-form.service.test.ts`

Expected: FAIL because `DatabaseFormService` is not implemented.

- [ ] **Step 3: Define management inputs and normalized results**

```ts
export const updateFormSettingsInput = z.object({
  pageId: z.string().uuid(),
  formId: z.string().uuid(),
  audience: z.nativeEnum(DatabaseFormAudience),
  respondentAccess: z.nativeEnum(DatabaseFormRespondentAccess),
  opensAt: z.coerce.date().nullable(),
  closesAt: z.coerce.date().nullable(),
  responseLimit: z.number().int().positive().nullable(),
  notifyOwners: z.boolean(),
})

export const customSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
```

Reject slugs beginning `anf_` and reserved application routes including `app`, `api`, `auth`, `login`, `signup`, `settings`, `admin`, `s`, `f` and `forms`.
Persist every accepted custom slug normalized lowercase; never preserve caller casing.

Generate route keys only on the server:

```ts
export function newFormRouteKey(): string {
  return `anf_${randomBytes(32).toString('base64url')}`
}
```

- [ ] **Step 4: Implement publication as one domain transaction**

```ts
async publish(actorUserId: string, input: PublishFormInput): Promise<PublishedFormResult> {
  const form = await this.requireManageableForm(actorUserId, input)
  const document = parseFormVersionDocument(form.draftSchema)
  const graph = validateFormGraph(document)
  if (!graph.ok) throw badRequest('FORM_GRAPH_INVALID', { errors: graph.errors })
  await this.assertPropertyDependencies(form, document)
  await this.assertAudienceCompatibility(form.audience, document)
  await this.assertPlanFeatures(form.source.workspaceId, document)
  const now = this.clock.now()
  return this.uow.transaction(() =>
    this.repo.publishVersion({ formId: form.id, document, actorUserId, now, graceUntil: addHours(now, 24) }),
  )
}
```

Compute `schemaHash` from canonical JSON with sorted object keys. Never hash `JSON.stringify` output whose key order depends on mutation history.

Bind `DatabaseFormService` as `DATABASE_FORMS.Service`, inject `DatabaseFormRepository`, the shared UnitOfWork and `BillingService`, and expose it as `Domain.databaseForms`. Do not bind access/submission services yet.

- [ ] **Step 5: Enforce feature flags and soft downgrade**

Publishing checks `formConditionalLogicEnabled`, `formCustomSlugEnabled` and `formBrandingRemovalEnabled`. Existing published advanced versions remain loadable after downgrade; only a new advanced publication or gated setting change fails with `PLAN_UPGRADE_REQUIRED`.

- [ ] **Step 6: Add audit writes inside each lifecycle transaction**

Use these action strings:

```ts
export const FORM_AUDIT = {
  CREATED: 'database_form.created',
  PUBLISHED: 'database_form.published',
  OPENED: 'database_form.opened',
  CLOSED: 'database_form.closed',
  ARCHIVED: 'database_form.archived',
  SETTINGS_CHANGED: 'database_form.settings_changed',
  SLUG_CHANGED: 'database_form.slug_changed',
  KEY_ROTATED: 'database_form.key_rotated',
} as const
```

Write every event to the existing `WorkspaceAuditLog` inside the same lifecycle transaction. Audit metadata contains form/view IDs, version number and changed setting names only; exclude schema, labels, answers, emails, file tokens and route key values.

- [ ] **Step 7: Guard generic view/property operations**

- `createView(type=FORM)` throws `FORM_REQUIRES_CREATE_FORM`.
- FORM duplicate/archive routes call `DatabaseFormService`.
- delete/type-change/relation-target-change/removal of referenced option IDs calls `hasProtectedPropertyDependency(propertyId, now)` and throws `FORM_PROPERTY_IN_USE`.
- option additions and label-only renames stay allowed.

- [ ] **Step 8: Run lifecycle and regression tests**

Run:

```bash
pnpm --filter @repo/domain exec vitest run test/database/forms/database-form.service.test.ts test/database/services/database.service.test.ts
pnpm --filter @repo/domain check-types
```

Expected: all lifecycle and pre-existing database tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/domain/src/database packages/domain/test/database
git commit -m "feat(domain): implement database form lifecycle"
```

### Task 7: Expose the protected management API and FORM view behavior

**Files:**

- Create: `packages/trpc/src/routers/database/form.ts`
- Modify: `packages/trpc/src/routers/database/index.ts`
- Modify: `packages/trpc/src/routers/database/view.ts`
- Create: `packages/trpc/test/database-forms-management.test.ts`
- Modify: `packages/trpc/test/database-views.test.ts`

- [ ] **Step 1: Add failing real-database management tests**

Seed OWNER, ADMIN, source creator, EDITOR and VIEWER callers. Assert the complete procedure surface:

```ts
const created = await owner.createForm({ pageId, title: 'Обратная связь' })
await owner.updateFormDraft({ pageId, formId: created.formId, expectedRevision: 1, schema })
const published = await owner.publishForm({ pageId, formId: created.formId })
expect(published).toMatchObject({ state: 'OPEN', versionNumber: 1 })
```

Test `getForm`, `listForms`, `updateFormSettings`, `setFormSlug`, `rotateFormKey`, `closeForm`, `reopenForm`, `archiveForm`, `listFormVersions` and keyset `listFormResponses`. Assert public settings mutations require source creator or OWNER/ADMIN and ordinary draft structure edits use the shared structure authority.

- [ ] **Step 2: Run the management test and confirm missing procedures**

Run: `pnpm --filter @repo/trpc exec vitest run test/database-forms-management.test.ts`

Expected: FAIL because `database.createForm` and related procedures are absent.

- [ ] **Step 3: Add the dedicated router with page-level and domain checks**

```ts
export const formManagementRouter = router({
  create: protectedProcedure.input(createFormInput).mutation(async ({ ctx, input }) => {
    await assertPageEditAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.databaseForms.create(ctx.user.id, input))
  }),
  updateDraft: protectedProcedure.input(updateFormDraftInput).mutation(async ({ ctx, input }) => {
    await assertPageEditAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.databaseForms.updateDraft(ctx.user.id, input))
  }),
  publish: protectedProcedure.input(publishFormInput).mutation(async ({ ctx, input }) => {
    await assertPageEditAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.databaseForms.publish(ctx.user.id, input))
  }),
})
```

Add every named procedure from the design specification; do not accept raw workspace/source/property IDs from the client when page/form IDs suffice.

- [ ] **Step 4: Merge procedures under the existing flat `database.*` namespace**

```ts
createForm: formManagementRouter.create,
getForm: formManagementRouter.get,
listForms: formManagementRouter.list,
updateFormDraft: formManagementRouter.updateDraft,
publishForm: formManagementRouter.publish,
updateFormSettings: formManagementRouter.updateSettings,
setFormSlug: formManagementRouter.setSlug,
rotateFormKey: formManagementRouter.rotateKey,
closeForm: formManagementRouter.close,
reopenForm: formManagementRouter.reopen,
archiveForm: formManagementRouter.archive,
listFormVersions: formManagementRouter.listVersions,
listFormResponses: formManagementRouter.listResponses,
```

- [ ] **Step 5: Delegate generic FORM duplicate/delete operations**

In `viewRouter.duplicate/delete`, resolve the view type first. TABLE/BOARD/CALENDAR/LIST retain existing behavior. FORM calls the form service so the fresh-key/no-history duplicate and archive invariants are atomic. Keep the embedded-database reference check before archive.

- [ ] **Step 6: Run management, view and authorization tests**

Run:

```bash
pnpm --filter @repo/trpc exec vitest run test/database-forms-management.test.ts test/database-views.test.ts test/database-access.test.ts
pnpm --filter @repo/trpc check-types
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/trpc/src/routers/database packages/trpc/test/database-forms-management.test.ts packages/trpc/test/database-views.test.ts
git commit -m "feat(trpc): expose database form management"
```

### Task 8: Build the FORM tab, three-panel builder and shared preview renderer

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/src/components/database/database-view-tabs.tsx`
- Modify: `apps/web/src/components/database/database-page-renderer.tsx`
- Modify: `apps/web/src/components/database/database-item-modal.tsx`
- Modify: `apps/web/src/components/database/types.ts`
- Create: `apps/web/src/components/database/forms/form-builder-state.ts`
- Create: `apps/web/src/components/database/forms/form-builder.tsx`
- Create: `apps/web/src/components/database/forms/form-outline-panel.tsx`
- Create: `apps/web/src/components/database/forms/form-preview-canvas.tsx`
- Create: `apps/web/src/components/database/forms/form-settings-panel.tsx`
- Create: `apps/web/src/components/database/forms/form-share-panel.tsx`
- Create: `apps/web/src/components/database/forms/form-responses-panel.tsx`
- Create: `apps/web/src/components/forms/form-renderer.tsx`
- Create: `apps/web/src/components/forms/form-field.tsx`
- Create: `apps/web/src/components/forms/form-section-map.tsx`
- Create: `apps/web/test/database-forms-builder-state.test.ts`
- Create: `apps/web/test/database-forms-builder.test.tsx`

- [ ] **Step 1: Install direct renderer dependencies**

Run:

```bash
pnpm --filter web add react-hook-form@7.81.0 @hookform/resolvers@5.4.0
```

Expected: `apps/web/package.json` has both direct dependencies and `pnpm-lock.yaml` resolves one React Hook Form version compatible with React 19 and Zod 4.

- [ ] **Step 2: Add failing builder reducer tests**

Test section/question/endings add, reorder and delete; stable local IDs; selected-item fallback; optimistic revision conflict; transition fallback preservation; and `syncWithPropertyName` rename intent.

```ts
const state = reduceBuilder(initialBuilderState(document), {
  type: 'QUESTION_MOVED',
  questionId: 'q-email',
  sectionId: 'section-details',
  index: 0,
})
expect(state.document.sections[1]!.questionIds[0]).toBe('q-email')
expect(state.dirty).toBe(true)
```

- [ ] **Step 3: Add failing component tests for FORM dispatch and publishing**

Render `DatabaseViewTabs` with a FORM view and assert the icon/title/menu. Render `FormBuilder` with mocked tRPC and assert three panels, inline graph errors, preview, share panel, disabled publish on invalid graph, and conflict UI after a stale revision.

- [ ] **Step 4: Run the tests and confirm the red state**

Run:

```bash
pnpm --filter web exec vitest run test/database-forms-builder-state.test.ts test/database-forms-builder.test.tsx
```

Expected: FAIL because FORM dispatch and builder components do not exist.

- [ ] **Step 5: Add FORM to tabs without sending it through generic createView**

```ts
function addView(type: DatabaseViewType) {
  setAddAnchor(null)
  if (type === 'FORM') {
    createForm.mutate({ pageId, title: DEFAULT_VIEW_TITLE.FORM })
    return
  }
  createView.mutate({ pageId, type, title: DEFAULT_VIEW_TITLE[type] })
}
```

Add `FORM` to exhaustive icon/title maps and dispatch it to `<FormBuilder pageId={pageId} formViewId={view.id} />`.

- [ ] **Step 6: Implement conflict-safe autosave**

The reducer owns the last server revision and dirty state. Debounce 700 ms; send `{ expectedRevision, schema }`; on success replace the revision and mark clean only if no newer local edit exists; on CONFLICT stop autosave and show Reload/Copy local JSON actions.

```ts
const saveGeneration = generationRef.current
const result = await updateDraft.mutateAsync({ pageId, formId, expectedRevision, schema: document })
if (generationRef.current === saveGeneration)
  dispatch({ type: 'SAVE_CONFIRMED', revision: result.draftRevision })
```

- [ ] **Step 7: Implement the desktop-only three-panel builder**

- Left: sections, endings, counts, add/reorder and selected state.
- Centre: `FormPreviewCanvas` using `FormRenderer` with `mode="preview"` and submission disabled.
- Right: selected question/section/ending controls and prioritized transitions.
- Header: saved/conflict state, preview, responses, share and publish.

At widths below the supported desktop breakpoint, show a concise “Откройте конструктор на компьютере” state without mutation controls; mobile form building is deferred. Preserve the approved A2 open-document preview canvas instead of a floating white card.

- [ ] **Step 8: Implement share and response panels**

Share panel binds every server setting, copies generated URL, rotates key with confirmation, feature-gates slug/branding/branch controls from `usePlanFeatures`, and distinguishes published versus unpublished state. Responses use cursor pagination and open the existing `DatabaseItemModal`.

Add an optional `rowOverride?: DatabaseRowView` prop to `DatabaseItemModal`; when supplied, it wins over the active-view cache lookup. `FormResponsesPanel` passes the selected response row as `rowOverride`, so a response beyond the first generic `listRows` page still opens reliably. The normal table/board/calendar/list callers omit it and retain current behavior.

- [ ] **Step 9: Run UI tests, lint, types and commit**

Run:

```bash
pnpm --filter web exec vitest run test/database-forms-builder-state.test.ts test/database-forms-builder.test.tsx
pnpm --filter web lint
pnpm --filter web check-types
```

Expected: all commands exit 0.

```bash
git add apps/web/package.json apps/web/src/components/database apps/web/src/components/forms apps/web/test/database-forms-builder-state.test.ts apps/web/test/database-forms-builder.test.tsx pnpm-lock.yaml
git commit -m "feat(web): add database form builder"
```

---

## Phase 3 — public collection and atomic submission

### Task 9: Add signed version tokens, reCAPTCHA verification and rate limits

**Files:**

- Create: `packages/trpc/src/helpers/form-version-token.ts`
- Create: `packages/trpc/src/helpers/form-captcha.ts`
- Create: `packages/trpc/src/helpers/form-rate-limit.ts`
- Create: `packages/trpc/test/form-version-token.test.ts`
- Create: `packages/trpc/test/form-captcha.test.ts`
- Create: `packages/trpc/test/form-rate-limit.test.ts`
- Modify: `.env.example`
- Modify: `deploy/.env.example`
- Modify: `deploy/.env.template`
- Modify: `compose.yml`
- Modify: `deploy/compose.yml`
- Modify: `turbo.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Write failing token tamper/expiry/no-ID tests**

```ts
const token = signFormVersionToken(payload, secret, now)
expect(verifyFormVersionToken(token, secret, now)).toEqual(payload)
expect(() => verifyFormVersionToken(`${token}x`, secret, now)).toThrow('FORM_TOKEN_INVALID')
expect(() => verifyFormVersionToken(token, secret, addHours(now, 25))).toThrow('FORM_TOKEN_EXPIRED')
expect(Buffer.from(token.split('.')[0]!, 'base64url').toString()).not.toContain(formId)
```

Cover wrong algorithm/segment count, short secret, link revision mismatch at the caller, and constant-time signature comparison.

- [ ] **Step 2: Write failing CAPTCHA and rate-limit tests**

CAPTCHA tests inject `fetch`, verify POST body, action `form_submit`/`form_upload`, score `>=0.5`, production hostname, upstream non-2xx and missing production secret fail-closed. Rate tests use an injected clock and prove 10 attempts/10 minutes per IP+form, 100/minute form-wide, 30 upload starts/10 minutes, pruning and independent keys.

- [ ] **Step 3: Run helper tests and confirm missing modules**

Run:

```bash
pnpm --filter @repo/trpc exec vitest run test/form-version-token.test.ts test/form-captcha.test.ts test/form-rate-limit.test.ts
```

Expected: FAIL on unresolved helper imports.

- [ ] **Step 4: Implement the exact HMAC token envelope**

```ts
export type FormVersionTokenPayload = {
  locatorHash: string
  versionNumber: number
  schemaHash: string
  linkRevision: number
  issuedAt: number
  expiresAt: number
}

export function signFormVersionToken(payload: FormVersionTokenPayload, secret: string): string {
  assertSecret(secret)
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(`form-v1.${body}`).digest('base64url')
  return `${body}.${signature}`
}
```

Verification requires two segments, parses a strict Zod payload, recomputes the HMAC over the domain-separated `form-v1.` prefix and uses `timingSafeEqual` on equal-length buffers.

Every protected form operation then calls one context assertion:

```ts
assertFormVersionContext(payload, {
  locatorHash: sha256(normalizedLocator),
  versionNumber: storedVersion.versionNumber,
  schemaHash: storedVersion.schemaHash,
  linkRevision: form.linkRevision,
})
```

The assertion compares all four fields and requires the stored version to be current or before `acceptUntil`; a valid signature alone never authorizes access.

- [ ] **Step 5: Implement Google reCAPTCHA v3 verification**

```ts
const response = await fetchImpl('https://www.google.com/recaptcha/api/siteverify', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ secret, response: token, remoteip: ip }),
})
const result = recaptchaResponseSchema.parse(await response.json())
if (!result.success || result.action !== expectedAction || (result.score ?? 0) < 0.5) {
  throw new TRPCError({ code: 'FORBIDDEN', message: 'FORM_CAPTCHA_FAILED' })
}
```

Production also compares `result.hostname` with `new URL(BETTER_AUTH_URL).hostname`. Do not log tokens, scores or raw IP.

- [ ] **Step 6: Implement an injectable limiter interface**

```ts
export interface FormRateLimiter {
  consume(scope: 'submit-ip' | 'submit-form' | 'upload-ip', key: string, now: number): boolean
}

export function formClientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headers.get('x-real-ip')?.trim() ??
    'unknown'
  )
}
```

Hash `${ip}:${routeKey}` with a process-local salt before using it as a map key. Bound the map to 20,000 keys and evict expired/oldest entries. Export a reset hook only from the test module boundary.

- [ ] **Step 7: Wire `FORM_TOKEN_SECRET` through local, CI and production configuration**

- Add an empty documented value to local/deploy examples.
- Add it to `turbo.json.globalEnv`.
- Pass it to web and engines containers where required.
- CI/release use a deterministic 32+ byte test string.
- Deploy reads `${{ secrets.FORM_TOKEN_SECRET }}` and fails before rollout when absent.

- [ ] **Step 8: Run tests, lint and types**

Run:

```bash
pnpm --filter @repo/trpc exec vitest run test/form-version-token.test.ts test/form-captcha.test.ts test/form-rate-limit.test.ts
pnpm --filter @repo/trpc lint
pnpm --filter @repo/trpc check-types
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/trpc/src/helpers/form-* packages/trpc/test/form-* .env.example deploy/.env.example deploy/.env.template compose.yml deploy/compose.yml turbo.json .github/workflows
git commit -m "feat(forms): add public submission protections"
```

### Task 10: Resolve public availability and expose sanitized published forms

**Files:**

- Create: `packages/domain/src/database/forms/form-access-resolver.ts`
- Modify: `packages/domain/src/database/forms/database-forms.module.ts`
- Modify: `packages/domain/src/database/forms/database-forms.tokens.ts`
- Modify: `packages/domain/src/database/forms/index.ts`
- Modify: `packages/domain/src/container.ts`
- Create: `packages/domain/test/database/forms/form-access-resolver.test.ts`
- Create: `packages/trpc/src/routers/form.ts`
- Modify: `packages/trpc/src/index.ts`
- Create: `packages/trpc/test/database-forms-public.test.ts`

- [ ] **Step 1: Add failing access-state tests**

Test uniform unavailable for unknown/archived/invalid locator; DRAFT/CLOSED; scheduled; expired; capped; policy-disabled; auth-required; workspace membership; current/grace version; and public audience ignoring an existing session identity.

```ts
expect(await resolver.resolvePublished('anf_key', signedInUser)).toMatchObject({
  status: 'OPEN',
  respondentUserId: null,
})
```

For `ANYONE_WITH_LINK`, ignore an existing browser session and keep `respondentUserId=null`. For `SIGNED_IN_WITH_LINK`, retain the current user as `respondentUserId`. For `WORKSPACE_MEMBERS_WITH_LINK`, require active workspace membership and enable internal picker access.

- [ ] **Step 2: Run the domain test and confirm the resolver is absent**

Run: `pnpm --filter @repo/domain exec vitest run test/database/forms/form-access-resolver.test.ts`

Expected: FAIL on missing resolver.

- [ ] **Step 3: Implement a discriminated availability result**

```ts
export type PublishedFormResolution =
  | {
      status: 'OPEN'
      form: PublicFormRecord
      version: FormVersionRecord
      respondentUserId: string | null
    }
  | { status: 'SCHEDULED'; opensAt: Date }
  | { status: 'CLOSED' | 'CAPPED' | 'AUTH_REQUIRED' | 'POLICY_DISABLED' | 'UNAVAILABLE' }
```

Order checks exactly: locator existence → archived/draft/current version → workspace policy `disablePublicLinksSitesForms` → manual state → schedule → limit → audience identity/membership. Only SCHEDULED exposes a time. Invalid slug, unknown form and archived form collapse to UNAVAILABLE.

Bind the resolver as `DATABASE_FORMS.AccessResolver` and expose `Domain.formAccess` in the same commit.

- [ ] **Step 4: Add `form.getPublished` and sign the stored version context**

```ts
getPublished: publicProcedure
  .input(z.object({ locator: formLocatorSchema }))
  .query(async ({ ctx, input }) => {
    const resolved = await domainSvc.formAccess.resolvePublished(
      input.locator,
      ctx.user?.id ?? null,
    )
    if (resolved.status !== 'OPEN') return resolved
    const publicVersion = toPublicFormVersion(resolved.version.schema)
    return {
      status: 'OPEN' as const,
      version: publicVersion,
      versionFingerprint: resolved.version.schemaHash,
      versionToken: signResolvedVersion(resolved, input.locator),
      respondentKind: resolved.respondentUserId
        ? ('authenticated' as const)
        : ('anonymous' as const),
    }
  })
```

The result contains no source/page/property IDs. Set `Cache-Control: private, no-store` through `ctx.resHeaders` because audience/session state changes the response.

- [ ] **Step 5: Add lazy internal picker options**

Add `form.listPickerOptions({ locator, versionToken, questionId, query?, cursor?, limit })`. It requires `WORKSPACE_MEMBERS_WITH_LINK` audience and active membership, validates the token before lookup, maps question ID to the stored property, and returns only accessible display IDs/labels. PERSON comes from current workspace members; RELATION uses row ACL and keyset pagination; PAGE_LINK uses the normal page visibility predicate.

- [ ] **Step 6: Assert DTO sanitization and oracle resistance in tRPC tests**

Stringify every result and assert forbidden keys are absent. Compare unknown locator and archived locator errors/status/body. Test session handling for all audiences and picker cross-workspace rejection.

- [ ] **Step 7: Run domain/public tests and commit**

Run:

```bash
pnpm --filter @repo/domain exec vitest run test/database/forms/form-access-resolver.test.ts
pnpm --filter @repo/trpc exec vitest run test/database-forms-public.test.ts
pnpm --filter @repo/domain check-types
pnpm --filter @repo/trpc check-types
```

Expected: all commands exit 0.

```bash
git add packages/domain/src/database/forms packages/domain/test/database/forms packages/trpc/src/routers/form.ts packages/trpc/src/index.ts packages/trpc/test/database-forms-public.test.ts
git commit -m "feat(forms): expose sanitized published forms"
```

### Task 11: Create responses atomically with independent server validation

**Files:**

- Create: `packages/domain/src/database/forms/form-submission.service.ts`
- Modify: `packages/domain/src/database/forms/database-form.repository.ts`
- Modify: `packages/domain/src/database/forms/database-forms.module.ts`
- Modify: `packages/domain/src/database/forms/database-forms.tokens.ts`
- Modify: `packages/domain/src/database/forms/index.ts`
- Modify: `packages/domain/src/container.ts`
- Modify: `packages/domain/src/shared/item-page-creator.ts`
- Modify: `packages/domain/src/pages/repositories/pages.repository.ts:250-310`
- Modify: `packages/domain/src/database/repositories/database.repository.ts:378-395,554-565`
- Create: `packages/domain/test/database/forms/form-submission.service.test.ts`
- Create: `packages/trpc/test/database-forms-submit.test.ts`
- Modify: `packages/trpc/src/routers/form.ts`

- [ ] **Step 1: Add failing domain submission tests**

Cover valid scalar values; auto-title; authenticated/null actor; hidden/unknown keys; server branch disagreement; property type/option drift; inaccessible person/relation/page targets; stale token context; final-slot concurrency; transaction rollback; idempotent retry; and server-computed ending.

```ts
const [a, b] = await Promise.allSettled([
  submit({ ...input, idempotencyKey: crypto.randomUUID() }),
  submit({ ...input, idempotencyKey: crypto.randomUUID() }),
])
expect([a, b].filter((result) => result.status === 'fulfilled')).toHaveLength(1)
```

- [ ] **Step 2: Run the submission test and confirm the missing service**

Run: `pnpm --filter @repo/domain exec vitest run test/database/forms/form-submission.service.test.ts`

Expected: FAIL because `FormSubmissionService` is missing.

- [ ] **Step 3: Make the focused item-page actor nullable**

```ts
export interface ItemPageCreator {
  createItemPageTx(
    parentPageId: string,
    workspaceId: string,
    actorUserId: string | null,
  ): Promise<{ id: string }>
}
```

Update only `createItemPageTx`, `DatabaseRepository.createRow` and `updatePageTitle` to accept null. All normal protected paths still pass a real user ID. Add regression tests proving no other page-creation API accepts a null actor.

- [ ] **Step 4: Implement server-authoritative preparation before the transaction**

1. Reload stored form/version and verify current-or-grace, link revision and audience.
2. Parse the stored document and compile `buildFormAnswerSchema` independently.
3. Re-evaluate path and reject unknown/unreachable answers.
4. Resolve question IDs to property refs from stored JSON.
5. Validate current property type/options and target ACL.
6. Resolve file lease tokens without consuming them.
7. Derive ending and title; never accept them from the client.

Use UTC for deterministic generated titles:

```ts
export function automaticResponseTitle(now: Date): string {
  const stamp = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(now)
  return `Ответ · ${stamp} UTC`
}
```

Bind the service as `DATABASE_FORMS.SubmissionService` and expose `Domain.formSubmissions` in the same commit.

- [ ] **Step 5: Implement one atomic response transaction**

```ts
return this.uow.transaction(async () => {
  const replay = await this.repo.findSubmissionByIdempotency(form.id, input.idempotencyKey)
  if (replay) return toSubmissionResult(replay)
  const reserved = await this.repo.reserveResponseSlot(form.id, now)
  if (!reserved) throw conflict('FORM_NOT_ACCEPTING')
  const itemPage = await this.pageRepo.createItemPageTx(
    source.pageId,
    source.workspaceId,
    respondentUserId,
  )
  const row = await this.repo.createResponseRow({
    sourceId: source.id,
    pageId: itemPage.id,
    actorUserId: respondentUserId,
  })
  await this.repo.writeResponseValues({ row, itemPage, prepared, actorUserId: respondentUserId })
  const submission = await this.repo.createSubmission({
    form,
    version,
    row,
    prepared,
    input,
    respondentUserId,
    now,
  })
  await this.repo.enqueueFormSubmittedEvent({
    form,
    version,
    row,
    submission,
    source,
    respondentUserId,
    now,
  })
  return toSubmissionResult(submission)
})
```

`reserveResponseSlot` uses a conditional update with state/schedule/limit predicates and increments exactly once. Any exception rolls back the counter, page, row, cells, relation links, PageFile writes, file state, submission and outbox row.

- [ ] **Step 6: Add `form.submit` with the approved protection order**

Router order:

1. static envelope and 1 MiB serialized-answer check;
2. locator/idempotent replay with token context revalidation;
3. per-IP+form and form-wide rate limits;
4. `x-captcha-response` verification with action `form_submit`;
5. version-token verification;
6. domain submission.

A non-empty trimmed honeypot fails at step 1 with the uniform `FORM_PROTECTED` error and creates no row, counter increment, notification or webhook event.

```ts
const captchaToken = ctx.headers.get('x-captcha-response')
await verifyFormCaptcha({ token: captchaToken, action: 'form_submit', headers: ctx.headers })
return mapDomain(() => domainSvc.formSubmissions.submit(ctx.user?.id ?? null, input, tokenPayload))
```

An exact idempotent replay returns the first success without consuming a second CAPTCHA token.

- [ ] **Step 7: Run domain/tRPC tests including a real concurrent final slot**

Run:

```bash
pnpm --filter @repo/domain exec vitest run test/database/forms/form-submission.service.test.ts
pnpm --filter @repo/trpc exec vitest run test/database-forms-submit.test.ts
pnpm --filter @repo/domain check-types
pnpm --filter @repo/trpc check-types
```

Expected: all commands exit 0; concurrency test records one submission and one counter increment.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/database packages/domain/src/pages/repositories/pages.repository.ts packages/domain/src/shared/item-page-creator.ts packages/domain/test/database/forms packages/trpc/src/routers/form.ts packages/trpc/test/database-forms-submit.test.ts
git commit -m "feat(forms): submit responses atomically"
```

### Task 12: Add leased public uploads and hourly abandoned-upload cleanup

**Files:**

- Modify: `packages/domain/src/database/forms/database-form.repository.ts`
- Modify: `packages/domain/src/database/forms/form-access-resolver.ts`
- Modify: `packages/domain/src/database/forms/form-submission.service.ts`
- Create: `apps/web/src/app/api/forms/[locator]/uploads/route.ts`
- Create: `apps/web/test/api-form-uploads.test.ts`
- Modify: `apps/engines/src/apps/cleanup/cleanup.service.ts`
- Modify: `apps/engines/src/apps/cleanup/cleanup.service.spec.ts`

- [ ] **Step 1: Add failing upload route tests**

Test valid upload, MIME/size/count violations, workspace quota including non-expired PENDING bytes, wrong question/form/version, expired/current grace, policy/audience, CAPTCHA action, rate limit, random token hashing, and storage failure cleanup.

```ts
expect(response.status).toBe(201)
expect(body.uploadToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
expect(JSON.stringify(await prisma.databaseFormUpload.findFirst())).not.toContain(body.uploadToken)
```

- [ ] **Step 2: Add failing cleanup tests**

Mock Prisma and storage. Assert only expired/unconsumed leases are deleted; consumed/future leases remain; a shared content-addressed S3 path is deleted only after no File row references it; one object failure does not stop other cleanup candidates.

- [ ] **Step 3: Run tests and confirm missing behavior**

Run:

```bash
pnpm --filter web exec vitest run test/api-form-uploads.test.ts
pnpm --filter engines test -- cleanup.service.spec.ts
```

Expected: FAIL because route and form cleanup do not exist.

- [ ] **Step 4: Implement the multipart lease route**

The route performs: locator/token envelope validation → upload limiter → `form_upload` CAPTCHA → access resolver → question lookup → MIME/size/count/quota checks → byte hashing/sniffing → `storage.put` → File(PENDING)+lease transaction.

```ts
const uploadToken = randomBytes(32).toString('base64url')
const uploadTokenHash = createHash('sha256').update(uploadToken).digest('hex')
const expiresAt = addHours(now, 24)
```

Store `questionId`, form/version IDs, `fileId`, hash and expiry. Return token plus safe file metadata, never internal form/source/property IDs. If DB creation fails after `storage.put`, delete the object only when no File row references the path.

- [ ] **Step 5: Consume leases only inside the response transaction**

For every FILE question, hash submitted bearer tokens, require same form/version/question, `consumedAt=null`, `expiresAt>now`, enforce maxFiles, create PageFile rows, write the File ID array, set File ACTIVE and stamp `consumedAt`. A token can be consumed once.

- [ ] **Step 6: Extend engines cleanup with the main Prisma provider**

Inject `PRISMA` alongside the existing agents `Pool`. `runHourly` calls both cleanup jobs under separate try/catch blocks so one database cannot suppress the other.

```ts
async purgeExpiredFormUploads(now = new Date()): Promise<number> {
  const leases = await this.prisma.databaseFormUpload.findMany({
    where: { consumedAt: null, expiresAt: { lt: now } },
    select: { id: true, fileId: true, file: { select: { path: true } } },
    take: 500,
  })
  return this.deleteExpiredUploadBatch(leases)
}
```

Delete lease/File rows transactionally, then delete an object only if a fresh `file.count({ where: { path } })` is zero.

- [ ] **Step 7: Run web, engines and submission tests**

Run:

```bash
pnpm --filter web exec vitest run test/api-form-uploads.test.ts
pnpm --filter engines test -- cleanup.service.spec.ts
pnpm --filter @repo/domain exec vitest run test/database/forms/form-submission.service.test.ts
pnpm --filter web check-types
pnpm --filter engines check-types
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/database/forms apps/web/src/app/api/forms apps/web/test/api-form-uploads.test.ts apps/engines/src/apps/cleanup
git commit -m "feat(forms): add leased public file uploads"
```

### Task 13: Ship the A2 public renderer with React Hook Form and local drafts

**Files:**

- Create: `apps/web/src/app/(form)/layout.tsx`
- Create: `apps/web/src/app/(form)/f/[key]/page.tsx`
- Create: `apps/web/src/app/(form)/f/[key]/form-page-client.tsx`
- Modify: `apps/web/src/components/forms/form-renderer.tsx`
- Modify: `apps/web/src/components/forms/form-field.tsx`
- Create: `apps/web/src/components/forms/form-internal-picker.tsx`
- Create: `apps/web/src/components/forms/form-upload-field.tsx`
- Modify: `apps/web/src/components/forms/form-section-map.tsx`
- Create: `apps/web/src/components/forms/form-ending.tsx`
- Create: `apps/web/src/components/forms/form-unavailable.tsx`
- Create: `apps/web/src/lib/form-draft-storage.ts`
- Create: `apps/web/test/forms/form-renderer.test.tsx`
- Create: `apps/web/test/forms/form-draft-storage.test.ts`
- Create: `apps/web/test/forms/form-page.test.tsx`

- [ ] **Step 1: Add failing local-draft tests**

Test locator+fingerprint keying, seven-day TTL, malformed JSON removal, clear on success/reset, compatible stable-ID remap, incompatible values retained until confirmation, and no storage access during SSR.

```ts
expect(loadFormDraft(storage, key, addDays(savedAt, 8))).toBeNull()
expect(remapDraft(oldVersion, newVersion, oldAnswers).compatible).toEqual({ 'q-email': 'a@b.test' })
```

- [ ] **Step 2: Add failing renderer interaction/accessibility tests**

Cover every field type, `zodResolver`, section `trigger`, branch change, Back, unreachable-value exclusion, server `setError`, first-error section/focus, labels/descriptions, keyboard navigation, desktop section map/mobile progress and ending screen.

- [ ] **Step 3: Run tests and confirm public route/renderer gaps**

Run:

```bash
pnpm --filter web exec vitest run test/forms/form-draft-storage.test.ts test/forms/form-renderer.test.tsx test/forms/form-page.test.tsx
```

Expected: FAIL because public form route and full renderer do not exist.

- [ ] **Step 4: Add the public route group and server state resolution**

`layout.tsx` wraps children in the existing `RecaptchaProvider` using the runtime site key and exports `robots: { index: false, follow: false }`. `FormPageClient` obtains `executeRecaptcha` through the existing `useRecaptchaV3` hook. `page.tsx` calls `getServerTRPC().form.getPublished({ locator: key })`, renders `FormUnavailable` for non-OPEN results, and passes only sanitized data to the client.

```tsx
export default async function FormPage({ params }: PageProps<'/f/[key]'>) {
  const { key } = await params
  const api = await getServerTRPC()
  const result = await api.form.getPublished({ locator: key })
  return result.status === 'OPEN' ? (
    <FormPageClient locator={key} published={result} />
  ) : (
    <FormUnavailable state={result} />
  )
}
```

- [ ] **Step 5: Connect React Hook Form to the shared dynamic Zod compiler**

```tsx
const schema = useMemo(() => buildFormAnswerSchema(version), [version])
const methods = useForm<FormAnswerEnvelope>({
  resolver: zodResolver(schema),
  defaultValues: { answers: restoredAnswers },
  mode: 'onBlur',
  criteriaMode: 'all',
  shouldUnregister: false,
})
```

Use `useWatch({ name: 'answers' })` to evaluate visible questions/path. Before Next, call `trigger(activeQuestionPaths)`. Before submit, call `projectReachableAnswers` and generate a UUID idempotency key once per submit attempt.

- [ ] **Step 6: Submit with the existing CAPTCHA client integration**

```ts
const token = await executeRecaptcha('form_submit')
setPendingCaptchaToken(token)
const result = await submit.mutateAsync({
  locator,
  versionToken,
  idempotencyKey,
  answers,
  honeypot: '',
})
```

On server field errors, call `setError('answers.${questionId}', { messages })`, navigate to the first owning section and focus the field. Network retry reuses the same idempotency key.

- [ ] **Step 7: Implement all field adapters**

- Scalar/choice fields use MUI inputs and RHF `Controller` only when the input is not natively registerable.
- NUMBER uses `setValueAs` to produce number/null, not numeric strings.
- DATE emits the stored ISO contract.
- FILE posts multipart data with version token/question ID and stores lease tokens in answers.
- PERSON/RELATION/PAGE_LINK call `form.listPickerOptions` lazily with pagination and search.
- Required consent CHECKBOX validates `true`.

- [ ] **Step 8: Match the approved A2 presentation**

Render full-width cover, organization identity, open document content, desktop left section map, mobile compact progress, local-draft/privacy/duration context and AnyNote branding unless hidden. Do not use a floating form card. Provide dedicated scheduled/closed/capped/auth-required/policy/unavailable screens; auth-required links to sign-in with an encoded `/f/{locator}` return URL.

- [ ] **Step 9: Run renderer tests, lint, types and commit**

Run:

```bash
pnpm --filter web exec vitest run test/forms
pnpm --filter web lint
pnpm --filter web check-types
```

Expected: all commands exit 0.

```bash
git add apps/web/src/app/'(form)' apps/web/src/components/forms apps/web/src/lib/form-draft-storage.ts apps/web/test/forms
git commit -m "feat(web): add public database form renderer"
```

---

## Phase 4 — respondent access, integrations and rollout

### Task 14: Let authenticated respondents view or edit only their own response

**Files:**

- Modify: `packages/domain/src/database/forms/form-access-resolver.ts`
- Modify: `packages/domain/src/database/forms/form-submission.service.ts`
- Modify: `packages/domain/src/database/forms/database-form.repository.ts`
- Modify: `packages/trpc/src/routers/form.ts`
- Create: `packages/trpc/test/database-forms-own-response.test.ts`
- Create: `apps/web/src/app/(form)/f/[key]/responses/[submissionId]/page.tsx`
- Create: `apps/web/src/app/(form)/f/[key]/responses/[submissionId]/own-response-client.tsx`
- Create: `apps/web/test/forms/own-response.test.tsx`

- [ ] **Step 1: Add failing authority and edit tests**

Cover anonymous submission, wrong user, NONE/VIEW/EDIT, policy kill-switch, archived form, CLOSED form, deleted property, property type drift, owner edits reflected in VIEW, forged fields, relation/file updates, branch changes and clearing newly unreachable stored values only after confirmation. CLOSED forms keep configured own-response VIEW/EDIT access; ARCHIVED forms are unavailable.

```ts
await expect(otherCaller.getOwnResponse({ locator, submissionId })).rejects.toMatchObject({
  code: 'NOT_FOUND',
})
```

Use the same not-found response for unknown, inaccessible and another user's submission to prevent enumeration.

- [ ] **Step 2: Run tests and confirm own-response procedures are absent**

Run: `pnpm --filter @repo/trpc exec vitest run test/database-forms-own-response.test.ts`

Expected: FAIL because `getOwnResponse` and `updateOwnResponse` are not mounted.

- [ ] **Step 3: Resolve ownership against current form policy**

```ts
if (!actorUserId || submission.respondentUserId !== actorUserId) return { status: 'UNAVAILABLE' }
if (form.state === 'ARCHIVED' || form.respondentAccess === 'NONE' || policyDisabled)
  return { status: 'UNAVAILABLE' }
return { status: form.respondentAccess, submission, version, currentValues }
```

The resolver intentionally ignores manual CLOSED state, schedule and response cap for an already-created response. It does not grant workspace membership, PageShare rows, source access, page-body access or access to other rows.

- [ ] **Step 4: Return a sanitized own-response DTO**

Return submitted-version question labels/input configs and values only for properties that still exist with the same type. Mark removed/type-changed questions `{ available: false }`. Do not return source/property/page IDs or other response metadata.

- [ ] **Step 5: Reuse server validation for EDIT**

`updateOwnResponse` recompiles the submitted version, validates current property/target access and updates title/cells/relations/files in one transaction. It never changes source, respondent, submittedAt, idempotency key or original ending.

If a previously stored field becomes unreachable, first return:

```ts
{
  status: 'CONFIRM_CLEAR_REQUIRED',
  questionIds: ['q-details']
}
```

The client shows the labels and resubmits with `confirmClearUnreachable: true`; only then does the transaction clear those properties.

- [ ] **Step 6: Mount protected own-response procedures**

Add both procedures to `packages/trpc/src/routers/form.ts`; authentication is mandatory even when the original form accepted anonymous responses:

```ts
getOwnResponse: protectedProcedure
  .input(getOwnResponseInputSchema)
  .query(({ ctx, input }) => ctx.databaseFormService.getOwnResponse(ctx.user.id, input)),
updateOwnResponse: protectedProcedure
  .input(updateOwnResponseInputSchema)
  .mutation(({ ctx, input }) => ctx.formSubmissionService.updateOwnResponse(ctx.user.id, input)),
```

Keep `submissionId` plus the public locator in both schemas, return `NOT_FOUND` for every ownership/access miss and route all authority decisions through `FormAccessResolver`.

- [ ] **Step 7: Build the VIEW/EDIT page with the shared renderer**

VIEW renders current values read-only. EDIT uses the same React Hook Form/Zod renderer, server error mapping and leased upload flow. After save, invalidate the own-response query and show a non-destructive saved state.

- [ ] **Step 8: Run tRPC/web tests, lint and types**

Run:

```bash
pnpm --filter @repo/trpc exec vitest run test/database-forms-own-response.test.ts
pnpm --filter web exec vitest run test/forms/own-response.test.tsx
pnpm --filter @repo/trpc check-types
pnpm --filter web lint
pnpm --filter web check-types
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/domain/src/database/forms packages/trpc/src/routers/form.ts packages/trpc/test/database-forms-own-response.test.ts apps/web/src/app/'(form)'/f/'[key]'/responses apps/web/test/forms/own-response.test.tsx
git commit -m "feat(forms): add respondent response access"
```

### Task 15: Emit owner notifications, metadata-only webhooks and safe observability

**Files:**

- Modify: `packages/notifications/src/catalog.ts`
- Modify: `packages/notifications/src/types.ts`
- Modify: `packages/notifications/src/templates/in-app.ts`
- Modify: `packages/notifications/src/templates/email.ts`
- Modify: `packages/notifications/src/templates/registry.ts`
- Modify: `packages/notifications/test/catalog.test.ts`
- Modify: `packages/notifications/test/templates.test.ts`
- Create: `packages/trpc/src/helpers/form-notify.ts`
- Create: `packages/trpc/src/helpers/form-observability.ts`
- Create: `packages/trpc/test/database-forms-notify.test.ts`
- Modify: `packages/trpc/src/routers/form.ts`
- Modify: `packages/webhooks/src/catalog.ts`
- Modify: `packages/webhooks/src/payload.ts`
- Modify: `packages/webhooks/src/worker/fan-out.ts`
- Modify: `packages/webhooks/test/catalog.test.ts`
- Modify: `packages/webhooks/test/payload.test.ts`
- Modify: `packages/webhooks/test/fan-out.test.ts`
- Modify: `apps/web/src/components/workspace/settings/webhook-events.ts`
- Modify: `apps/web/src/components/notifications/format-notification.tsx`
- Modify: `apps/web/test/format-notification.test.ts`
- Modify: `docs/developers/webhooks.md`

- [ ] **Step 1: Add failing notification and idempotency tests**

Assert a newly created submission notifies the form creator plus active workspace OWNER/ADMIN managers exactly once, respects `notifyOwners=false`, excludes the respondent unless they are also a manager, and an idempotent replay emits nothing again.

```ts
expect(emit).toHaveBeenCalledWith(
  expect.objectContaining({
    type: 'FORM_SUBMITTED',
    resourceUrl: `/workspaces/${workspaceId}/pages/${pageId}?viewId=${viewId}`,
  }),
)
```

The persisted notification payload contains `formId`, `versionNumber`, `rowId` plus the
immutable display metadata required by the specified templates: `formLabel`, `submittedAt`
and the internal `resourceUrl`. It contains no answers, respondent labels/emails, IP,
CAPTCHA data or upload tokens. The webhook payload remains identifiers/operational metadata only.

- [ ] **Step 2: Add failing webhook catalog/payload/fan-out tests**

Add `database.form.submitted` to the active catalog, subscribe to it, fan out one delivery with the source database page as the visibility-gated resource and exact metadata hints. Assert `assertNoForbiddenKeys` still rejects `title`, `content`, `body`, `text` and `name` anywhere.

- [ ] **Step 3: Run focused tests and confirm failures**

Run:

```bash
pnpm --filter @repo/notifications exec vitest run test/catalog.test.ts test/templates.test.ts
pnpm --filter @repo/webhooks exec vitest run test/catalog.test.ts test/payload.test.ts test/fan-out.test.ts
pnpm --filter @repo/trpc exec vitest run test/database-forms-notify.test.ts
```

Expected: FAIL because the new event types/helpers are not implemented.

- [ ] **Step 4: Add the FORM_SUBMITTED notification descriptor and templates**

```ts
FORM_SUBMITTED: {
  category: 'COLLABORATION',
  defaultChannels: ['IN_APP', 'EMAIL'],
  lockedChannels: ['IN_APP'],
  requiresConsent: null,
}
```

In-app copy: `Новый ответ на форму «{formLabel}»`. Email contains form label, submission time and a single “Открыть ответы” button; it includes no answer values.

- [ ] **Step 5: Notify only after a genuinely new committed response**

`FormSubmissionService` returns `{ submissionId, endingId, ownResponseUrl, created }`. The public router calls `notifyFormManagers` only when `created=true`; notification failure is captured and logged without changing the accepted response result.

- [ ] **Step 6: Enqueue and fan out `database.form.submitted`**

Inside the response transaction enqueue a webhook outbox row whose aggregate/resource ID is the source DATABASE page ID:

```ts
await enqueueWebhookEvent(tx, {
  event: 'database.form.submitted',
  resourceType: 'page',
  resourceId: source.pageId,
  workspaceId: source.workspaceId,
  actorId: respondentUserId,
  hints: {
    formId: form.id,
    versionNumber: version.versionNumber,
    rowId: row.id,
    itemPageId: row.pageId,
    submittedAt: now.toISOString(),
    respondentKind: respondentUserId ? 'authenticated' : 'anonymous',
  },
})
```

The existing TEAM page visibility gate remains authoritative. Do not bypass it for a private source page.

- [ ] **Step 7: Keep the client event catalog, notification formatter and developer docs in sync**

Add the literal client-safe event entry used by Webhook Settings and Telegram subscriptions:

```ts
'database.form.submitted': {
  label: 'Форма заполнена',
  desc: 'Новый ответ добавлен в базу данных',
}
```

Add the `FORM_SUBMITTED` case to `formatNotification` and its focused test. Extend `docs/developers/webhooks.md` with the new event, TEAM page-visibility rule and a metadata-only payload example. Keep `apps/web/test/developer-docs-contract.test.ts` green so every active server event remains represented in the public developer catalog.

- [ ] **Step 8: Add safe metrics and logs**

Record schema-load outcome, submit outcome/reason, CAPTCHA failure, validation failure, transaction duration and upload cleanup count. Tags may contain outcome and form/version internal UUIDs, never locator/slug, answer, email or raw IP. Unit-test the context sanitizer:

```ts
expect(
  safeFormLogContext({ formId, versionNumber: 2, locator: 'secret-slug', email: 'a@b.test' }),
).toEqual({
  formId,
  versionNumber: 2,
})
```

- [ ] **Step 9: Run all integration package tests and commit**

Run:

```bash
pnpm --filter @repo/notifications test
pnpm --filter @repo/webhooks test
pnpm --filter @repo/trpc exec vitest run test/database-forms-notify.test.ts test/database-forms-submit.test.ts
pnpm --filter @repo/trpc check-types
pnpm --filter web exec vitest run test/format-notification.test.ts test/developer-docs-contract.test.ts
pnpm --filter web check-types
```

Expected: all commands exit 0.

```bash
git add packages/notifications packages/webhooks packages/trpc/src/helpers/form-notify.ts packages/trpc/src/helpers/form-observability.ts packages/trpc/src/routers/form.ts packages/trpc/test/database-forms-notify.test.ts apps/web/src/components/workspace/settings/webhook-events.ts apps/web/src/components/notifications/format-notification.tsx apps/web/test/format-notification.test.ts docs/developers/webhooks.md
git commit -m "feat(forms): notify on database form submission"
```

### Task 16: Complete security regression coverage, E2E flows and release gates

**Files:**

- Create: `apps/e2e/database-forms.spec.ts`
- Create: `packages/trpc/test/database-forms-security.test.ts`
- Modify: `apps/web/test/forms/form-renderer.test.tsx`
- Modify: `docs/superpowers/specs/2026-07-15-database-forms-design.md` only if implementation found an approved-spec contradiction; do not silently change product behavior.

- [ ] **Step 1: Add the adversarial API suite**

Test forged property/source/row IDs, unknown/hidden answers, forged ending, token tamper/expiry/link rotation, old-version grace expiry, cross-form upload claim, consumed upload reuse, picker enumeration, slug oracle, policy kill-switch on every route, CAPTCHA fail-closed/action/hostname/score and all audience combinations.

Run: `pnpm --filter @repo/trpc exec vitest run test/database-forms-security.test.ts`

Expected before final fixes: at least one red test for every uncovered boundary; fix the underlying authority, not the assertion.

- [ ] **Step 2: Add the end-to-end happy paths**

`apps/e2e/database-forms.spec.ts` covers:

1. owner creates a database form, adds questions/sections, previews and publishes;
2. anonymous respondent opens generated key, follows each major branch and creates expected row values/ending;
3. two forms write into one source but response lists stay separate;
4. signed-in and workspace audiences capture identity correctly;
5. respondent VIEW/EDIT cannot open another user's response;
6. generated key, custom slug, rotation, schedule, manual close/reopen and cap;
7. multiple files attach and abandoned lease cleanup is callable through the service test seam;
8. Pro+ branching/slug/branding controls are gated by feature flags, not slug checks;
9. desktop A2 section map and mobile compact progress render without overflow.

- [ ] **Step 3: Run the focused E2E spec**

Run:

```bash
pnpm exec playwright test apps/e2e/database-forms.spec.ts --project=chromium
```

Expected: all database-form scenarios pass with zero retries required locally.

- [ ] **Step 4: Revalidate fresh and legacy migrations**

Apply all migrations to an empty database and a snapshot with legacy scalar FILE cells. Run `prisma validate`, `prisma generate`, seed and the real-database form tests. Confirm all non-null FILE values are arrays and all form FKs/indexes exist.

- [ ] **Step 5: Run the complete merge gate**

Run:

```bash
pnpm check-types
pnpm lint
pnpm check-architecture
pnpm build
pnpm test
pnpm exec playwright test apps/e2e/database-forms.spec.ts --project=chromium
pnpm gates
```

Expected: every command exits 0. Do not claim completion from cached or earlier output; retain the final fresh logs.

- [ ] **Step 6: Perform the production configuration preflight**

Before merge/deploy verify:

- `FORM_TOKEN_SECRET` exists in GitHub environment secrets and production `.env`, is at least 32 random bytes and differs from test/local values;
- existing `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` and `RECAPTCHA_SECRET_KEY` are configured for `anynote.ru`;
- production host comparison resolves to `anynote.ru` from `BETTER_AUTH_URL`;
- S3 lifecycle does not delete ACTIVE form files;
- engines cleanup can reach the primary DATABASE_URL and S3;
- the security policy toggle disables `/f/*` without deleting data;
- database backups include the four new tables before enabling public links.

- [ ] **Step 7: Review the final diff for data exposure**

Search:

```bash
rg -n "answers|captcha|uploadToken|propertyId|sourceId|rawIp|email" packages/trpc/src/routers/form.ts packages/webhooks/src packages/trpc/src/helpers/form-observability.ts
```

Inspect every match. Public DTOs may use `answers` only as respondent input and may map field errors by question ID; webhook/log/metric payloads must contain none of the forbidden data.

- [ ] **Step 8: Commit the final test and rollout work**

```bash
git add apps/e2e/database-forms.spec.ts packages/trpc/test/database-forms-security.test.ts apps/web/test/forms
git commit -m "test(forms): cover database forms end to end"
```

## Completion checklist

- [ ] Multiple FORM views can target one source.
- [ ] Draft revisions conflict safely and published versions are immutable.
- [ ] Current and 24-hour grace versions accept only valid signed context.
- [ ] Public DTOs expose question IDs but no database internals.
- [ ] React Hook Form uses the shared dynamic Zod compiler on the client.
- [ ] The server reloads stored JSON and independently recompiles Zod/branch reachability.
- [ ] CAPTCHA, limiter, honeypot, idempotency and conditional response slot are enforced.
- [ ] One transaction creates the Page, row, cells, relations, files, provenance and webhook outbox event.
- [ ] Anonymous rows have null creator/respondent; authenticated audiences capture identity.
- [ ] PERSON/RELATION/PAGE_LINK are limited to workspace-member forms.
- [ ] FILE cells write arrays and legacy scalar reads remain compatible through rollout.
- [ ] Respondents can access only their own response according to NONE/VIEW/EDIT.
- [ ] Workspace kill-switch covers schema, picker, upload, submit and own-response routes.
- [ ] Pro+ behavior is controlled through feature flags and survives soft downgrade.
- [ ] Notifications/webhooks/logs/metrics contain no answers, tokens, CAPTCHA or raw IP.
- [ ] A2 layout is accessible and responsive on desktop/mobile.
- [ ] Fresh/legacy migrations, unit/integration/component/E2E tests and `pnpm gates` pass.
