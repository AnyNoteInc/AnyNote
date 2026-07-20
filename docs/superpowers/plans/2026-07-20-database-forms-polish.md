# Database Forms Polish and Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the twelve approved database-form issues, verify every behavior in Playwright, release the next semantic version, and confirm the real production flow at `/f/{key}`.

**Architecture:** Extend the JSON form document with draft-safe titles, page-compatible entity icons, and typed default answers; centralize effective-answer stabilization so React Hook Form and the server evaluate the same path. Split local appearance editors from a resizable behavior inspector, then give the public renderer dedicated full-page form and completion layouts. Add a reusable local SVG QR dialog and keep publication, CAPTCHA, authorization, idempotency, and persistence authoritative on the server.

**Tech Stack:** TypeScript 6, React 19, Next.js 16, React Hook Form 7, Zod 4, MUI X date pickers, `qrcode.react` 4.2, Vitest 4, Playwright 1.61, tRPC 11, Prisma 7, pnpm/Turbo.

## Global Constraints

- Preserve `https://anynote.ru/f/{key}` and the existing route-key/custom-slug behavior.
- Keep CAPTCHA, rate limits, idempotency ordering, upload leases, authorization, and transaction boundaries unchanged.
- `URL` is **Ссылка на сайт** and public; `PAGE_LINK` is **Страница AnyNote** and remains workspace-member-only with `PERSON` and `RELATION`.
- Static defaults support every question kind except `FILE`; `0` and `false` are explicit values, while `undefined`, `null`, `''`, and `[]` are empty.
- Defaults affect validation and conditional flow but do not visually prefill respondent controls or raw browser drafts.
- Published form documents still require a non-empty title; only drafts accept an empty title.
- QR generation is local SVG rendering; never send the form URL to a third-party QR endpoint.
- No Prisma migration: icons and defaults live in the existing JSON draft/version documents; inspector preferences live in browser storage.
- Preserve unrelated local changes in `AGENTS.md`, `MEMORY.md`, `.agents/`, and `.codex/`.
- Work in an isolated `codex/forms-polish-defaults` worktree and make Conventional Commits after each independently green slice.

## File Structure

**New focused files**

- `packages/domain/src/database/forms/form-effective-answers.ts` — empty-value semantics, default application, bounded path stabilization.
- `apps/web/src/components/database/forms/form-icon-button.tsx` — page-compatible icon rendering plus the existing page icon picker.
- `apps/web/src/components/database/forms/form-appearance-popover.tsx` — local form/section/question appearance surfaces.
- `apps/web/src/components/database/forms/form-default-value-editor.tsx` — input-family-aware editor for static question defaults.
- `apps/web/src/components/database/forms/use-form-inspector-layout.ts` — resize, collapse, keyboard control, and persistence.
- `apps/web/src/components/forms/form-date-field.tsx` — controlled date/date-time RHF adapter.
- `apps/web/src/components/forms/form-qr-dialog.tsx` — accessible SVG QR, download, and copy actions.
- `apps/web/src/lib/form-public-url.ts` — canonical public URL and schema comparison helpers shared by builder/share/QR.
- `apps/web/test/database-forms-inspector-layout.test.tsx` — inspector interaction coverage.
- `apps/web/test/forms/form-qr-dialog.test.tsx` — QR/copy/download component coverage.

**Primary modified files**

- Domain: `packages/domain/src/database/forms/form-document.ts`, `form-answer-schema.ts`, `public.ts`, `database-form.service.ts`, `form-submission.service.ts`.
- Builder: `apps/web/src/components/database/forms/form-builder-state.ts`, `form-builder-validation.ts`, `form-builder.tsx`, `form-preview-canvas.tsx`, `form-settings-panel.tsx`, `form-presentation-editor.tsx`, `form-property-picker.tsx`, `form-share-panel.tsx`.
- Public flow: `apps/web/src/components/forms/form-renderer.tsx`, `form-field.tsx`, `form-ending.tsx`, `apps/web/src/app/(form)/layout.tsx`, `apps/web/src/app/(form)/f/[key]/form-page-client.tsx`.
- Response view: `apps/web/src/components/database/database-item-modal.tsx`, `apps/web/src/components/database/forms/form-responses-panel.tsx`.
- Dependency/tests: `apps/web/package.json`, `pnpm-lock.yaml`, existing domain/web tests, `apps/e2e/database-forms.spec.ts`.

---

### Task 1: Draft-safe document schema, icons, and default-value shape

**Files:**

- Modify: `packages/domain/src/database/forms/form-document.ts:86-170, 480-578`
- Modify: `packages/domain/src/database/forms/public.ts`
- Test: `packages/domain/test/database/forms/form-document.test.ts`

**Interfaces:**

- Produces: `formDraftVersionDocumentSchema`, `parseFormDraftVersionDocument(input): FormVersionDocument`.
- Produces: optional `icon?: string` on `FormSection` and `FormQuestion`; optional `defaultValue?: unknown` on `FormQuestion`.
- Consumed by: Tasks 2–5 and every builder draft parser.

- [ ] **Step 1: Write failing schema tests**

Add these cases to `form-document.test.ts`:

```ts
it('allows a blank title only in a draft document', () => {
  const document = makeDocument()
  document.presentation.title = ''
  expect(parseFormDraftVersionDocument(document).presentation.title).toBe('')
  expect(formVersionDocumentSchema.safeParse(document).success).toBe(false)
})

it('accepts page-compatible entity icons and bounded default values', () => {
  const document = makeDocument()
  document.sections[0]!.icon = '🗺️'
  document.questions[0]!.icon = 'url:/api/files/019f65ef-1439-7653-92aa-0a2da2269711'
  document.questions[0]!.defaultValue = 'Не указано'
  expect(parseFormDraftVersionDocument(document)).toMatchObject({
    sections: [{ icon: '🗺️' }],
    questions: [{ defaultValue: 'Не указано' }],
  })
})
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `pnpm --filter @repo/domain exec vitest run test/database/forms/form-document.test.ts`

Expected: FAIL because `parseFormDraftVersionDocument`, section/question icons, and `defaultValue` do not exist.

- [ ] **Step 3: Add the draft parser and structural fields**

Implement the shared icon schema and draft-only presentation override in `form-document.ts`:

```ts
const FORM_ICON_URL_PREFIX = 'url:'
const FORM_ICON_FILE_RE =
  /^\/api\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

function isSafeFormIcon(value: string): boolean {
  if (!value.startsWith(FORM_ICON_URL_PREFIX)) return [...value].length <= 32
  const url = value.slice(FORM_ICON_URL_PREFIX.length)
  return url.length <= 1_024 && (FORM_ICON_FILE_RE.test(url) || /^https:\/\/\S+$/u.test(url))
}

