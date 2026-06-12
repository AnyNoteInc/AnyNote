# Per-Seat Billing Implementation Plan (Phase 8D)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extra-seat purchases on the tier model with prorated YooKassa charges, next-interval reductions, a billable-seat ledger, renewal seat math, and the invoice/legal-entity request workflow — per `docs/superpowers/specs/2026-06-15-per-seat-billing-design.md` (THE SPEC; normative). **Closes cl8.**

**Architecture:** New `packages/domain/src/seats/` module (the established pattern) owning counting/proration/addons/ledger/invoices; ledger writes threaded into every member path; `handlePaymentSucceeded` branches on seat-purchase orders; `renewOne` gains the seat charge; a new `billing.*` tRPC router; «Биллинг мест» settings section.

**Template files:** `packages/domain/src/{security,identity}/**` (module shape), `packages/trpc/src/routers/subscription.ts` startCheckout (the Order+payment pattern) + `packages/trpc/src/services/billing.ts` handlePaymentSucceeded, `apps/engines/src/apps/billing/services/subscription-renewal.service.ts` renewOne + its spec, `apps/web/src/server/yookassa.ts` (the mock), `apps/web/src/components/billing/checkout-modal.tsx`, the 8C settings cards, `apps/e2e/{security,people}.spec.ts`.

**Shared-dev-DB migration rule (Task 1):** the established diff→psql→resolve flow.

**Test discipline:** fixture-scoped asserts ONLY; suites alone; renewal math via service tests (no time travel); money tests use the mock/injected clients.

**Commits:** explicit paths, NEVER `git add -A`.

---

## Task 1: Schema + seed + mail + env

**Files:** Modify `packages/db/prisma/schema.prisma`, `packages/db/prisma/seed.ts`, `packages/mail/src/{types.ts,templates/...}`, `.env.example`, `turbo.json`; Create the migration.

