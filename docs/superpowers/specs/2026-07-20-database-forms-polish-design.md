# Database Forms Polish and Defaults Design

**Date:** 2026-07-20
**Status:** Approved
**Scope:** Follow-up to `2026-07-15-database-forms-design.md` for twelve verified product issues in the form builder, public respondent flow, and response viewer.

## 1. Goal

Make database forms safe to edit, clearer to configure, and complete as a public respondent experience. The release must fix all twelve reported issues, preserve the existing public contract `/f/{key}`, keep CAPTCHA and server-side Zod validation authoritative, and be verified end to end before production deployment.

The approved visual direction has three principles:

1. Appearance controls live beside the entity they affect.
2. The right inspector is reserved for behavior and can be resized or hidden.
3. The public form and completion screen occupy the full viewport and read as complete pages.

## 2. Requirements and Acceptance Criteria

### 2.1 Safe blank form title

- The presentation title may be temporarily empty in a saved draft.
- Clearing the title must not crash the builder, replace the builder with a damaged-draft error, or start a failing autosave loop.
- An empty or whitespace-only title produces an inline publish-readiness issue.
- A published version still requires a non-empty title.

### 2.2 Shared icon picker

- Form, section, and question appearance controls use the same icon picker and serialized icon format as pages.
- Emoji and supported page image icons render through the shared page-icon formatter rather than raw text assumptions.
- Removing an icon is supported.
- The public renderer, builder canvas, outline, and completion preview render the selected icon consistently where applicable.

### 2.3 Resizable and collapsible inspector

- The right behavior inspector has a drag handle.
- Its width is clamped to 280–520 px so the center canvas remains usable.
- The inspector can be collapsed and restored from an always-visible control.
- Width and collapsed state persist in browser storage per user/device and do not modify the form document.
- Keyboard users can adjust the separator in documented increments and the separator exposes the appropriate ARIA semantics.

### 2.4 Separate appearance surfaces

- **Form appearance** opens from the form header on the center canvas. It owns presentation title, description, icon, cover, organization, submit-button appearance, and branding.
- **Section appearance** opens from the section card. It owns section title, description, and icon.
- **Field appearance** opens from the question card. It owns label, description, icon, and answer-format presentation such as multiline and choice appearance.
- The right inspector owns required state, default value, visibility conditions, transitions, property synchronization, and other behavioral settings.
- Validation issues stay contextual: appearance issues surface at the relevant local editor; behavioral and publication issues remain visible in the inspector and outline.

### 2.5 External URLs versus AnyNote pages

- User-facing labels clearly distinguish `URL` as **Ссылка на сайт** and `PAGE_LINK` as **Страница AnyNote** in the form property picker and database property creation surfaces touched by this flow.
- `URL` accepts valid `http://` and `https://` external sites and is valid for every form audience.
- `PAGE_LINK`, `PERSON`, and `RELATION` remain restricted to `WORKSPACE_MEMBERS_WITH_LINK`; this security boundary is not weakened.
- Client readiness and server publication checks use the same internal-property set and prove that `URL` is not part of it.

### 2.6 Published-state controls

- Before the first publication, the primary action is **Опубликовать**.
- After publication, an unchanged form shows an **Опубликовано** status and no publish button.
- If the draft differs from the published schema, the status becomes **Есть неопубликованные изменения** and the available action is **Обновить публикацию**.
- A successful publication updates local form state immediately, so the original publish button cannot remain visible or be clicked twice.
- Draft/published equality is semantic and uses a canonical schema comparison rather than object identity.

### 2.7 Full-page public layout

- The form route, layout, renderer root, and main grid use a minimum height of `100dvh` with a `100vh` fallback.
- Background, sidebar, and content extend to the bottom edge on short and long forms.
- The cover remains full width and the content remains centered and responsive.
- Mobile keeps a single-column layout without horizontal scrolling.

### 2.8 Dedicated completion screen

- Once submission succeeds, the renderer shows only the selected ending screen.
- The form title, route map, question section, draft warnings, validation summary, respondent footer, and form branding are not rendered around the ending.
- **На главную** always navigates to `/`.
- **Заполнить ещё раз** clears the local draft, server and client errors, success state, upload state, CAPTCHA handoff state, and idempotency attempt; it then starts a fresh form at the first section.
- A configured ending CTA and own-response link remain optional content inside the ending itself.

### 2.9 QR code

- The canonical public URL uses the active custom slug when present and otherwise the route key.
- QR generation runs locally in the application; the public URL is not sent to a third-party QR service.
- The share panel and public form expose a **QR-код** action.
- The dialog renders an accessible SVG preview, supports SVG download, and offers copy-link as a fallback/action.
- QR generation is available only when a public locator exists; closed forms may still share the stable URL.