const formIconSchema = z.string().min(1).max(1_028).refine(isSafeFormIcon, 'UNSAFE_FORM_ICON')

export const formSectionSchema = z
  .object({
    id: formLocalIdSchema,
    title: z.string().min(1).max(200),
    description: descriptionSchema.optional(),
    icon: formIconSchema.optional(),
    questionIds: z.array(formLocalIdSchema).max(MAX_FORM_QUESTIONS),
  })
  .strict()

export const formQuestionSchema = z
  .object({
    id: formLocalIdSchema,
    sectionId: formLocalIdSchema,
    property: formPropertyRefSchema,
    label: z.string().min(1).max(500),
    description: descriptionSchema.optional(),
    icon: formIconSchema.optional(),
    defaultValue: z.unknown().optional(),
    required: z.boolean(),
    syncWithPropertyName: z.boolean(),
    visibleWhen: formConditionGroupSchema.optional(),
    input: formInputConfigSchema,
  })
  .strict()

const formDraftPresentationSchema = formPresentationSchema.extend({
  title: z.string().max(200),
})

export const formDraftVersionDocumentSchema = formVersionDocumentSchema.extend({
  presentation: formDraftPresentationSchema,
})

export const parseFormDraftVersionDocument = (input: unknown): FormVersionDocument =>
  parseBoundedFormDocument(formDraftVersionDocumentSchema, input)
```

Extract the existing byte-limit logic into `parseBoundedFormDocument(schema, input)` so strict and draft parsers enforce the same `MAX_FORM_DOCUMENT_BYTES`. Export the new parser through `public.ts`.

- [ ] **Step 4: Run focused tests and type checks**

Run:

```bash
pnpm --filter @repo/domain exec vitest run test/database/forms/form-document.test.ts
pnpm --filter @repo/domain check-types
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the schema slice**

```bash
git add packages/domain/src/database/forms/form-document.ts packages/domain/src/database/forms/public.ts packages/domain/test/database/forms/form-document.test.ts
git commit -m "feat(forms): support draft titles icons and defaults"
```

### Task 2: Effective answers and dynamic Zod defaults

**Files:**

- Create: `packages/domain/src/database/forms/form-effective-answers.ts`
- Modify: `packages/domain/src/database/forms/form-answer-schema.ts`
- Modify: `packages/domain/src/database/forms/public.ts`
- Test: `packages/domain/test/database/forms/form-answer-schema.test.ts`
- Test: `packages/domain/test/database/forms/form-graph.test.ts`

**Interfaces:**

- Consumes: Task 1's `FormQuestion.defaultValue`.
- Produces: `isEmptyFormAnswer(question, value): boolean`.
- Produces: `stabilizeEffectiveFormAnswers(version, rawAnswers): { answers: Record<string, unknown>; path: EvaluatedFormPath }`.
- Produces: `validateFormQuestionDefault(question): boolean`.
- Consumed by: client Zod validation and Task 3's server write plan.

- [ ] **Step 1: Write failing default and branching tests**

Add cases proving static defaults, explicit false/zero, file rejection, and branching:

```ts
it('applies defaults only to empty reachable answers', () => {
  const version = makePublicVersion([
    publicQuestion('number', 'NUMBER', { kind: 'NUMBER' }, { defaultValue: 7, required: true }),
    publicQuestion(
      'check',
      'CHECKBOX',
      { kind: 'CHECKBOX', consent: false },
      { defaultValue: true },
    ),
  ])
  expect(stabilizeEffectiveFormAnswers(version, { number: 0, check: false }).answers).toEqual({
    number: 0,
    check: false,
  })
  expect(stabilizeEffectiveFormAnswers(version, { number: null }).answers).toEqual({
    number: 7,
    check: true,
  })
})

it('rejects file defaults and uses defaults for conditional routing', () => {
  const file = publicQuestion(
    'file',
    'FILE',
    {
      kind: 'FILE',
      allowedMimeTypes: [],
      maxBytesPerFile: 1_000,
      maxFiles: 1,
    },
    { defaultValue: ['forged-lease'] },
  )
  expect(validateFormQuestionDefault(file)).toBe(false)
  const routed = conditionalVersionWithDefault('yes')
  expect(stabilizeEffectiveFormAnswers(routed, {}).path.endingId).toBe('ending-yes')
})
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `pnpm --filter @repo/domain exec vitest run test/database/forms/form-answer-schema.test.ts test/database/forms/form-graph.test.ts`

Expected: FAIL because effective-answer helpers are absent.

- [ ] **Step 3: Implement bounded effective-answer stabilization**

Create `form-effective-answers.ts` with these exact semantics:

```ts
function sameEffectiveState(
  leftAnswers: Record<string, unknown>,
  leftPath: EvaluatedFormPath,
  rightAnswers: Record<string, unknown>,
  rightPath: EvaluatedFormPath,
): boolean {
  return (
    JSON.stringify({ answers: leftAnswers, path: leftPath }) ===
    JSON.stringify({ answers: rightAnswers, path: rightPath })
  )
}

export function isEmptyFormAnswer(question: PublicFormQuestion, value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (value === '' && !['NUMBER', 'CHECKBOX'].includes(question.input.kind)) return true
  return Array.isArray(value) && value.length === 0
}