- [ ] **Step 1:** spec §2: the 2 Plan price columns (+ seed: personal 0/0, pro 19000/190000, max 29000/290000), WorkspaceSeatAddon, SeatBillingEventType + SeatBillingEvent, WorkspaceSeatSnapshot, InvoiceRequestStatus + InvoiceRequest, Workspace back-relations (`seatAddon`, `seatEvents`, `seatSnapshots`, `invoiceRequests`).
- [ ] **Step 2:** migration via the shared-DB flow; apply+resolve+generate; verify `\d workspace_seat_addons` + the Plan columns; UPDATE the seeded plans on the shared DB? — the seed upserts: run `pnpm --filter @repo/db exec prisma db seed`? NO on the shared DB mid-phase — instead apply the two price values for pro/max via a plain UPDATE in the migration SQL itself (idempotent, additive — the seed file change covers fresh DBs). Document.
- [ ] **Step 3:** `invoice-request` MailKind (payload per spec §2; template Russian, operator-facing, esc()); `BILLING_INVOICE_EMAIL` in .env.example + turbo.json.
- [ ] **Step 4:** `pnpm --filter @repo/db check-types && pnpm --filter @repo/mail test && pnpm check-types`. **Step 5 — commit:**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/seed.ts packages/db/prisma/migrations/* packages/mail/src .env.example turbo.json
git commit -m "feat(db): per-seat billing models, seat prices, invoice-request mail"
```

---

## Task 2: Domain seats module — counting, proration, addons, ledger, invoices

**Files:** Create `packages/domain/src/seats/{dto/seats.dto.ts,repositories/seats.repository.ts,services/seats.service.ts,index.ts,seats.module.ts,seats.tokens.ts}` + container/barrel; Create `packages/domain/test/seats/seats.service.test.ts` (+ `seats.proration.test.ts` pure table).

- [ ] **Step 1 (TDD):** spec §3 minus the cross-module pieces: BILLING_AUDIT_ACTIONS + SEATS_ERROR_CODES (SEATS_NOT_AVAILABLE, NOT_SUBSCRIPTION_OWNER, REDUCTION_BELOW_USAGE, PERIOD_ENDED, INVALID_INN, INVOICE_SEATS_BELOW_USAGE...); `prorateSeatPurchase` PURE (the spec formula; refusal on ended period) — table-test ≥10 rows (month/year periods, same-day, last-day, multi-seat, rounding); `countBillableSeats` (member rows; pinned: guests/grants excluded, blocked counted, every role counted); `getSeatUsage` (the full shape incl. seatPrice per the owner's billingPeriod + canPurchase); `beginSeatPurchase` (gates per spec; returns {amountKopecks, seats, periodEnd} for the router); `applySeatPurchase(orderId)` (idempotent on order status PAID-once semantics — read how handlePaymentSucceeded guards and mirror: the caller passes the order row? design: applySeatPurchase({orderId}) loads the order, requires status PENDING handled by the CALLER... simplest: the tRPC payment-success path calls it AFTER flipping the order PAID inside the same tx — the domain method takes {tx-context via uow, workspaceId, seats, orderId, amountKopecks} and is made idempotent via a ledger-unique on orderId? ADD `@@unique([orderId, type])` on SeatBillingEvent? No — keep it simple: idempotency = the caller's order-status guard (the established handlePaymentSucceeded pattern); the domain method is plain and documented); `scheduleSeatReduction`/`cancelScheduledReduction` (guards); `applyScheduledSeats`; `computeOwnerSeatCharge` (multi-workspace); `resetAddonsForOwner`; `createInvoiceRequest` (INN 10|12 digits, KPP 9, seats ≥ memberCount) + `listInvoiceRequests`. All mutations audit; ledger rows per spec.
- [ ] **Step 2:** `pnpm --filter @repo/domain test` (alone) + check-types + check-architecture. **Step 3 — commit:**
```bash
git add packages/domain/src/seats packages/domain/src/container.ts packages/domain/src/index.ts packages/domain/test/seats
git commit -m "feat(domain): seats module — counting, proration, addons, ledger, invoice requests"
```

---

## Task 3: Capacity switch + member-event ledger threading

**Files:** Modify `packages/domain/src/people/{repositories/people.repository.ts,services/people.service.ts}` (assertSeatAvailable limit source + recordMemberEvent calls), `packages/domain/src/identity/services/identity.service.ts` (joinViaDomain ledger), `packages/trpc/src/routers/workspace.ts` (legacy inviteMember/removeMember ledger + capacity), tests in the existing suites.

- [ ] **Step 1 (TDD):** capacity: the people repo's seat-limit read gains `+ workspaceSeatAddon.paidSeats` (the helper change → all five join paths inherit; extend ONE existing seat-limit test per path? — extend the people suite's seat tests with an addon fixture proving capacity grows; the identity domain-join seat test likewise).
- [ ] **Step 2 (TDD):** ledger threading: MEMBER_JOINED written in the same tx by acceptInvitation/joinViaLink/convertGuestToMember (people), joinViaDomain (identity), legacy workspace.inviteMember (router tx? it's an upsert — only ledger on CREATE not role-update: use the upsert result? switch to explicit find+create or compare updatedAt? simplest: count before/after? — read the current code; pragmatic: only write the ledger when the upsert CREATED (check via a pre-read in the same flow — it already pre-reads for the limit check? verify) — pin the no-event-on-role-update case); MEMBER_REMOVED by people.removeMember + legacy removeMember. Workspace creation's OWNER row: MEMBER_JOINED too (workspace.create). Asserts added to each existing suite (the people/identity tests gain ledger-row expectations — additive, don't weaken).
- [ ] **Step 3:** run people+identity+trpc suites (alone, sequential). **Step 4 — commit:**
```bash
git add packages/domain/src/people packages/domain/src/identity packages/trpc/src/routers/workspace.ts packages/domain/test packages/trpc/test
git commit -m "feat(seats): capacity includes purchased seats, member ledger threaded through every path"
```

---

## Task 4: Money integration — payment-success branching + renewal seat charge

**Files:** Modify `packages/trpc/src/services/billing.ts` (handlePaymentSucceeded branch + resetAddonsForOwner on isInitial), `apps/engines/src/apps/billing/services/subscription-renewal.service.ts` (renewOne seat math + snapshots/apply) + its spec, `packages/trpc/test/` (the billing service tests — find them: plan.test.ts/billing tests).

- [ ] **Step 1 (TDD):** handlePaymentSucceeded: seat_purchase orders (metadata.kind) → flip PAID + `applySeatPurchase` in the same tx (NO subscription upsert, NO syncWorkspaceLimits — pinned); tier orders: existing path + `resetAddonsForOwner` when `order.isInitial` (pinned: renewals/non-initial don't reset). Mock-compat: the MockYookassaClient funnels here — no mock change needed (verify by reading).
- [ ] **Step 2 (TDD):** renewOne: amount = tier + computeOwnerSeatCharge(userId, billingPeriod).totalSeatKopecks; success path per spec §4.2 (applyScheduledSeats + snapshots + SEATS_RENEWED + audits per workspace, same tx as the period roll); REGRESSION PIN: zero-addon owners charge exactly the old flat amount (the existing renewal spec tests stay green unchanged). expireCanceled: reset addons (ledger ADDONS_RESET, no charge).
- [ ] **Step 3:** `pnpm --filter @repo/trpc test` + `pnpm --filter engines test` (alone each). **Step 4 — commit:**
```bash
git add packages/trpc/src/services/billing.ts apps/engines/src/apps/billing packages/trpc/test
git commit -m "feat(billing): seat-purchase orders and seat-aware renewals with snapshots"
```

---

## Task 5: tRPC `billing.*` router + preview extension

**Files:** Create `packages/trpc/src/routers/billing.ts`, `packages/trpc/test/billing-router.test.ts`; Modify `packages/trpc/src/index.ts`, `packages/domain/src/people/...` (InvitePreview {atCapacity, seatPriceKopecks}), `packages/trpc/src/routers/subscription.ts` (+`nextChargePreview`).

- [ ] **Step 1:** per spec §5: seatUsage (OWNER|ADMIN view), purchaseSeats (OWNER + subscription holder ⇒ NOT_SUBSCRIPTION_OWNER otherwise; creates the Order + payment per the startCheckout pattern with seat metadata; returns {confirmationUrl, orderId}), scheduleReduction/cancelReduction, seatEvents (keyset 30), createInvoiceRequest (+ the operator sendMailNow; absent env ⇒ skip-log), listInvoiceRequests. subscription.nextChargePreview (the user's own next renewal breakdown). people.getInvitePreview extension.
- [ ] **Step 2 (TDD):** the gate matrix (ADMIN view-only — FORBIDDEN on money procs; an OWNER-ROLE member who is NOT the createdById holder ⇒ NOT_SUBSCRIPTION_OWNER; member ⇒ FORBIDDEN everywhere); purchaseSeats with the mock-style injected yookassa (the subscription router tests' pattern — read how they fake it): order amount = the proration expectation, success-callback applies seats + idempotent double-callback; reduction guards; preview extension shape; invoice mail mock + validation errors; seatEvents keyset.
- [ ] **Step 3:** `pnpm --filter @repo/trpc test` (alone) + lint/check-types + check-architecture. **Step 4 — commit:**
```bash
git add packages/trpc/src/routers/billing.ts packages/trpc/src/index.ts packages/trpc/test/billing-router.test.ts packages/trpc/src/routers/subscription.ts packages/domain/src/people
git commit -m "feat(trpc): billing router — seat purchases, reductions, ledger, invoice requests"
```

---

## Task 6: Web UI

**Files:** Create `apps/web/src/components/workspace/settings/{billing-section.tsx,seat-usage-card.tsx,seat-purchase-card.tsx,invoice-request-card.tsx,seat-events-table.tsx}`; Modify `workspace-settings-dialog.tsx` (slug `billing` after `security`, show: isOwner), `members-section.tsx` (the at-capacity CTA), `apps/web/src/components/settings/current-plan-card.tsx` or the user billing page (nextChargePreview line), `apps/web/src/app/(about)/pricing/page.tsx` (one копy line re extra seats).

- [ ] **Step 1:** per spec §6 (usage card with the scheduled-reduction notice; purchase card with the stepper + honest prorated «доплата до конца периода ≈ N ₽» [compute client-side from seatUsage.seatPrice + periodEnd — display-only; the SERVER amount is authoritative] + «Купить» → confirmationUrl redirect; reduction card with guards surfaced; the ledger table; the invoice form [INN/КПП/название/адрес/email/период/мест + validation + past requests with status chips]). testids per spec §6.
- [ ] **Step 2:** members at-capacity CTA; the user billing page «Следующее списание» breakdown; the pricing-page copy line.
- [ ] **Step 3:** web lint/check-types/build (env sourced, foreground). **Step 4 — commit:**
```bash
git add apps/web/src/components/workspace/settings apps/web/src/components/settings apps/web/src/components/workspace apps/web/src/app
git commit -m "feat(web): workspace seat billing — usage, purchase, reduction, ledger, invoice requests"
```
(Narrow paths.)

---

## Task 7: E2E + changelog

**Files:** Create `apps/e2e/billing-seats.spec.ts`; Modify `docs/changelog.md`.

- [ ] **Step 1 — E2E** (the mock YooKassa works under Playwright: YOOKASSA_MOCK_ENABLED is already in the webServer env — VERIFY in playwright.config.ts): owner on the pro fixture (subscription+WorkspaceLimit per the people.spec technique; pro included=5 — to test capacity cheaply, set WorkspaceLimit.maxMembers=1 directly so the owner fills it) → members invite preview shows at-capacity → «Биллинг мест» → buy 1 seat → mock-redirect flow (the confirmationUrl under the mock — read what MockYookassaClient returns for confirmation: it synchronously succeeds; the return page polls → success) → usage shows the extra seat → the previously-blocked invite path now passes (people.invite succeeds / preview no longer at-capacity); schedule a reduction → notice; invoice request → row «Новая» (mail env unset in E2E ⇒ skip-log fine).
- [ ] **Step 2 — changelog** («Готовится»):
```md
**Оплата по местам**

- Докупайте места к тарифу для каждого пространства: пропорциональная доплата до конца периода, уменьшение — со следующего списания, без скрытых кредитов. Гости и страничные приглашённые остаются бесплатными.
- Журнал мест и заявка на счёт для юридических лиц (ИНН/КПП) прямо из настроек пространства.
```
- [ ] **Step 3:** run (foreground, retries, 3100 free, .next wipe if a build preceded). **Step 4 — commits:**
```bash
git add apps/e2e/billing-seats.spec.ts && git commit -m "test(e2e): seat purchase via mock yookassa, capacity growth, invoice request"
git add docs/changelog.md && git commit -m "docs(changelog): per-seat billing"
```

---

## Completion

Group reviews: Tasks 1–3 (domain+threading) then 4–7 (money/API/UI/E2E). Final whole-branch review foci: (1) money correctness — proration determinism, idempotent success-callbacks (double webhook/poll), the renewal regression (zero-addon owners charge EXACTLY as before — pinned), no path where seats apply without a PAID order; (2) guests-free invariant end-to-end (ledger + counting + conversion boundary); (3) the gate matrix (subscription-holder-only money; ADMIN view-only); (4) ledger/audit completeness per member path (all SIX create paths incl. workspace-creation OWNER + both remove paths); (5) regression — flat-price behavior identical for addon-free owners across checkout/renewal/limits; the 8A seat-limit tests still meaningful (capacity = included when no addon). Then full gates + the forced uncached sweep + the merge checkpoint. **cl8 closes here** — the memory file should mark it.

## Self-review (at plan-writing time)

- Spec §2→T1; §3→T2 (module) + T3 (threading/capacity); §4→T4; §5→T5; §6→T6; §7 invariants pinned across T2–T5 + final; §8→per-task + T7.
- Type consistency: prorateSeatPurchase (T2) consumed by beginSeatPurchase (T2) + the router (T5) + display (T6); SeatBillingEventType (T1) used by T2/T3/T4; getSeatUsage shape (T2) consumed by T5/T6; computeOwnerSeatCharge (T2) consumed by renewOne (T4) + nextChargePreview (T5).
- Known risks named in-task: the legacy inviteMember upsert-vs-create ledger semantics (T3), applySeatPurchase idempotency placement (T2/T4 — the caller's order guard), the mock confirmation flow in E2E (T7), seed-vs-migration price application on the shared DB (T1).
