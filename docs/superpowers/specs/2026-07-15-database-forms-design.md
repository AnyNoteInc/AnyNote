# Database forms — Notion-parity intake forms for AnyNote

Status: proposed implementation specification based on the approved design
(2026-07-15).

## Goal

Add forms to generic AnyNote databases. A database can own multiple forms, each with
its own questions, audience, public address, branching flow, published versions and
response list. A respondent opens `https://anynote.ru/f/{key-or-slug}` and a valid
submission creates a normal page-backed database row.

The design follows Notion's core model — a form is a database view and every question
maps to a database property — while adding explicit versioning, server-authoritative
validation and a hardened public submission boundary.

## Notion Forms research

Primary sources reviewed on 2026-07-15:

- [Forms — Notion Help Centre](https://www.notion.com/en-gb/help/forms)
- [Use forms to collect, organize and act on responses](https://www.notion.com/help/guides/use-forms-to-collect-organize-and-act-on-responses-in-notion)
- [Notion Forms product page](https://www.notion.com/en-gb/product/forms)
- [Notion 2.49 — conditional logic release](https://www.notion.com/releases/2025-03-26)
- [Database properties](https://www.notion.com/help/database-properties)
- [Views, filters, sorts and groups](https://www.notion.com/help/views-filters-and-sorts)

### Core model

- A Notion form is connected to a database. Each question is connected to one
  database property, and each response becomes a database item.
- A form can be created from scratch with `/form` or added as a view to an existing
  database. Creating a form from an existing database requires full access.
- Multiple forms can feed one database. They may share common properties while asking
  different questions for different audiences.
- A form created from scratch adds a respondent property. A form created from an
  existing database can use `Created by` to retain the respondent identity.

### Builder and presentation

Notion supports:

- title, optional description, icon and cover;
- required questions and per-question descriptions;
- short or long text;
- list or dropdown presentation for choice questions;
- question types backed by database property types, including text, number, date,
  select, multi-select, person, relation and files/media;
- maximum selections for multi-select, relation and people questions;
- a `Sync with property name` toggle; when enabled, renaming the question also renames
  the property;
- duplicate/delete question actions;
- conditional logic for follow-up questions on higher plans;
- preview before sharing;
- configurable submit button color/text, confirmation title/body and an email copy of
  submissions.

### Sharing, identity and submission access

Notion's fill audiences are workspace users with the link, anyone on the web with the
link, and no access. Public web respondents can fill without a Notion account and are
anonymous automatically. Internal non-anonymous forms can grant a respondent no
access, view, comment, edit or full access to the submitted page.

Public branding can be disabled on a paid plan. Enterprise owners can disable public
sites, links and forms for the whole workspace.

Forms can be filled on desktop and mobile. Creating and customising forms is currently
limited to desktop/web.

### Responses and downstream workflow

- Responses appear in a table view named `Responses`; questions appear as database
  properties.
- Normal database filters, sorts and chart views can analyse the responses.
- A form view itself cannot be exported; the corresponding table view can.
- Database automations can react to a new response or answer values and then assign
  people, change properties, send email/Slack messages or invoke webhooks.
- Notion documents a high-volume caveat: a very large response collection may load
  slowly, so response handling must remain paginated and indexed.

### Plans

Notion markets unlimited forms and responses on the free plan. Conditional logic is
limited to Business/Enterprise, and public branding removal requires a paid plan.

## Approved AnyNote product decisions

- One database can own multiple forms.
- A form can be filled by anyone with the link, any signed-in AnyNote user with the
  link, or workspace members with the link. The owner chooses the audience.
- Public submissions remain anonymous even if the browser currently has an AnyNote
  session. Signed-in audiences record the respondent automatically.
- Signed-in respondents can receive `NONE`, `VIEW` or `EDIT` access to their own
  response. Anonymous respondents receive only the configured ending screen.
- All editable AnyNote database property types are available. `PERSON`, `RELATION`
  and `PAGE_LINK` require the workspace-members audience so internal names and records
  are never exposed publicly.
- Formula, rollup and created/last-edited metadata properties are computed and never
  become questions.
- If no title question is present, the server creates `Ответ · <localized timestamp>`.
- Full branching is section-based: several questions may appear on a step; transitions
  target another section or one of several ending screens. Question-level visibility
  is also supported.
- Respondent drafts stay in the browser. No row is created until final submission.
  Temporary file objects are the only unavoidable server-side draft artefact.
- Builder changes are drafts. Publishing creates an immutable version. A respondent
  who already opened the form may submit the version they opened during a bounded
  grace period.
- Public form submission uses the same Google reCAPTCHA v3 setup as authentication.
- Files inherit workspace storage limits. Each question configures allowed types,
  maximum size and maximum file count. Abandoned uploads are removed automatically.
- Each accepted row records its source form, published version, respondent (if any),
  ending and idempotency key.
- New responses notify form owners and emit a standard webhook event. A dedicated
  automation builder is deferred.
- Generated links use an unpredictable key. A custom global slug is optional.
- Owners can open/close manually, schedule opening/closing and cap accepted responses.
- Public presentation uses the approved A2 direction: an open document layout with a
  branded cover, organization identity, progress and a section map; no floating card.
- Basic forms are available on all plans. Conditional branching, custom slugs and
  hiding AnyNote branding are feature-gated to Pro+.
- Client forms use React Hook Form. A Zod schema is generated dynamically from the
  published form definition on the client and independently regenerated on the server.

## Existing AnyNote context

The feature extends, rather than replaces, the current database system:

- `DatabaseSource` owns views, properties and page-backed rows.
- `DatabaseViewType` currently has `TABLE`, `BOARD`, `CALENDAR` and `LIST`; `FORM` is
  explicitly listed in schema comments as roadmap-only.
- Every database item is a real `Page`; `DatabaseRow` is the source/order bridge and
  `DatabaseCellValue` stores JSON values.
- `DatabaseService.createRow` currently requires an authenticated actor and creates the
  item page, then the row bridge, in one unit of work.
- Database reads and writes already enforce row-level access rules, structure locks,
  relation visibility and property validation.
- Current row/cell tRPC procedures are protected. A public form must not expose them
  directly.
- Public pages already use unpredictable 256-bit share IDs, workspace security policy
  `disablePublicLinksSitesForms`, password hashing and a single access resolver.
- React Hook Form is already present through `@repo/ui`; Zod 4 is already used in web,
  domain and tRPC. `@hookform/resolvers` is not present and must be added to the package
  that owns the respondent renderer.
- Authentication uses Google reCAPTCHA v3 through `react-google-recaptcha-v3`,
  `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY` and the
  `x-captcha-response` header.

## Scope

### In scope

- `FORM` database views and multiple forms per source.
- Builder, draft autosave, preview and publish history.
- Sections, question visibility, typed conditions, transitions and multiple endings.
- Public/signed-in/workspace audiences.
- Generated key and optional custom slug.
- Responsive A2 respondent renderer under `/f/{key-or-slug}`.
- All editable property types, temporary file uploads and existing relation storage.
- Dynamic React Hook Form + Zod validation and independent server validation.
- reCAPTCHA v3, honeypot, rate limiting, idempotency and response limits.
- Atomic row creation and submission provenance.
- Owner response list and signed-in respondent view/edit route.
- Owner notification and webhook event.
- Feature flags for Pro+ capabilities.

### Explicitly deferred

- A form-specific automation builder.
- Comment or full workspace/page access for respondents.
- Secret edit links for anonymous respondents.
- Form analytics dashboard and a new CHART database view.
- Embedding a live form inside a public AnyNote page/site.
- Mobile form builder; mobile filling remains supported.
- CAPTCHA providers other than the existing Google reCAPTCHA v3 setup.
- Import/export of the form definition.
- Custom form domains.

## Architecture

The design is a hybrid:

1. `DatabaseView(type=FORM)` is the database-tab/UI entry point.
2. `DatabaseForm` owns routing, audience, lifecycle, schedule, limits and mutable draft.
3. `DatabaseFormVersion` stores immutable published form documents.
4. `DatabaseFormSubmission` links an accepted database row to its form/version and
   respondent.
5. `DatabaseFormUpload` leases a pending file to one form/version until it is consumed
   or expires.

Three framework-independent services own behaviour:

- `DatabaseFormService`: lifecycle, drafts, validation, publication, link management,
  response listing and structure dependencies.
- `FormAccessResolver`: the single authority for whether a form schema, upload,
  submission or respondent response is accessible.
- `FormSubmissionService`: branch evaluation, dynamic validation, semantic checks and
  the atomic creation/update path.

The protected builder API and public route both call these services. The public client
never calls `database.createRow`, `database.updateCellValue` or relation mutation
procedures directly.

## Data model

One Prisma migration extends `DatabaseViewType`, adds reverse relations, introduces the
following enums/models and changes `FILE` values from one file ID to an array of IDs.
The following excerpt is the persistence contract: its scalar fields, nullability,
unique constraints and indexes are required. Prisma relation annotations use the
explicit relation names listed after the excerpt so the current-version relation and
the version-history relation remain distinct.

```prisma
enum DatabaseViewType {
  TABLE
  BOARD
  CALENDAR
  LIST
  FORM
}

enum DatabaseFormState {
  DRAFT
  OPEN
  CLOSED
  ARCHIVED
}

enum DatabaseFormAudience {
  ANYONE_WITH_LINK
  SIGNED_IN_WITH_LINK
  WORKSPACE_MEMBERS_WITH_LINK
}

enum DatabaseFormRespondentAccess {
  NONE
  VIEW
  EDIT
}

model DatabaseForm {
  id                 String                       @id @default(uuid(7)) @db.Uuid
  sourceId           String                       @map("source_id") @db.Uuid
  viewId             String?                      @unique @map("view_id") @db.Uuid
  routeKey           String                       @unique @map("route_key") @db.VarChar(64)
  customSlug         String?                      @unique @map("custom_slug") @db.VarChar(64)
  linkRevision       Int                          @default(1) @map("link_revision")
  state              DatabaseFormState            @default(DRAFT)
  audience           DatabaseFormAudience         @default(ANYONE_WITH_LINK)
  respondentAccess   DatabaseFormRespondentAccess @default(NONE) @map("respondent_access")
  draftSchema        Json                         @map("draft_schema")
  draftRevision      Int                          @default(1) @map("draft_revision")
  publishedVersionId String?                      @unique @map("published_version_id") @db.Uuid
  opensAt            DateTime?                    @map("opens_at") @db.Timestamptz(6)
  closesAt           DateTime?                    @map("closes_at") @db.Timestamptz(6)
  responseLimit      Int?                         @map("response_limit")
  acceptedResponses  Int                          @default(0) @map("accepted_responses")
  notifyOwners       Boolean                      @default(true) @map("notify_owners")
  createdById        String                       @map("created_by_id") @db.Uuid
  createdAt          DateTime                     @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime                     @updatedAt @map("updated_at") @db.Timestamptz(6)

  source           DatabaseSource
  view             DatabaseView?
  publishedVersion DatabaseFormVersion?
  versions         DatabaseFormVersion[]
  submissions      DatabaseFormSubmission[]
  uploads          DatabaseFormUpload[]
  createdBy        User

  @@index([sourceId])
  @@index([state, opensAt, closesAt])
  @@map("database_forms")
}

model DatabaseFormVersion {
  id            String   @id @default(uuid(7)) @db.Uuid
  formId        String   @map("form_id") @db.Uuid
  versionNumber Int      @map("version_number")
  schemaVersion Int      @default(1) @map("schema_version")
  schema        Json
  schemaHash    String   @map("schema_hash") @db.VarChar(64)
  publishedById String   @map("published_by_id") @db.Uuid
  publishedAt   DateTime @default(now()) @map("published_at") @db.Timestamptz(6)
  acceptUntil   DateTime? @map("accept_until") @db.Timestamptz(6)

  form          DatabaseForm
  publishedBy   User
  submissions   DatabaseFormSubmission[]
  uploads       DatabaseFormUpload[]

  @@unique([formId, versionNumber])
  @@index([formId, publishedAt(sort: Desc)])
  @@map("database_form_versions")
}

model DatabaseFormSubmission {
  id               String   @id @default(uuid(7)) @db.Uuid
  formId           String   @map("form_id") @db.Uuid
  versionId        String   @map("version_id") @db.Uuid
  rowId            String   @unique @map("row_id") @db.Uuid
  respondentUserId String?  @map("respondent_user_id") @db.Uuid
  endingId         String   @map("ending_id") @db.VarChar(64)
  idempotencyKey   String   @map("idempotency_key") @db.Uuid
  submittedAt      DateTime @default(now()) @map("submitted_at") @db.Timestamptz(6)

  form             DatabaseForm
  version          DatabaseFormVersion
  row              DatabaseRow
  respondentUser   User?

  @@unique([formId, idempotencyKey])
  @@index([formId, submittedAt(sort: Desc)])
  @@index([respondentUserId, submittedAt(sort: Desc)])
  @@map("database_form_submissions")
}

model DatabaseFormUpload {
  id              String    @id @default(uuid(7)) @db.Uuid
  formId          String    @map("form_id") @db.Uuid
  versionId       String    @map("version_id") @db.Uuid
  questionId      String    @map("question_id") @db.VarChar(64)
  fileId          String    @unique @map("file_id") @db.Uuid
  uploadTokenHash String    @map("upload_token_hash") @db.VarChar(64)
  expiresAt       DateTime  @map("expires_at") @db.Timestamptz(6)
  consumedAt      DateTime? @map("consumed_at") @db.Timestamptz(6)
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  form            DatabaseForm
  version         DatabaseFormVersion
  file            File

  @@index([formId, versionId, questionId])
  @@index([formId, expiresAt])
  @@index([expiresAt, consumedAt])
  @@map("database_form_uploads")
}
```

Required reverse relations:

- `DatabaseSource.forms DatabaseForm[]`.
- `DatabaseView.form DatabaseForm?`.
- `DatabaseRow.formSubmission DatabaseFormSubmission?`.
- `File.formUpload DatabaseFormUpload?`.
- User reverse relations for form creation, publication and respondent identity.

### Data invariants

- An active `FORM` view has exactly one non-archived `DatabaseForm`. Generic
  `createView` must not create `FORM`; `createForm` creates the view and form together.
- Deleting a FORM view archives the form and clears `viewId` in one transaction. The
  submission provenance remains. Deleting the whole source cascades forms and rows.
- `publishedVersionId` must point to a version belonging to the same form; the domain
  enforces this cross-row invariant.
- Published version rows are append-only. Publishing a new version performs the only
  permitted update: it sets `acceptUntil` on the immediately preceding current
  version.
- `acceptedResponses` counts historically accepted submissions and does not decrement
  when a row is later soft-deleted.
- `respondentAccess` is forced to `NONE` for `ANYONE_WITH_LINK`.
- `PERSON`, `RELATION` or `PAGE_LINK` questions require
  `WORKSPACE_MEMBERS_WITH_LINK` at publish time.
- `customSlug` is stored normalized lowercase. Generated keys start with `anf_` so a
  user slug can never collide syntactically with a generated key.

## Published form document

`draftSchema` and `DatabaseFormVersion.schema` use a statically validated,
version-numbered JSON document. Local IDs are stable opaque strings (not property IDs)
so a browser draft can remap answers after a compatible republish.

```ts
type FormVersionDocument = {
  schemaVersion: 1
  firstSectionId: string
  presentation: {
    title: string
    description?: string
    icon?: string
    cover?: { kind: 'color' | 'gradient' | 'image'; value: string }
    organizationName?: string
    submitButtonText: string
    submitButtonColor?: string
    hideAnyNoteBranding: boolean
  }
  sections: FormSection[]
  questions: FormQuestion[]
  transitions: FormTransition[]
  endings: FormEnding[]
}

type FormSection = {
  id: string
  title: string
  description?: string
  questionIds: string[]
}

type FormPropertyRef =
  { kind: 'TITLE' } | { kind: 'PROPERTY'; propertyId: string; propertyType: DatabasePropertyType }

type FormQuestion = {
  id: string
  sectionId: string
  property: FormPropertyRef
  label: string
  description?: string
  required: boolean
  syncWithPropertyName: boolean
  visibleWhen?: FormConditionGroup
  input: FormInputConfig
}

type FormTransition = {
  id: string
  fromSectionId: string
  priority: number
  when: FormConditionGroup | null // null is the required fallback
  target: { kind: 'SECTION'; sectionId: string } | { kind: 'ENDING'; endingId: string }
}

type FormEnding = {
  id: string
  title: string
  body?: string
  button?: { label: string; href: string }
}

type FormOptionSnapshot = {
  id: string
  label: string
  color?: string
}

type FormInputConfig =
  | {
      kind: 'TEXT'
      multiline: boolean
      minLength?: number
      maxLength: number
    }
  | { kind: 'NUMBER'; min?: number; max?: number; step?: number }
  | {
      kind: 'SINGLE_CHOICE'
      appearance: 'RADIO' | 'LIST' | 'DROPDOWN'
      options: FormOptionSnapshot[]
    }
  | {
      kind: 'MULTI_CHOICE'
      appearance: 'CHECKLIST' | 'MULTI_PICKER'
      options: FormOptionSnapshot[]
      minSelections?: number
      maxSelections: number
    }
  | { kind: 'CHECKBOX'; consent: boolean }
  | { kind: 'DATE'; includeTime: boolean }
  | { kind: 'URL' | 'EMAIL' | 'PHONE' }
  | {
      kind: 'FILE'
      allowedMimeTypes: string[]
      maxBytesPerFile: number
      maxFiles: number
    }
  | { kind: 'PERSON' | 'RELATION'; maxSelections: number }
  | { kind: 'PAGE_LINK' }
```

`FormConditionGroup` is a recursively bounded `ALL`/`ANY` tree containing typed
conditions over earlier questions. There is no formula source, `eval` or arbitrary JS.
Operators are selected by question value type: equality/inequality, contains,
empty/not-empty, numeric comparisons, date before/after/on, checkbox state and option
membership.

Limits keep compile/evaluation bounded: at most 100 sections, 500 questions, 1,000
transitions, condition depth 8 and 512 KiB of version JSON. The final non-file submit
payload is limited to 1 MiB before parsing answers.

### Graph rules checked at publish

- IDs are unique and every reference resolves.
- Every section has exactly one unconditional fallback transition.
- Transition priorities are unique within a section.
- The graph is acyclic.
- Every reachable section reaches an ending.
- Unreachable sections/endings are publication errors, not silent dead content.
- A database property is used by at most one question in a version.
- A condition may reference only a question available earlier on every path to the
  condition.
- Every property exists in the same source and still has the recorded property type.
- Choice IDs and relation targets are valid.
- Redirects are relative AnyNote paths or HTTPS URLs; unsafe schemes are rejected.

## Property-to-question mapping

| Database property            | Form input             | Stored value / notes                                                         |
| ---------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| system Title                 | short/long text        | `Page.title`; optional; automatic title when absent                          |
| `TEXT`                       | short/long text        | string; min/max length                                                       |
| `NUMBER`                     | number                 | finite number; optional min/max/step; existing number format                 |
| `STATUS`, `SELECT`           | radio/list/dropdown    | one existing option ID                                                       |
| `MULTI_SELECT`               | checklist/multi-picker | option ID array; min/max selections                                          |
| `CHECKBOX`                   | checkbox/consent       | boolean; required consent means `true`                                       |
| `DATE`                       | date or date-time      | existing ISO date cell contract; no range in v1                              |
| `URL`                        | URL                    | normalized, length-bounded URL                                               |
| `EMAIL`                      | email                  | Zod email validation and length bound                                        |
| `PHONE`                      | phone text             | normalized display value; conservative format validation                     |
| `FILE`                       | upload                 | array of leased file IDs; MIME/size/count limits                             |
| `PERSON`                     | member picker          | current single-person cell semantics; workspace audience only                |
| `RELATION`                   | row picker             | existing `DatabaseRelationLink` set; max selections; workspace audience only |
| `PAGE_LINK`                  | page picker            | existing single page-link semantics; workspace audience only                 |
| `FORMULA`, `ROLLUP`          | none                   | computed; never a question                                                   |
| `CREATED_*`, `LAST_EDITED_*` | none                   | derived; never a question                                                    |

`FILE` readers accept the legacy string during migration, but all new writes use an
array. Existing single values are migrated to `[fileId]`; null/empty remains empty.
Cell editors, export and computed-cell handling must be updated consistently.

Question labels and property names are decoupled when the owner disables
`syncWithPropertyName`. It defaults to true to match Notion; turning it off makes
question copy independent. A synchronized rename is a structure mutation and obeys
the existing structure lock.

## Versioning and property dependencies

- The builder autosaves one mutable `draftSchema` using optimistic concurrency on
  `draftRevision`. A stale revision returns a conflict and never overwrites a newer
  draft silently.
- Publishing fully validates the draft and creates the next immutable version in one
  transaction. The form points `publishedVersionId` to it. The first successful
  publish changes `DRAFT` to `OPEN`; a republish preserves `OPEN` or `CLOSED`.
- When republishing, the prior current version receives `acceptUntil = now + 24h`.
  A signed version token also expires after 24 hours. This satisfies the promise that
  an already-open form can finish while bounding stale-schema exposure.
- Server acceptance requires the version to be current or still before `acceptUntil`,
  a valid signed token, unchanged `linkRevision`, and a currently open form.
- Closing, archiving or rotating links rejects all tokens immediately regardless of
  version grace.
- Destructive property changes are blocked while a current or grace-period version
  depends on the property: delete, type change, relation-target change, or removal of
  referenced choice IDs. Adding options and renaming labels are allowed; the published
  snapshot keeps its presentation until republished.
- Old submission response pages tolerate later property deletion: the removed field is
  shown as unavailable and cannot be edited. Historical submission provenance remains.

`versionToken` is a base64url payload plus HMAC-SHA-256 signature. Its payload contains
only a locator hash, version number, schema hash, link revision, issued-at and expiry;
it exposes no database IDs. Production requires a random `FORM_TOKEN_SECRET` of at
least 32 bytes. The verifier accepts only the configured algorithm, compares the
signature in constant time and rechecks every mutable form condition from storage.
Upload bearer tokens are separate 32-byte random values; only their SHA-256 hashes are
stored.

## Lifecycle and plan features

Effective availability is derived, not stored:

1. state must be `OPEN`;
2. a published version must exist;
3. workspace policy must allow forms;
4. `opensAt` must be null/past;
5. `closesAt` must be null/future;
6. `acceptedResponses < responseLimit` when a limit exists.

`DRAFT` is the pre-first-publish state. An open form may have unpublished draft changes
without leaving `OPEN`. `CLOSED` preserves links/settings and can be reopened.
`ARCHIVED` is terminal from the normal UI and removes the FORM view while preserving
accepted database rows.

Extend `PlanFeatures` via the existing plan `features` JSON mapping:

- `formConditionalLogicEnabled`
- `formCustomSlugEnabled`
- `formBrandingRemovalEnabled`

All plans can create multiple basic forms, use linear sections, publish generated links
and accept responses. Pro+ can publish `visibleWhen`, conditional transitions, multiple
endings, a custom slug or `hideAnyNoteBranding=true`.

Use feature flags, never hard-coded plan slugs. Follow AnyNote's non-destructive soft
downgrade convention: an already-published advanced version stays available; a new
advanced version or newly gated setting cannot be published until the workspace
upgrades.

## Access model

### Management

- Create form, edit draft, reorder questions/sections and synchronized property changes:
  existing `assertCanEditStructure` on the database source.
- Publish, close/reopen, audience, respondent access, schedule, response limit, slug,
  branding and key rotation: source page creator or workspace OWNER/ADMIN (the same
  authority class used to manage public exposure).
- When `structureLocked`, only OWNER/ADMIN can change the builder or publication
  settings.
- Response list/read/edit continues to use existing row access resolution. A form never
  bypasses database row ACL for workspace users.

### Fill audiences

- `ANYONE_WITH_LINK`: no login; public-safe property types only; no automatic account
  identity even when a browser session exists.
- `SIGNED_IN_WITH_LINK`: any signed-in AnyNote user can submit. This audience cannot
  publish internal picker questions because an arbitrary account has no workspace ACL.
- `WORKSPACE_MEMBERS_WITH_LINK`: requires membership; enables PERSON, RELATION and
  PAGE_LINK pickers. Picker options are still filtered through normal viewer access.

### Respondent access

Only a submission created under a signed-in audience can grant respondent access.
`/f/{locator}/responses/{submissionId}` requires the current user to equal
`submission.respondentUserId` and rechecks workspace policy and current form
`respondentAccess`.

- `NONE`: the route is unavailable.
- `VIEW`: render submitted-version labels and current row values read-only.
- `EDIT`: edit only fields represented by the submitted form version and still present
  with the same type. Updates reuse dynamic Zod and semantic validation.

This route does not create workspace membership, PageShare rows or access to the source,
item-page body, other rows or database views.

## Domain modules

Add a focused, client-safe exported subpath at `@repo/domain/database/forms`:

- static Zod schemas for form documents and management/public inputs;
- pure graph validation/evaluation;
- pure dynamic answer-schema compilation;
- DTOs that expose question IDs but not property/source/page IDs publicly;
- repositories for form/version/submission/upload persistence;
- `DatabaseFormService`, `FormAccessResolver` and `FormSubmissionService`.

Required pure functions include:

```ts
buildQuestionValueSchema(question)
buildFormAnswerSchema(version)
evaluateFormPath(version, answers)
projectReachableAnswers(version, answers)
validateFormGraph(version)
```

The client-safe surface must not import Prisma, Node crypto, repositories or service
containers. The server layer owns signed tokens, CAPTCHA, sessions and persistence.

## Management API

Add a dedicated form router rather than overloading generic view mutations:

- `database.createForm({ pageId, title })`
- `database.getForm({ pageId, formId })`
- `database.listForms({ pageId })`
- `database.updateFormDraft({ pageId, formId, expectedRevision, schema })`
- `database.publishForm({ pageId, formId })`
- `database.updateFormSettings({ pageId, formId, audience, respondentAccess,
opensAt, closesAt, responseLimit, notifyOwners })`
- `database.setFormSlug({ pageId, formId, slug? })`
- `database.rotateFormKey({ pageId, formId })`
- `database.closeForm` / `reopenForm` / `archiveForm`
- `database.listFormVersions({ pageId, formId })`
- `database.listFormResponses({ pageId, formId, cursor, limit })`

`createView(type=FORM)` is rejected with a typed message directing callers to
`createForm`; the database tab menu uses `createForm` for this entry. Generic
rename/duplicate/delete view procedures delegate FORM-specific invariants to the form
service.

Duplicating a FORM view creates a new form and mutable draft with a fresh generated
route key. It copies presentation, questions, sections, transitions, endings and
settings, but copies no published versions, submissions, response count, custom slug
or pending uploads. The duplicate starts in `DRAFT`.

## Public and respondent API

Routes:

- `apps/web/src/app/(form)/f/[key]/page.tsx`
- `apps/web/src/app/(form)/f/[key]/responses/[submissionId]/page.tsx`
- a form route-group layout with the existing `RecaptchaProvider` and `noindex,nofollow`
  metadata.

The `[key]` segment accepts either generated `routeKey` or normalized `customSlug`.
Lookup returns uniform unavailable results where distinction would create an oracle.

Public operations:

- `form.getPublished({ locator })`: resolver checks access and returns a sanitized
  published document plus signed `versionToken`.
- `form.submit({ locator, versionToken, idempotencyKey, answers, honeypot })` with
  CAPTCHA in `x-captcha-response`.
- `/api/forms/[locator]/uploads`: initiate/upload a bounded pending file using a signed
  version token, CAPTCHA action and upload lease.
- `form.getOwnResponse({ locator, submissionId })`.
- `form.updateOwnResponse({ locator, submissionId, answers })`.

The public form DTO contains question IDs and presentation data, not `sourceId`,
`pageId`, `propertyId`, database access rules or hidden property names. The server maps
question IDs back to property references from the stored version.

## Builder UI

Add `FORM` to `DatabaseViewTabs`. Selecting it renders a three-panel builder:

- left: ordered sections, ending screens, counts and add controls;
- centre: live A2 form preview for the selected section;
- right: selected question/section/ending settings and section transition rules;
- header: draft status/conflict state, preview, share settings and publish action.

Question creation offers an existing compatible property or creates a new property of
the chosen type. The latter goes through the normal database property service so
structure locks, option validation and other views remain consistent.

Preview uses the same renderer/graph evaluator as `/f`, with submission disabled. The
builder reports graph errors inline and in a summary; publish remains disabled until
the full document and property dependencies pass.

The form share panel contains:

- audience and respondent access;
- generated URL, copy action and key rotation;
- custom slug (feature-gated);
- open/closed status, opensAt, closesAt and responseLimit;
- AnyNote branding toggle (feature-gated);
- owner notifications;
- current published version and unpublished-changes state.

The response panel is a keyset-paginated join through `DatabaseFormSubmission`. Opening
a row uses the existing database item modal and normal row ACL. Accepted rows also
appear in all ordinary database views whose filters match them.

## Respondent UI (A2)

The approved public layout combines an open document with portal context:

- full-width optional branded cover;
- organization identity and “created in AnyNote” branding unless disabled;
- left section progress/map on desktop, compact progress on mobile;
- open document body without a floating card;
- clear required markers, property descriptions and validation messages;
- previous/next controls and a final review where appropriate;
- privacy/duration context and local-draft status;
- dedicated scheduled, closed, capped, auth-required, policy-disabled and unavailable
  states;
- configured ending screen after success.

The renderer is responsive and accessible: native labels, descriptions connected by
`aria-describedby`, error summary, focus to the first invalid field/section, keyboard
operation and no color-only state.

## React Hook Form and dynamic Zod validation

Use the official React Hook Form Zod integration through `@hookform/resolvers/zod`.
Add `react-hook-form` and `@hookform/resolvers` as direct dependencies of `apps/web`;
do not rely on transitive availability from `@repo/ui`.

The respondent renderer constructs the schema from the published document:

```ts
const answerSchema = useMemo(() => buildFormAnswerSchema(version), [version])

useForm({
  resolver: zodResolver(answerSchema),
  mode: 'onBlur',
  criteriaMode: 'all',
  shouldUnregister: false,
})
```

Field paths are `answers.{questionId}`. `useWatch` recomputes question visibility and
the next transition. `trigger(activeQuestionIds)` validates a section before moving
forward. `shouldUnregister: false` preserves values when navigating back, but
`projectReachableAnswers` removes newly unreachable values before submission.

`getPublished` returns a non-secret `versionFingerprint` derived from `schemaHash`.
Local drafts are stored under `anynote:form:{locator}:{versionFingerprint}`, expire
after seven days and are cleared after success or explicit reset. The UI warns that a
shared browser retains the draft locally. When a token/version expires, the route
refreshes and remaps compatible values by stable question ID; incompatible values
remain local until the user confirms removal.

Client validation is only an affordance. The server reloads the stored version, builds
the same dynamic Zod shape independently, checks the raw key set against the
server-evaluated reachable path, and then performs asynchronous semantic checks.

Server Zod errors are converted to `{ questionId: messages[] }`, never property IDs.
The client applies them with React Hook Form `setError` and navigates to the first
section containing an error.

## CAPTCHA and abuse controls

Reuse the authentication UI integration:

- `RecaptchaProvider`
- `useRecaptchaV3`
- `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`
- `RECAPTCHA_SECRET_KEY`
- `x-captcha-response`

The Better Auth CAPTCHA plugin protects auth endpoints but cannot authorize a form
route. Add a small server verifier using the same Google reCAPTCHA v3 provider and
secret. It verifies success, expected action (`form_submit` or `form_upload`), score
threshold 0.5 and configured production hostname. CAPTCHA tokens and scores are not
persisted or included in business logs.

Final new-submission order:

1. small static envelope validation;
2. form lookup and idempotency replay check;
3. bounded per-IP+form and form-wide burst limiter;
4. CAPTCHA verification;
5. version-token and form access resolution;
6. dynamic Zod and semantic validation;
7. atomic transaction.

Network retries with an existing idempotency key return the original success without
requiring a second single-use CAPTCHA token after the signed form/version context is
revalidated.

Use a bounded TTL rate-limiter implementation behind an interface. The initial
single-host deployment may use an in-process store consistent with existing routes;
the interface must allow a shared backend before horizontal web scaling. Raw IPs are
not persisted; limiter keys are short-lived hashes.

Defaults are 10 submit attempts per 10 minutes for one IP+form and 100 submit attempts
per minute form-wide. Upload initiation uses 30 attempts per 10 minutes per IP+form.
All thresholds are server configuration, not fields in the public form document.

The form also includes a hidden honeypot. In production, missing CAPTCHA configuration
fails closed for public upload/submit. Development may explicitly disable CAPTCHA with
a visible warning; tests inject a deterministic verifier rather than calling Google.

## File upload flow

Public upload cannot call the authenticated file route.

1. The client requests upload initiation with locator, version token, question ID,
   file metadata and `form_upload` CAPTCHA.
2. The access resolver checks the current form/version, question constraints,
   workspace quota, MIME, size, count and rate limits.
3. The server creates a `File` owned operationally by `form.createdById`, scoped to the
   source workspace, with `status=PENDING`, plus `DatabaseFormUpload` bound to the
   question and a random bearer token whose hash is stored. The lease expires after
   24 hours.
4. The browser uploads to the form-namespaced object path and keeps the lease token in
   its local draft.
5. Final submit resolves each lease token to its file ID, requires same form/version,
   non-expired/non-consumed state, creates `PageFile`, writes the FILE cell array,
   marks the `File` ACTIVE and stamps `consumedAt` in the response transaction.
6. A recurring cleanup deletes expired unconsumed objects and File rows.

An upload from one form/version cannot be claimed by another form, question or
submission. Files are never public merely because the form was public; normal page/file
authorization applies after attachment.

## Submission transaction

The client sends only:

```ts
{
  locator,
  versionToken,
  idempotencyKey,
  answers: Record<questionId, unknown>,
  honeypot,
}
```

It does not send `sourceId`, `rowId`, `propertyId`, final ending, actor or access level.

After CAPTCHA and validation, one database transaction:

1. Rechecks form state, schedule, policy, audience, version grace and link revision.
2. Atomically reserves the response slot with a conditional update on
   `acceptedResponses`; zero affected rows means capped/closed.
3. Rechecks `(formId,idempotencyKey)` inside the transaction.
4. Creates a child item `Page` and `DatabaseRow` through a focused form-response path.
   Signed-in audiences use the respondent as `createdById`; public responses use null.
5. Writes the title question or automatic localized response title.
6. Batch-writes validated `DatabaseCellValue` rows.
7. Writes relation links and attaches/activates leased files.
8. Creates `DatabaseFormSubmission` with the server-computed ending.
9. Enqueues the form-submitted outbox event.

Any error rolls back the response counter, page, row, cells, links, file activation and
submission. No partial database row is visible.

The conditional counter update must include the effective OPEN/schedule/limit
predicates or lock the form row so concurrent final-slot submissions cannot both pass.

## Editing one's response

Respondent edit loads the submission's published version, current row values and only
the fields still present with matching types. It uses the same React Hook Form renderer
and server dynamic validation. It may update title, cells, relations and files but may
not change the row source, page body, permissions or submission identity.

Changing an earlier answer may change reachability. On edit, values that become
unreachable are cleared from the corresponding database properties after explicit
confirmation in the UI; silent stale hidden data is not retained.

Owner edits through normal database views remain authoritative and are not constrained
to the form.

## Notifications and webhooks

After commit, emit `database.form.submitted` with identifiers/metadata only:

- workspaceId
- source page/source ID
- form ID and version number
- row ID and item page ID
- submittedAt
- respondent kind (`anonymous` or `authenticated`)

Do not include answer values, file tokens, CAPTCHA data or raw IP in the standard
event. The notification worker sends a concise in-app/email notification to users who
can manage the form when `notifyOwners` is enabled. Existing webhook subscriptions can
subscribe to the event. Rich answer payloads require a future explicit, permissioned
webhook mapping design.

## Error and unavailable states

Public resolver states:

- not found / archived / invalid slug: uniform unavailable response;
- draft or manually closed: closed;
- before `opensAt`: scheduled, with opening time;
- after `closesAt`: closed;
- response limit reached: capped;
- signed-in/workspace audience without required identity: auth-required with return URL;
- workspace security kill-switch: policy-disabled;
- stale/invalid version token: refresh-required;
- form/property drift: temporarily unavailable, owner alert;
- CAPTCHA/rate limit: retryable protection error without internal detail.

Field errors use question IDs. File errors identify the question and safe reason. The
server never returns property/source IDs or confirms inaccessible relation/page
existence.

## Workspace security and auditing

`disablePublicLinksSitesForms` is checked by `FormAccessResolver` for schema load,
upload init, final submit and respondent view/edit. Turning it on is non-destructive:
forms and rows stay stored, but link surfaces stop working until the policy is relaxed.

Audit events cover form create/archive, publish, open/close, audience/respondent access,
schedule/limit changes, slug changes, branding changes and key rotation. Audit payloads
contain no answers, CAPTCHA data or upload bearer tokens.

Generated route keys are 32 random bytes encoded with an `anf_` prefix. Custom slugs
match lowercase `[a-z0-9]+(?:-[a-z0-9]+)*`, length 3–64, exclude reserved prefixes and
are globally unique. Changing route key or slug increments `linkRevision`; rotation
immediately revokes tokens issued under the prior revision. The UI treats route-key
rotation and custom-slug removal as separate explicit actions.

## Performance and observability

- `getPublished` returns one bounded JSON document; no row list is loaded.
- Dynamic compilation/evaluation is linear in the bounded form graph and memoized by
  version ID/hash within a request/render.
- Response list uses the `(formId, submittedAt)` index and keyset pagination.
- Choice option snapshots avoid extra reads for select questions. Workspace picker
  options are fetched lazily and paginated with normal ACL.
- Final cell writes are batched where repository semantics allow.
- Metrics: schema-load result, submit result/reason, CAPTCHA failure, validation
  failure, transaction latency, upload lease counts/cleanup and accepted response
  counts. Labels never contain slug, email or answer data.
- Logs carry form/version IDs and request correlation IDs, not answers.

## Migration and compatibility

- Add the four form models/enums and `FORM` view type in one migration.
- Migrate existing non-null FILE string cells to one-element arrays. Readers remain
  temporarily backward-compatible for rolling deployment; writers immediately use
  arrays.
- Seed data needs only plan feature flags; existing databases receive no form rows.
- Existing `DatabaseView` values and generic database behaviour remain unchanged.
- Update exports, DTO enum handling and exhaustive UI icon/title maps for `FORM`.
- Update structure mutation guards to consult current/grace form dependencies.
- Validate migration from a fresh scratch database and from a snapshot containing
  representative legacy FILE cells.

## Testing

### Pure/unit and property-based

- Static form document bounds and schema-version rejection.
- Graph: duplicate/missing IDs, cycles, unreachable nodes, missing/multiple fallback,
  invalid condition ordering and non-terminating paths.
- Condition operators and path evaluation for every value type.
- Dynamic Zod schemas for every supported question type, required/optional/visible
  combinations and unknown/unreachable answer rejection.
- `projectReachableAnswers` and stable-ID draft remapping.
- Generated key entropy/format, slug normalization/reserved names and link revision.
- Signed version/upload token expiry and tamper rejection.

### Domain and real-database integration

- Create multiple forms on one source; FORM view/form are created atomically.
- Optimistic draft revision conflict.
- Publish immutability, version number, schema hash and 24h grace.
- Property deletion/type/option/relation-target guards during current/grace versions.
- Audience restrictions for PERSON/RELATION/PAGE_LINK.
- Anonymous row has null creator/respondent; signed-in row captures the user.
- Automatic title when title question is absent.
- Atomic success creates page, row, cells, relations, PageFile and submission.
- Any failure leaves none of them and does not consume a response slot.
- Concurrent submissions for the final response slot yield exactly one success.
- Idempotent retry returns the same submission and does not increment the counter.
- Upload lease ownership, expiry, single consumption and cleanup.
- Respondent VIEW/EDIT isolation and deleted-property tolerance.

### API and security

- Public DTO never contains property/source/page IDs or inaccessible picker data.
- Every resolver state, workspace kill-switch and audience mode.
- CAPTCHA action/score/hostname verification and production fail-closed behaviour.
- Honeypot and per-IP/form burst limits.
- Hidden/extra field injection, forged property IDs, forged ending and stale token.
- Cross-form/version upload claim, expired upload and FILE count/size/MIME violations.
- Relation/person/page target access is rechecked server-side.
- Uniform lookup errors prevent slug/form/row enumeration.

### React/web

- React Hook Form dynamically renders each question type and uses `zodResolver`.
- Section `trigger`, question visibility, branch changes, Back and local draft restore.
- Newly unreachable values are excluded from new submission.
- Server field errors map through `setError` to the correct section/question.
- First-error focus, summary links, labels/descriptions, keyboard and screen-reader
  semantics.
- A2 desktop/mobile layout, progress map, branding gate and every unavailable state.
- Builder draft conflict, graph errors, preview parity and publish gate.

### Playwright

- Create database form → configure → preview → publish → fill by generated link.
- Each major branch reaches the expected ending and creates the expected row values.
- Public anonymous, signed-in and workspace-member audiences.
- Respondent VIEW and EDIT cannot access another response or workspace database.
- Multiple forms write to the same source and response lists remain separated.
- Custom slug, key rotation, schedule, close/reopen and response cap.
- File upload, final attachment and abandoned upload cleanup hook.
- Pro+ controls are gated without hard-coded plan slug behaviour.

### Gates

- `pnpm --filter @repo/domain test`
- `pnpm --filter @repo/trpc test`
- `pnpm --filter web test`
- `pnpm --filter web lint`
- `pnpm check-types`
- `pnpm check-architecture`
- focused Playwright forms specs
- fresh and legacy-snapshot migration verification
- `pnpm gates` before completion

## Done criteria

A database owner can create multiple FORM views, build linear or feature-gated
branching forms, preview and publish immutable versions, share a generated key or
feature-gated slug, and manage schedule/audience/limits. A desktop or mobile respondent
can fill the approved A2 interface at `/f/{key-or-slug}`. React Hook Form provides
dynamic client validation, the server independently regenerates and applies Zod plus
semantic checks after the existing reCAPTCHA v3 protection, and one transaction creates
the page-backed row with validated values and submission provenance. Public form access
does not expose database internals, bypass row ACL or create partial rows; signed-in
respondents can view/edit only their own response when configured. Notifications,
webhooks, plan flags, migration and the full test matrix are green.