### 2.10 Response terminology

- Opening a database row from **Ответы формы** labels the property area **Поля для заполнения**.
- Ordinary database item views retain the existing **Свойства** label.
- The label is an explicit response-view prop, not a global string replacement.

### 2.11 Per-question default values

- A question may define an optional static `defaultValue` in the form version document.
- The public input stays visually empty. The editor shows the configured fallback, but respondent controls are not prefilled.
- Effective answers replace only supported empty values: `undefined`, `null`, `''`, and `[]`. Numeric `0` and boolean `false` are explicit answers and are never replaced.
- Defaults use the same canonical answer shape as submissions and support all question kinds except `FILE`.
- A default is validated against the question input constraints, current choice snapshots, workspace membership, relation visibility, and page visibility as applicable.
- Defaults participate in client path evaluation so conditional flow matches the server even when the respondent leaves a control empty.
- The client dynamically merges defaults before React Hook Form's Zod validation while retaining raw visual field state.
- The server independently merges defaults before its dynamic Zod validation, path evaluation, and row-write plan. Client-supplied data is never trusted to apply defaults correctly.
- Hidden or unreachable questions are not written merely because they have defaults.
- Default values are part of the public form definition because the client needs them for identical conditional evaluation. They must not be treated as secrets.

### 2.12 Stable date picker

- Date and date-time questions use controlled pickers from the existing UI date-picker stack rather than native `type="date"` and `type="datetime-local"` controls.
- Selecting or accepting a value closes the calendar, commits the canonical date value, returns focus predictably, and does not scroll the input out of place.
- Cancel and Escape close without corrupting the current answer.
- The existing date-only ISO date and offset date-time server contracts remain unchanged.

## 3. Document and Validation Model

### 3.1 Draft-tolerant title

Published `formVersionDocumentSchema` remains strict. A new draft parser accepts an empty presentation title while preserving every other structural bound. Builder reads, draft updates, duplication, and management DTOs use the draft parser. Publication converts the draft through the strict published parser and returns the contextual title issue when it is blank.

This separation prevents edit-time text state from weakening public-version guarantees.

### 3.2 Appearance fields

`FormSection` and `FormQuestion` gain optional page-compatible `icon` values. `FormPresentation.icon` adopts the same validation and rendering helper. The serialized value follows the existing page icon contract so the picker, preview, and public renderer share one representation.

No Prisma migration is required because the form document is stored in the existing JSON schema fields and snapshotted into form versions.

### 3.3 Default value

`FormQuestion` gains optional `defaultValue`. Structural parsing bounds the serialized value; semantic validation uses the question-specific answer schema. A reusable domain helper produces effective answers:

1. Start with the raw respondent answers and the first section.
2. Apply a question default only when that question is reachable and its raw value has the supported empty representation.
3. Evaluate the resulting path and repeat default application for newly reachable questions until the existing bounded stabilization rule converges.
4. Project only reachable effective answers for validation and persistence.

`FILE` rejects a configured default at draft readiness and publication because upload lease tokens are single-use capabilities.

The public version includes `defaultValue` so browser and server path evaluation remain identical. React Hook Form continues to hold raw respondent values; it does not receive defaults as visual `defaultValues`.

## 4. Component Boundaries

### 4.1 Builder

- `FormBuilder` coordinates queries, autosave, publication state, dialog state, and the three-column shell.
- A dedicated inspector-layout hook owns width, collapse state, pointer/keyboard resizing, and browser persistence.
- `FormPreviewCanvas` owns local entry points for form, section, and question appearance editors.
- Appearance editors dispatch the existing reducer actions plus icon/default-aware actions; they do not call APIs directly.
- `FormSettingsPanel` becomes a behavior inspector and no longer appends `FormPresentationEditor` to every selection.
- The reducer remains the single source of truth for the draft document and preserves generation-based autosave conflict handling.

### 4.2 Public renderer

- `FormRenderer` separates the question flow from an early `FormEndingScreen` branch.
- A shared effective-answer helper is used for client Zod validation and conditional navigation.
- Raw draft persistence remains unchanged and never writes defaults into local storage unless the respondent explicitly enters that value.
- `FormPageClient` owns successful reset semantics and remounts or resets the renderer through an explicit reset generation.

### 4.3 QR and response view

- A reusable QR dialog accepts only a fully resolved URL and returns SVG/download/copy behaviors.
- The share panel and public page build the same canonical URL helper.
- `DatabaseItemModal` accepts an optional property-section label; `FormResponsesPanel` supplies **Поля для заполнения**.

## 5. Submission Data Flow