export function stabilizeEffectiveFormAnswers(
  version: PublicFormVersion,
  rawAnswers: Record<string, unknown>,
): { answers: Record<string, unknown>; path: EvaluatedFormPath } {
  let answers = { ...rawAnswers }
  let path = evaluateFormPath(version, answers)
  for (let pass = 0; pass <= version.sections.length; pass += 1) {
    const visible = new Set(path.visibleQuestionIds)
    const next = Object.fromEntries(
      version.questions.flatMap((question) => {
        if (!visible.has(question.id)) return []
        const raw = answers[question.id]
        const value =
          isEmptyFormAnswer(question, raw) && question.defaultValue !== undefined
            ? question.defaultValue
            : raw
        return value === undefined ? [] : [[question.id, value]]
      }),
    )
    const nextPath = evaluateFormPath(version, next)
    if (sameEffectiveState(answers, path, next, nextPath)) return { answers: next, path: nextPath }
    answers = next
    path = nextPath
  }
  return { answers, path }
}
```

In `buildFormAnswerSchema`, validate `stabilizeEffectiveFormAnswers(version, answers).answers` but retain the raw envelope as the parsed value. Add `validateFormQuestionDefault` using `buildQuestionValueSchema({ ...question, required: true })`, with an unconditional false result for `FILE`.

- [ ] **Step 4: Run domain tests**

Run:

```bash
pnpm --filter @repo/domain exec vitest run test/database/forms/form-answer-schema.test.ts test/database/forms/form-graph.test.ts
pnpm --filter @repo/domain check-types
```

Expected: PASS, including default-driven conditional routing and explicit `0`/`false`.

- [ ] **Step 5: Commit effective-answer behavior**

```bash
git add packages/domain/src/database/forms/form-effective-answers.ts packages/domain/src/database/forms/form-answer-schema.ts packages/domain/src/database/forms/public.ts packages/domain/test/database/forms/form-answer-schema.test.ts packages/domain/test/database/forms/form-graph.test.ts
git commit -m "feat(forms): apply defaults to effective answers"
```

### Task 3: Server publication and submission authority

**Files:**

- Modify: `packages/domain/src/database/forms/database-form.service.ts:200-260, 680-780`
- Modify: `packages/domain/src/database/forms/database-form.repository.ts` draft parse call sites
- Modify: `packages/domain/src/database/forms/form-submission.service.ts:1240-1360`
- Test: `packages/domain/test/database/forms/database-form.service.test.ts`
- Test: `packages/domain/test/database/forms/form-submission.service.test.ts`
- Test: `packages/trpc/test/database-forms-submit.test.ts`

**Interfaces:**

- Consumes: `parseFormDraftVersionDocument`, `parseFormVersionDocument`, `stabilizeEffectiveFormAnswers`, `validateFormQuestionDefault`.
- Produces: authoritative `FORM_DEFAULT_VALUE_INVALID` publication failure and effective persisted values.

- [ ] **Step 1: Write failing authority tests**

Add tests that publish a blank-title draft, reject a file/invalid option default, persist a missing text default, preserve `false`, and omit a hidden default:

```ts
await expect(service.publish('owner', idsFor(blankTitleDraft))).rejects.toMatchObject({
  message: 'FORM_SCHEMA_INVALID',
})

await expect(submitWith({ answers: {} }, textDefaultDocument('fallback'))).resolves.toMatchObject({
  endingId: 'ending-1',
})
expect(databaseRepo.upsertCellValue).toHaveBeenCalledWith('row-1', 'property-text', 'fallback')

await submitWith({ answers: { checkbox: false } }, checkboxDefaultDocument(true))
expect(databaseRepo.upsertCellValue).toHaveBeenCalledWith('row-1', 'property-check', false)
```

- [ ] **Step 2: Run server tests and confirm RED**

Run:

```bash
pnpm --filter @repo/domain exec vitest run test/database/forms/database-form.service.test.ts test/database/forms/form-submission.service.test.ts
pnpm --filter @repo/trpc exec vitest run test/database-forms-submit.test.ts
```

Expected: FAIL because draft parsing rejects blank titles too early and submission writes `null` instead of the default.

- [ ] **Step 3: Make draft management tolerant and publication strict**

Use `parseFormDraftVersionDocument` for draft CRUD/read/duplication. In `validatePublication` parse the draft first, validate defaults, then require the strict public document:

```ts
const draft = parseFormDraftVersionDocument(form.draftSchema)
if (draft.presentation.title.trim() === '') throw badRequest('FORM_SCHEMA_INVALID')
const document = parseFormVersionDocument(draft)
for (const question of toPublicFormVersion(document).questions) {
  if (!validateFormQuestionDefault(question)) throw badRequest('FORM_DEFAULT_VALUE_INVALID')
}
```

After structural validation, call `await this.assertDefaultDependencies(form, document)`. Batch-check PERSON defaults through `findActiveWorkspaceMemberIds`, PAGE_LINK defaults through the existing accessible-page resolver, and RELATION defaults against the configured target source and visible target rows. Choice defaults must still exist in the current property option snapshot. A missing, blocked, moved, or inaccessible target throws `FORM_DEFAULT_VALUE_INVALID` before a version is created.

In `prepareSubmission`, compute effective answers after the dynamic schema succeeds and use them for path, validation planning, and row writes:

```ts
const rawAnswers = { ...options.lockedAnswers, ...input.answers }
const answersResult = buildFormAnswerSchema(validationVersion).safeParse({ answers: rawAnswers })
if (!answersResult.success) {
  const fieldErrors = Object.create(null) as Record<string, string[]>
  for (const issue of answersResult.error.issues) {
    const questionId = issue.path[0] === 'answers' ? issue.path[1] : undefined
    if (typeof questionId === 'string') addFieldError(fieldErrors, questionId, issue.message)
  }
  throw new FormValidationError(fieldErrors)
}
const effective = stabilizeEffectiveFormAnswers(validationVersion, rawAnswers)
const path = effective.path
// In the existing planning loop:
const value = effective.answers[question.id]
```

Retain existing PERSON/RELATION/PAGE_LINK current-access checks for default-generated values and keep hidden defaults outside `effective.answers`.

- [ ] **Step 4: Run focused server suites**

Run:

```bash
pnpm --filter @repo/domain exec vitest run test/database/forms/database-form.service.test.ts test/database/forms/form-submission.service.test.ts
pnpm --filter @repo/trpc exec vitest run test/database-forms-submit.test.ts
pnpm --filter @repo/domain check-types
pnpm --filter @repo/trpc check-types
```

Expected: PASS with no change to CAPTCHA/idempotency ordering tests.

- [ ] **Step 5: Commit server authority**

```bash
git add packages/domain/src/database/forms/database-form.service.ts packages/domain/src/database/forms/database-form.repository.ts packages/domain/src/database/forms/form-submission.service.ts packages/domain/test/database/forms/database-form.service.test.ts packages/domain/test/database/forms/form-submission.service.test.ts packages/trpc/test/database-forms-submit.test.ts
git commit -m "feat(forms): enforce defaults on server submission"
```

### Task 4: Builder reducer, safe title, defaults, and publication state

**Files:**

- Modify: `apps/web/src/components/database/forms/form-builder-state.ts`
- Modify: `apps/web/src/components/database/forms/form-builder-validation.ts`
- Modify: `apps/web/src/components/database/forms/form-builder.tsx`
- Create: `apps/web/src/lib/form-public-url.ts`
- Modify: `apps/web/src/components/database/forms/form-share-panel.tsx`
- Test: `apps/web/test/database-forms-builder-state.test.ts`
- Test: `apps/web/test/database-forms-builder-validation.test.ts`
- Test: `apps/web/test/database-forms-builder.test.tsx`

**Interfaces:**

- Produces reducer support for section/question `icon` and question `defaultValue`.
- Produces `canonicalFormUrl(form, origin)`, `canonicalSchemaJson(value)`, `hasUnpublishedFormChanges(form, document)`.
- Consumed by: Tasks 5, 6, and 9.

- [ ] **Step 1: Write failing builder tests**

Add assertions for blank-title autosave/readiness, default edits, and status transitions:

```ts
expect(validateFormPublishReadiness({ ...validInput(), document: blankTitle })).toMatchObject({
  ok: false,
  issues: [expect.objectContaining({ code: 'FORM_TITLE_REQUIRED' })],
})

const next = reduceBuilder(state, {
  type: 'QUESTION_UPDATED',
  questionId: 'question-1',
  patch: { defaultValue: 'fallback', icon: '💬' },
})
expect(next.document.questions[0]).toMatchObject({ defaultValue: 'fallback', icon: '💬' })
```

In the component test, assert the first publication replaces **Опубликовать** with **Опубликовано**, and a later edit exposes **Обновить публикацию** only.

- [ ] **Step 2: Run builder tests and confirm RED**

Run: `pnpm --filter web exec vitest run test/database-forms-builder-state.test.ts test/database-forms-builder-validation.test.ts test/database-forms-builder.test.tsx`

Expected: FAIL on unsupported reducer fields, draft parsing, and unchanged publish button.

- [ ] **Step 3: Implement builder state and semantic publication controls**

Extend `QUESTION_UPDATED`/`SECTION_UPDATED` picks, switch builder draft reads to `parseFormDraftVersionDocument`, and validate a trimmed title before the strict schema readiness pass. Extract canonical helpers from `form-share-panel.tsx`:

```ts
export function hasUnpublishedFormChanges(form: DatabaseManagedForm, draft: unknown): boolean {
  return (
    form.publishedVersion === null ||
    canonicalSchemaJson(draft) !== canonicalSchemaJson(form.publishedVersion.schema)
  )
}

const changedSincePublish = hasUnpublishedFormChanges(form, state.document)
const publishLabel = form.publishedVersionId === null ? 'Опубликовать' : 'Обновить публикацию'
```

Render:

```tsx
{
  form.publishedVersionId !== null && !changedSincePublish ? (
    <Chip color="success" icon={<CheckCircleIcon />} label="Опубликовано" />
  ) : (
    <Button variant="contained" onClick={() => void publishForm()}>
      {publishLabel}
    </Button>
  )
}
```

After `publish.mutateAsync`, store the complete returned form so the equality comparison updates in the same render.

- [ ] **Step 4: Run builder tests and web type checking**

Run:

```bash
pnpm --filter web exec vitest run test/database-forms-builder-state.test.ts test/database-forms-builder-validation.test.ts test/database-forms-builder.test.tsx test/database-forms-share-panel.test.tsx
pnpm --filter web check-types
```

Expected: PASS; no second **Опубликовать** action after success.

- [ ] **Step 5: Commit builder model behavior**

```bash
git add apps/web/src/components/database/forms/form-builder-state.ts apps/web/src/components/database/forms/form-builder-validation.ts apps/web/src/components/database/forms/form-builder.tsx apps/web/src/components/database/forms/form-share-panel.tsx apps/web/src/lib/form-public-url.ts apps/web/test/database-forms-builder-state.test.ts apps/web/test/database-forms-builder-validation.test.ts apps/web/test/database-forms-builder.test.tsx apps/web/test/database-forms-share-panel.test.tsx
git commit -m "fix(forms): stabilize drafts and publication state"
```

### Task 5: Local appearance editors and shared page icon picker

**Files:**

- Create: `apps/web/src/components/database/forms/form-icon-button.tsx`
- Create: `apps/web/src/components/database/forms/form-appearance-popover.tsx`
- Modify: `apps/web/src/components/database/forms/form-preview-canvas.tsx`
- Modify: `apps/web/src/components/database/forms/form-settings-panel.tsx`
- Modify: `apps/web/src/components/database/forms/form-presentation-editor.tsx`
- Modify: `apps/web/src/components/forms/form-renderer.tsx`
- Test: `apps/web/test/database-forms-editors.test.tsx`
- Test: `apps/web/test/database-forms-preview.test.tsx`
- Test: `apps/web/test/forms/form-renderer.test.tsx`

**Interfaces:**

- Consumes: reducer icon/default fields from Task 4.
- Produces: `FormAppearanceTarget = { kind: 'FORM' } | { kind: 'SECTION' | 'QUESTION'; id: string }`.
- Produces: `FormIconButton({ value, onChange, onRemove, label })` backed by `IconPickerPopover` and `PageIcon`.

- [ ] **Step 1: Write failing local-editor tests**

Cover the three local actions and the existing picker:

```tsx
await user.click(screen.getByRole('button', { name: 'Оформление формы' }))
expect(screen.getByRole('dialog', { name: 'Оформление формы' })).toBeVisible()
await user.click(screen.getByRole('button', { name: 'Выбрать иконку поля' }))
await user.click(screen.getByRole('button', { name: '💬' }))
expect(dispatch).toHaveBeenCalledWith(
  expect.objectContaining({
    type: 'QUESTION_UPDATED',
    patch: expect.objectContaining({ icon: '💬' }),
  }),
)
```

Assert that `FormSettingsPanel` no longer renders `FormPresentationEditor`, question label/description/input appearance, or section title/description.

- [ ] **Step 2: Run editor tests and confirm RED**

Run: `pnpm --filter web exec vitest run test/database-forms-editors.test.tsx test/database-forms-preview.test.tsx test/forms/form-renderer.test.tsx`

Expected: FAIL because local appearance triggers and page picker integration are absent.

- [ ] **Step 3: Implement contextual appearance controls**

Build `FormIconButton` with the existing components:

```tsx
const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

<IconButton aria-label={label} onClick={(event) => setAnchorEl(event.currentTarget)}>
  <PageIcon icon={value} size={24} fallback="＋" />
</IconButton>
<IconPickerPopover
  anchorEl={anchorEl}
  open={Boolean(anchorEl)}
  onClose={() => setAnchorEl(null)}
  onSelect={onChange}
  onRemove={value ? onRemove : undefined}