1. The respondent enters raw values into React Hook Form controls.
2. The browser computes effective answers from raw values and published defaults for conditional navigation and dynamic Zod validation.
3. The browser submits raw reachable answers with the existing idempotency key and CAPTCHA token.
4. The server loads the locked published version and independently computes effective reachable answers.
5. Dynamic server Zod validates effective answers, including required fields and type constraints.
6. Existing authorization checks validate internal selections, relations, page links, files, and current property snapshots.
7. The row-write plan persists only effective answers for visible reachable questions.
8. Submission completion returns the selected ending and optional own-response URL.

CAPTCHA, rate limiting, idempotency ordering, upload lease consumption, and transaction boundaries are unchanged.

## 6. Error Handling

- Invalid draft appearance or default state is shown inline and blocks publication without crashing or stopping unrelated edits.
- Server publication remains authoritative and maps invalid defaults to `FORM_DEFAULT_VALUE_INVALID` or the existing property/audience error when that is the more precise cause.
- Submission-time invalid defaults in a stale or tampered version fail closed as a stale/invalid version; they do not silently write `null`.
- QR rendering failure keeps copy-link available and shows a localized error in the dialog.
- Date-picker parsing errors remain field-local and do not mutate the last accepted value.
- Failed fresh submission retains raw answers; successful completion clears them only when the user explicitly chooses **Заполнить ещё раз** or resets the form.

## 7. Test Strategy

### 7.1 Domain and router tests

- Draft parser accepts an empty title; published parser and publication reject it.
- Every supported default type has valid, invalid, empty, and explicit `0`/`false` cases.
- File defaults are rejected.
- Defaults affect reachable branching identically in public and server validation.
- Defaults are not written for hidden or unreachable questions.
- `URL` publishes to every audience; `PAGE_LINK`, `PERSON`, and `RELATION` retain the member-only gate.
- Publication remains idempotent and produces a new version only for a changed draft.

### 7.2 Web component tests

- Clearing the title keeps the builder rendered and surfaces readiness feedback.
- The shared icon picker sets and removes form, section, and question icons.
- Appearance actions open on the correct canvas entity; the behavior inspector contains no global appearance editor.
- Inspector resizing, persistence, keyboard control, collapse, and restore work.
- Published and changed-draft states render the correct status/action.
- Completion hides all form chrome and fresh-start fully resets state.
- QR dialog renders the canonical URL and download/copy controls.
- Form response modal uses the scoped label.
- Date selection closes the picker without scroll movement.

### 7.3 Playwright release matrix

The database-forms E2E suite must exercise all twelve numbered requirements in a production-like browser flow:

1. Clear and re-enter the title without a crash.
2. Choose and remove an icon through the shared picker.
3. Resize, collapse, reload, and restore the inspector.
4. Open each appearance editor from its local entity.
5. Add **Ссылка на сайт**, publish it to a public audience, and submit an external URL.
6. Confirm the post-publication status and absence of a second publish button; edit and update the publication.
7. Assert public route roots fill the viewport at desktop and mobile sizes.
8. Submit and assert that only the ending remains; use both required actions.
9. Open QR, verify encoded canonical URL, copy it, and download SVG.
10. Open the created response and assert **Поля для заполнения** while a normal row still says **Свойства**.
11. Leave a defaulted field visually empty, submit, and verify the persisted database cell contains the fallback.
12. Open the date picker, choose a date, assert it closes, and verify the input bounding box does not jump.

Playwright artifacts go under `output/playwright/`. The final release gate also runs focused unit tests, `pnpm check-types`, `pnpm lint`, the affected build targets, and the full database-forms Playwright spec.

## 8. Release and Production Verification

1. Work is implemented in an isolated `codex/` branch/worktree and leaves existing user changes untouched.
2. Focused tests run after each behavior slice; the complete release gate runs before merge.
3. The reviewed branch is merged into local `main`, and only intended files are committed and pushed.
4. Release automation creates the next semantic version from `main`.
5. Deployment is watched to explicit success.
6. Production verification checks `/api/health`, a real published `/f/{key}` flow, full-page layout, QR output, CAPTCHA-protected submission, default persistence, completion actions, and the deployed version.

An unknown `/f/{key}` returning the unavailable screen is not sufficient production verification.

## 9. Non-Goals

- Dynamic defaults such as “today”, “current user”, formulas, or server expressions.
- File defaults or reusable upload leases.
- Removing access restrictions from AnyNote page links, people, or relations.
- Redesigning ordinary database item terminology globally.
- Changing CAPTCHA provider, rate limits, idempotency semantics, or respondent-access policy.
- Introducing a new database table solely for builder layout preferences.