/>
```

Add optional preview callbacks to `FormRenderer`:

```ts
readonly onEditAppearance?: (target: FormAppearanceTarget, anchor: HTMLElement) => void
```

Render **Оформление формы** beside the presentation, **Оформление раздела** beside the active section, and **Оформление поля** plus the icon control beside each question only in preview mode. `FormAppearancePopover` dispatches `PRESENTATION_UPDATED`, `SECTION_UPDATED`, or `QUESTION_UPDATED`; the right inspector retains behavior/default/conditions/transitions and ending settings.

- [ ] **Step 4: Run editor, preview, renderer, and accessibility tests**

Run:

```bash
pnpm --filter web exec vitest run test/database-forms-editors.test.tsx test/database-forms-preview.test.tsx test/forms/form-renderer.test.tsx
pnpm --filter web check-types
```

Expected: PASS with icons rendered through `PageIcon`, including `url:` image icons.

- [ ] **Step 5: Commit appearance separation**

```bash
git add apps/web/src/components/database/forms/form-icon-button.tsx apps/web/src/components/database/forms/form-appearance-popover.tsx apps/web/src/components/database/forms/form-preview-canvas.tsx apps/web/src/components/database/forms/form-settings-panel.tsx apps/web/src/components/database/forms/form-presentation-editor.tsx apps/web/src/components/forms/form-renderer.tsx apps/web/test/database-forms-editors.test.tsx apps/web/test/database-forms-preview.test.tsx apps/web/test/forms/form-renderer.test.tsx
git commit -m "feat(forms): add contextual appearance editors"
```

### Task 6: Resizable and collapsible behavior inspector

**Files:**

- Create: `apps/web/src/components/database/forms/use-form-inspector-layout.ts`
- Modify: `apps/web/src/components/database/forms/form-builder.tsx`
- Modify: `apps/web/src/components/database/forms/form-settings-panel.tsx`
- Create: `apps/web/test/database-forms-inspector-layout.test.tsx`

**Interfaces:**

- Produces: `useFormInspectorLayout(storageKey)` returning `{ width, collapsed, resizeProps, collapse, expand }`.
- Width range: 280–520 px; keyboard step: 24 px; storage key: `anynote:forms:inspector-layout:v1`.

- [ ] **Step 1: Write failing resize/collapse tests**

```tsx
const separator = screen.getByRole('separator', { name: 'Изменить ширину панели настроек' })
fireEvent.keyDown(separator, { key: 'ArrowLeft' })
expect(separator).toHaveAttribute('aria-valuenow', '296')
await user.click(screen.getByRole('button', { name: 'Скрыть панель настроек' }))
expect(screen.queryByRole('complementary', { name: 'Настройки формы' })).not.toBeInTheDocument()
expect(localStorage.getItem('anynote:forms:inspector-layout:v1')).toContain('"collapsed":true')
```

- [ ] **Step 2: Run the inspector test and confirm RED**

Run: `pnpm --filter web exec vitest run test/database-forms-inspector-layout.test.tsx`

Expected: FAIL because the hook and separator are absent.

- [ ] **Step 3: Implement pointer and keyboard resizing**

The hook clamps and persists state:

```ts
const MIN = 280
const MAX = 520
const STEP = 24
const clamp = (value: number) => Math.min(MAX, Math.max(MIN, value))

function startPointerResize(event: React.PointerEvent<HTMLElement>) {
  const startX = event.clientX
  const startWidth = width
  event.currentTarget.setPointerCapture(event.pointerId)
  const move = (next: PointerEvent) => setWidth(clamp(startWidth + startX - next.clientX))
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop, { once: true })
}

const resizeProps = {
  role: 'separator' as const,
  tabIndex: 0,
  'aria-label': 'Изменить ширину панели настроек',
  'aria-orientation': 'vertical' as const,
  'aria-valuemin': MIN,
  'aria-valuemax': MAX,
  'aria-valuenow': width,
  onKeyDown: (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') setWidth((value) => clamp(value + STEP))
    if (event.key === 'ArrowRight') setWidth((value) => clamp(value - STEP))
  },
  onPointerDown: startPointerResize,
}
```

In `FormBuilder`, switch the grid to `280px minmax(460px, 1fr) 7px ${width}px` when expanded and `280px minmax(460px, 1fr) 40px` when collapsed. Keep an expand button visible in the collapsed rail.

- [ ] **Step 4: Run tests and type checks**

Run:

```bash
pnpm --filter web exec vitest run test/database-forms-inspector-layout.test.tsx test/database-forms-builder.test.tsx
pnpm --filter web check-types
```

Expected: PASS for pointer, keyboard, persistence, collapse, and restore.

- [ ] **Step 5: Commit inspector layout**

```bash
git add apps/web/src/components/database/forms/use-form-inspector-layout.ts apps/web/src/components/database/forms/form-builder.tsx apps/web/src/components/database/forms/form-settings-panel.tsx apps/web/test/database-forms-inspector-layout.test.tsx apps/web/test/database-forms-builder.test.tsx
git commit -m "feat(forms): resize and collapse behavior inspector"
```

### Task 7: External URL vocabulary and audience regression

**Files:**

- Modify: `apps/web/src/components/database/forms/form-property-picker.tsx`
- Modify: `apps/web/src/components/database/database-toolbar.tsx`
- Modify: `apps/web/src/components/database/property-config/property-settings-dialog.tsx`
- Modify: `apps/web/src/components/database/forms/form-builder-validation.ts`
- Modify: `packages/domain/src/database/forms/form-document.ts`
- Modify: `packages/domain/src/database/forms/public.ts`
- Modify: `packages/domain/src/database/forms/database-form.service.ts`
- Test: `apps/web/test/database-forms-property-picker.test.tsx`
- Test: `apps/web/test/database-forms-builder-validation.test.ts`
- Test: `packages/domain/test/database/forms/database-form.service.test.ts`

**Interfaces:**

- No new runtime interface; locks the shared labels and security boundary.

- [ ] **Step 1: Write failing label and publication tests**

```ts
expect(screen.getByRole('option', { name: 'Ссылка на сайт' })).toBeVisible()
expect(screen.getByRole('option', { name: 'Страница AnyNote' })).toBeVisible()
expect(validateFormPublishReadiness(publicUrlInput).ok).toBe(true)
await expect(service.publish('owner', urlFormFor('ANYONE_WITH_LINK'))).resolves.toBeDefined()
await expect(service.publish('owner', pageLinkFormFor('ANYONE_WITH_LINK'))).rejects.toMatchObject({
  message: 'FORM_AUDIENCE_INCOMPATIBLE',
})
```

- [ ] **Step 2: Run focused URL tests and confirm RED**

Run:

```bash
pnpm --filter web exec vitest run test/database-forms-property-picker.test.tsx test/database-forms-builder-validation.test.ts
pnpm --filter @repo/domain exec vitest run test/database/forms/database-form.service.test.ts
```

Expected: label assertions FAIL; the security regression tests document existing server behavior.

- [ ] **Step 3: Apply the distinct labels and centralized internal set**

Change every touched label map to:

```ts
URL: 'Ссылка на сайт',
PAGE_LINK: 'Страница AnyNote',
```

Export one framework-agnostic domain constant from `form-document.ts` through `public.ts`:

```ts
export const FORM_INTERNAL_PROPERTY_TYPES = new Set<FormPropertyType>([
  'PERSON',
  'RELATION',
  'PAGE_LINK',
])
```

Use this same exported constant in server publication and client readiness validation so the two gates cannot drift.

- [ ] **Step 4: Run URL and type tests**

Run the commands from Step 2 plus `pnpm --filter web check-types` and `pnpm --filter @repo/domain check-types`.

Expected: PASS; external `http(s)` URL publishes for `ANYONE_WITH_LINK` while AnyNote pages remain restricted.

- [ ] **Step 5: Commit URL distinction**

```bash
git add apps/web/src/components/database/forms/form-property-picker.tsx apps/web/src/components/database/database-toolbar.tsx apps/web/src/components/database/property-config/property-settings-dialog.tsx apps/web/src/components/database/forms/form-builder-validation.ts packages/domain/src/database/forms/form-document.ts packages/domain/src/database/forms/public.ts packages/domain/src/database/forms/database-form.service.ts apps/web/test/database-forms-property-picker.test.tsx apps/web/test/database-forms-builder-validation.test.ts packages/domain/test/database/forms/database-form.service.test.ts
git commit -m "fix(forms): distinguish websites from page links"
```

### Task 8: Full-height public layout, dedicated ending, and complete reset

**Files:**

- Modify: `apps/web/src/app/(form)/layout.tsx`
- Modify: `apps/web/src/app/(form)/f/[key]/form-page-client.tsx`
- Modify: `apps/web/src/components/forms/form-renderer.tsx`
- Modify: `apps/web/src/components/forms/form-ending.tsx`
- Test: `apps/web/test/forms/form-page-client.test.tsx`
- Test: `apps/web/test/forms/form-renderer.test.tsx`

**Interfaces:**

- Produces: `FormEnding` props `onStartOver?: () => void`, `homeHref?: string`.
- Produces: `FormRenderer.onStartOver?: () => void` and ending-only early return.

- [ ] **Step 1: Write failing layout and completion tests**

```tsx
expect(screen.getByRole('main', { name: 'Форма отправлена' })).toBeVisible()
expect(screen.queryByText('Маршрут')).not.toBeInTheDocument()
expect(screen.queryByText('Создано в AnyNote')).not.toBeInTheDocument()
expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute('href', '/')
await user.click(screen.getByRole('button', { name: 'Заполнить ещё раз' }))
expect(screen.getByRole('heading', { name: 'Раздел 1' })).toBeVisible()
expect(setPendingCaptchaToken).toHaveBeenCalledWith(null)
```

Also assert the renderer root uses a testable `data-testid="public-form-root"` with `min-height: 100dvh`.

- [ ] **Step 2: Run public-flow tests and confirm RED**

Run: `pnpm --filter web exec vitest run test/forms/form-page-client.test.tsx test/forms/form-renderer.test.tsx`

Expected: FAIL because completion is nested in normal form chrome and reset leaves success state set.

- [ ] **Step 3: Implement full-page and ending-only branches**

In `FormRenderer`, return the ending screen before rendering cover/sidebar/title/questions:

```tsx
if (activeEnding) {
  return (
    <FormEnding
      ending={activeEnding}
      preview={mode === 'preview'}
      ownResponseUrl={successResponseUrl}
      onStartOver={onStartOver}
      homeHref="/"
    />
  )
}
```

Give layout/renderer roots `minHeight: ['100vh', '100dvh']` and make the main grid stretch. In `FormPageClient`, hide global alerts after success and implement:

```ts
const handleStartOver = useCallback(() => {
  handleReset()
  setPendingCaptchaToken(null)
  setSuccessEndingId(undefined)
  setSuccessResponseUrl(undefined)
  setInitialAnswers({})
  setResetGeneration((value) => value + 1)
}, [handleReset])
```

Key the renderer by `resetGeneration` so RHF, uploads, path, and validation restart cleanly.

- [ ] **Step 4: Run public tests and type checks**

Run:

```bash
pnpm --filter web exec vitest run test/forms/form-page-client.test.tsx test/forms/form-renderer.test.tsx test/forms/form-page.test.tsx
pnpm --filter web check-types
```

Expected: PASS; completion contains only ending content and actions.

- [ ] **Step 5: Commit public layout and reset**

```bash
git add apps/web/src/app/'(form)'/layout.tsx apps/web/src/app/'(form)'/f/'[key]'/form-page-client.tsx apps/web/src/components/forms/form-renderer.tsx apps/web/src/components/forms/form-ending.tsx apps/web/test/forms/form-page-client.test.tsx apps/web/test/forms/form-renderer.test.tsx apps/web/test/forms/form-page.test.tsx
git commit -m "fix(forms): complete public and ending layouts"
```

### Task 9: Controlled date fields

**Files:**

- Create: `apps/web/src/components/forms/form-date-field.tsx`
- Modify: `apps/web/src/components/forms/form-field.tsx:520-639`
- Test: `apps/web/test/forms/form-renderer.test.tsx`

**Interfaces:**

- Produces: `FormDateField({ question, name, control, error, disabled })` supporting ISO date and offset date-time values.

- [ ] **Step 1: Write failing date-picker tests**

Mock MUI picker callbacks and verify accept/close/cancel behavior:

```tsx
await user.click(screen.getByLabelText('Дата визита'))
await user.click(screen.getByRole('gridcell', { name: '20' }))
expect(screen.queryByRole('dialog', { name: /Выберите дату/ })).not.toBeInTheDocument()
expect(screen.getByLabelText('Дата визита')).toHaveValue('20.07.2026')
```

Add a date-time assertion that submission emits an offset ISO instant and Escape retains the last accepted value.

- [ ] **Step 2: Run the renderer test and confirm RED**

Run: `pnpm --filter web exec vitest run test/forms/form-renderer.test.tsx -t "date"`

Expected: FAIL because the current implementation is a native input.

- [ ] **Step 3: Implement the RHF-controlled MUI picker adapter**

Use `Controller`, `LocalizationProvider`, `AdapterDateFns`, `dateFnsRu`, `DatePicker`, and `DateTimePicker`:

```tsx
function parseFormDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function serializeFormDate(value: Date | null, includeTime: boolean): string {
  if (value === null || Number.isNaN(value.getTime())) return ''
  if (includeTime) return value.toISOString()
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

;<Controller
  name={name}
  control={control}
  render={({ field }) => {
    const common = {
      value: parseFormDate(field.value),
      closeOnSelect: true,
      onAccept: (date: Date | null) => field.onChange(serializeFormDate(date, includeTime)),
      onClose: field.onBlur,
      slotProps: {
        textField: {
          label,
          error: Boolean(error),
          helperText: helper,
          fullWidth: true,
          size: 'small' as const,
        },
        field: { clearable: true },
      },
    }
    return includeTime ? <DateTimePicker {...common} /> : <DatePicker {...common} />
  }}
/>
```

Delete the native `DATE`/`datetime-local` branches from `form-field.tsx` and route both through `FormDateField`.

- [ ] **Step 4: Run renderer tests and web type checks**

Run:

```bash
pnpm --filter web exec vitest run test/forms/form-renderer.test.tsx
pnpm --filter web check-types
```

Expected: PASS; calendar closes on accept and ISO contracts remain unchanged.

- [ ] **Step 5: Commit date picker fix**

```bash
git add apps/web/src/components/forms/form-date-field.tsx apps/web/src/components/forms/form-field.tsx apps/web/test/forms/form-renderer.test.tsx
git commit -m "fix(forms): stabilize date picker interactions"
```

### Task 10: Local SVG QR dialog and canonical URL sharing

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/components/forms/form-qr-dialog.tsx`
- Modify: `apps/web/src/components/database/forms/form-share-panel.tsx`
- Modify: `apps/web/src/app/(form)/f/[key]/form-page-client.tsx`
- Create: `apps/web/test/forms/form-qr-dialog.test.tsx`
- Modify: `apps/web/test/database-forms-share-panel.test.tsx`

**Interfaces:**

- Consumes: `canonicalFormUrl` from Task 4.
- Produces: `FormQrDialog({ open, url, onClose })` with `<QRCodeSVG value={url} marginSize={4} title="QR-код формы" />`.

- [ ] **Step 1: Write failing QR tests**

```tsx
render(<FormQrDialog open url="https://anynote.ru/f/public-key" onClose={vi.fn()} />)
expect(screen.getByTitle('QR-код формы')).toBeVisible()
expect(screen.getByDisplayValue('https://anynote.ru/f/public-key')).toBeVisible()
await user.click(screen.getByRole('button', { name: 'Скачать SVG' }))
expect(URL.createObjectURL).toHaveBeenCalledOnce()
await user.click(screen.getByRole('button', { name: 'Копировать ссылку' }))
expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://anynote.ru/f/public-key')
```

- [ ] **Step 2: Run QR tests and confirm RED**

Run: `pnpm --filter web exec vitest run test/forms/form-qr-dialog.test.tsx test/database-forms-share-panel.test.tsx`

Expected: FAIL because `FormQrDialog` and the dependency are absent.

- [ ] **Step 3: Add `qrcode.react` and implement SVG actions**

Run: `pnpm --filter web add qrcode.react@^4.2.0`

Create the dialog with `QRCodeSVG`. Download by serializing the dialog's SVG through `XMLSerializer`, wrapping it in `new Blob([source], { type: 'image/svg+xml;charset=utf-8' })`, clicking a temporary `<a download="anynote-form-qr.svg">`, and always revoking the object URL. Add **QR-код** actions to the share panel and public page; both pass the canonical URL from `form-public-url.ts`.

- [ ] **Step 4: Run QR/share tests and build the web package**

Run:

```bash
pnpm --filter web exec vitest run test/forms/form-qr-dialog.test.tsx test/database-forms-share-panel.test.tsx test/forms/form-page-client.test.tsx
pnpm --filter web check-types
pnpm --filter web build
```

Expected: PASS; no network request occurs when opening or downloading the QR.

- [ ] **Step 5: Commit QR functionality**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/components/forms/form-qr-dialog.tsx apps/web/src/components/database/forms/form-share-panel.tsx apps/web/src/app/'(form)'/f/'[key]'/form-page-client.tsx apps/web/test/forms/form-qr-dialog.test.tsx apps/web/test/database-forms-share-panel.test.tsx apps/web/test/forms/form-page-client.test.tsx
git commit -m "feat(forms): add local QR sharing"
```

### Task 11: Response terminology and default-value editor controls

**Files:**

- Modify: `apps/web/src/components/database/database-item-modal.tsx`
- Modify: `apps/web/src/components/database/forms/form-responses-panel.tsx`
- Modify: `apps/web/src/components/database/forms/form-settings-panel.tsx`
- Create: `apps/web/src/components/database/forms/form-default-value-editor.tsx`
- Test: `apps/web/test/database-item-modal-row-override.test.tsx`
- Test: `apps/web/test/database-forms-responses-panel.test.tsx`
- Test: `apps/web/test/database-forms-editors.test.tsx`

**Interfaces:**

- Produces: `DatabaseItemModal.propertySectionLabel?: string`, defaulting to **Свойства**.
- Produces: `FormDefaultValueEditor({ question, onChange, loadPickerOptions })`, rendered in the behavior inspector; `FILE` renders an explanatory disabled state.

- [ ] **Step 1: Write failing scoped-label and default-editor tests**

```tsx
render(<DatabaseItemModal {...props} propertySectionLabel="Поля для заполнения" />)
expect(screen.getByText('Поля для заполнения')).toBeVisible()
expect(screen.queryByText('Свойства')).not.toBeInTheDocument()

await user.type(screen.getByLabelText('Значение по умолчанию'), 'Новая заявка')
expect(dispatch).toHaveBeenCalledWith(
  expect.objectContaining({
    type: 'QUESTION_UPDATED',
    patch: { defaultValue: 'Новая заявка' },
  }),
)
```

Cover number/false, choices, date, internal pickers, clear-default, and the FILE explanation.

- [ ] **Step 2: Run response/editor tests and confirm RED**

Run: `pnpm --filter web exec vitest run test/database-item-modal-row-override.test.tsx test/database-forms-responses-panel.test.tsx test/database-forms-editors.test.tsx`

Expected: FAIL because the scoped prop and default editor are absent.

- [ ] **Step 3: Implement the scoped label and typed default editor**

Add the modal prop with a safe default:

```tsx
export function DatabaseItemModal({ propertySectionLabel = 'Свойства', ...props }: Props) {
  // ...
  return <Typography variant="overline">{propertySectionLabel}</Typography>
}
```

Pass `propertySectionLabel="Поля для заполнения"` only from `FormResponsesPanel`. Create `FormDefaultValueEditor` and mount it in the behavior inspector, reusing the same option/date/internal-picker adapters as question inputs while keeping its state editor-only. Clearing dispatches `{ defaultValue: undefined }`; FILE renders `Для файлов значение по умолчанию недоступно`.

- [ ] **Step 4: Run response/editor tests and type checks**

Run:

```bash
pnpm --filter web exec vitest run test/database-item-modal-row-override.test.tsx test/database-forms-responses-panel.test.tsx test/database-forms-editors.test.tsx
pnpm --filter web check-types
```

Expected: PASS; ordinary database item tests still find **Свойства**.

- [ ] **Step 5: Commit response/default UI**

```bash
git add apps/web/src/components/database/database-item-modal.tsx apps/web/src/components/database/forms/form-responses-panel.tsx apps/web/src/components/database/forms/form-settings-panel.tsx apps/web/src/components/database/forms/form-default-value-editor.tsx apps/web/test/database-item-modal-row-override.test.tsx apps/web/test/database-forms-responses-panel.test.tsx apps/web/test/database-forms-editors.test.tsx
git commit -m "feat(forms): add default editor and response labels"
```

### Task 12: Twelve-point Playwright matrix, release gates, and production deploy

**Files:**

- Modify: `apps/e2e/database-forms.spec.ts`
- Modify only if required by verified behavior: focused source/test files from Tasks 1–11

**Interfaces:**

- Consumes every completed slice.
- Produces browser evidence under `output/playwright/` and a deployed semantic version.

The named Playwright steps map one-to-one to the reported issues:

1. Clear the form title, confirm the builder stays mounted and shows the title-readiness issue, then enter a valid title and observe a successful save.
2. Open the question icon picker, select an emoji, verify it on the canvas, reopen the same picker, and remove it.
3. Drag the inspector separator, collapse the inspector, reload, verify the persisted collapsed state, and expand it again.
4. Open form, section, and field appearance from their three local canvas buttons and assert the right inspector remains on behavior controls.
5. Create **Ссылка на сайт**, keep `ANYONE_WITH_LINK`, publish successfully, submit `https://example.com`, and verify the stored URL cell.
6. Assert **Опубликовано** and no **Опубликовать** button after publication; edit the draft, click **Обновить публикацию**, and return to **Опубликовано**.
7. Compare the public form root to the desktop and mobile viewport heights and assert no horizontal overflow.
8. Submit the form, assert all form chrome is absent, follow **На главную**, return, submit again, and use **Заполнить ещё раз** to reach a fresh first section.
9. Open QR from the public form and share panel, assert the canonical URL, copy it, and save a non-empty `anynote-form-qr.svg` download.
10. Open the created response and assert **Поля для заполнения**; open an ordinary database row and retain **Свойства**.
11. Leave the configured defaulted field visually empty, submit, and query Prisma for the persisted fallback value.
12. Record the date input bounding box, choose a calendar date, assert the picker closes, and compare the post-selection position and width.

- [ ] **Step 1: Extend Playwright with twelve named release steps**

Keep the existing authenticated database fixture and add one `test.step` for each numbered requirement. Use stable role/test-id selectors and direct Prisma assertions only for persisted server outcomes:

```ts
await test.step('11 · пустое поле получает серверное значение по умолчанию', async () => {
  await respondent.getByRole('textbox', { name: 'Комментарий' }).fill('')
  await respondent.getByRole('button', { name: 'Отправить' }).click()
  const stored = await prisma.databaseCellValue.findFirstOrThrow({
    where: { propertyId: defaultPropertyId, row: { pageId: submittedPageId } },
  })
  expect(stored.value).toBe('Новая заявка')
})

await test.step('12 · календарь закрывается и поле не прыгает', async () => {
  const input = respondent.getByLabel('Дата визита')
  const before = await input.boundingBox()
  await input.click()
  await respondent.getByRole('gridcell', { name: '20' }).click()
  await expect(respondent.getByRole('dialog')).toHaveCount(0)
  expect(await input.boundingBox()).toMatchObject({ x: before!.x, width: before!.width })
})
```

For QR, assert the SVG has the canonical URL through its component test attribute and verify the downloaded artifact. For the full-page check, compare `[data-testid="public-form-root"]` bounding height with `window.innerHeight` at desktop and mobile viewports. Save screenshots of builder, public form, and completion to `output/playwright/`.

- [ ] **Step 2: Run Playwright and fix only observed failures**

Prerequisite: `command -v npx >/dev/null 2>&1`.

Run: `pnpm exec playwright test apps/e2e/database-forms.spec.ts --project=chromium`

Expected: `1 passed` with twelve named steps. On failure, inspect the retained trace, diagnose the root cause, add or tighten the corresponding focused test, make the minimal fix, and rerun the focused unit test before rerunning Playwright.

- [ ] **Step 3: Run the complete local release gate**

Run:

```bash
pnpm check-types
pnpm lint
pnpm check-architecture
pnpm build
pnpm test
pnpm exec playwright test apps/e2e/database-forms.spec.ts --project=chromium
git diff --check
```

Expected: all commands PASS; no unintended files are staged or modified.

- [ ] **Step 4: Review, merge, push, and wait for release**

Use `superpowers:requesting-code-review`, address verified findings, then use `superpowers:finishing-a-development-branch` and `github:yeet`. Merge the isolated branch into local `main` without touching the user's dirty files, verify the merge commit, and push:

```bash
git switch main
git merge --no-ff codex/forms-polish-defaults
git push origin main
gh run list --workflow release.yml --branch main --limit 1
```

Expected: the `Release` run completes with `conclusion: success`, semantic-release creates the next version after `v1.39.0`, and dispatches `Deploy` for that tag.

- [ ] **Step 5: Wait for deploy and verify production independently**

```bash
gh run list --workflow deploy.yml --limit 3
curl -fsS https://anynote.ru/api/health
FORM_URL="$(pbpaste)"
case "$FORM_URL" in https://anynote.ru/f/*) ;; *) echo "Copy the disposable production form URL first"; exit 1;; esac
curl -fsSI "$FORM_URL"
```

Expected: the tag's `Deploy` run completes successfully; `/api/health` reports the new version; a real published form loads, accepts a CAPTCHA-protected submission, stores its default value, opens its QR dialog, fills the viewport, and shows the isolated completion screen. Use a disposable production form created for this verification and remove/close it through the normal form-management UI after evidence is captured.

Do not treat an unknown `/f/{key}` unavailable page as proof of the respondent flow.
