# Per-Seat Billing (Phase 8D)

**Date:** 2026-06-15
**Status:** approved design (brainstorm decisions locked with the user)
**Roadmap source:** `cl8.md` Prompt 8.5 — sub-phase 4 of 4. **Closes cl8.**

Seat-based billing on top of the existing tier model: tiers keep their prices
and INCLUDED seat counts; owners buy additional per-workspace seats with
prorated YooKassa charges; reductions apply at the next renewal (never
mid-cycle credits); guests are never billable; an invoice/legal-entity request
workflow rides the same substrate. The YooKassa/Russian-invoice abstractions
are preserved (cl8 hard rule).

## 1. Locked decisions

| Decision | Choice |
| --- | --- |
| Pricing model | **Extra seats on tiers** (per workspace). Tier checkout untouched; only the renewal math and the new seat-purchase flow produce money. Full per-member repricing explicitly NOT done (cl8 sanctions diverging from Notion packaging). |
| Invoices | **Request form + manual workflow**: `InvoiceRequest` + `invoice-request` MailKind to `BILLING_INVOICE_EMAIL`; payment stays offline; statuses tracked for a future ops surface. |
| Removal semantics | Member removal frees CAPACITY immediately but money changes only via the owner's seat-reduction, which takes effect at the NEXT renewal. Purchases take effect immediately (prorated). Blocked members keep occupying seats (8A rule) until removed. |
| Plan change | A NEW tier purchase (`isInitial` checkout success) clears the workspace seat addons of that owner's workspaces (they belonged to the old subscription's period); renewals preserve/apply scheduled values. |

## 2. Data model (one migration `*_per_seat_billing`)

```prisma
// Plan gains (Int, default 0; 0 = extra seats not purchasable on this plan):
//   pricePerExtraSeatMonthlyKopecks
//   pricePerExtraSeatYearlyKopecks
// Seed: personal 0/0; pro 19000/190000 (190₽/мес, 1900₽/год); max 29000/290000.
//   (Seed numbers follow the существующий 10× yearly pattern.)

model WorkspaceSeatAddon {
  workspaceId    String   @id @db.Uuid                 // cascade
  paidSeats      Int      @default(0)                  // billable + usable NOW
  scheduledSeats Int?                                  // effective from the next renewal; null = no change
  updatedAt      DateTime @updatedAt
}

enum SeatBillingEventType {
  MEMBER_JOINED            // informational; written by every member-creating path
  MEMBER_REMOVED           // informational; removal frees capacity, not money
  SEATS_PURCHASED          // owner bought N seats (prorated charge; orderId set)
  SEATS_REDUCTION_SCHEDULED // owner scheduled paidSeats -> scheduledSeats
  SEATS_RENEWED            // renewal applied seats + charged (orderId set)
  ADDONS_RESET             // tier change cleared the addon
}

model SeatBillingEvent {
  id           String               @id @default(uuid(7)) @db.Uuid
  workspaceId  String               @db.Uuid             // cascade
  type         SeatBillingEventType
  seatsDelta   Int                  @default(0)          // signed where meaningful
  seatsAfter   Int?                                      // paidSeats after the event
  amountKopecks Int?                                     // money events only
  orderId      String?              @db.Uuid             // scalar; the YooKassa Order
  actorId      String?              @db.Uuid             // null = system/cron
  targetUserId String?              @db.Uuid             // member events
  metadata     Json?
  createdAt    DateTime             @default(now())
  @@index([workspaceId, createdAt(sort: Desc)])
}

model WorkspaceSeatSnapshot {
  id             String   @id @default(uuid(7)) @db.Uuid
  workspaceId    String   @db.Uuid                      // cascade
  subscriptionId String?  @db.Uuid                      // scalar
  orderId        String?  @db.Uuid                      // scalar; the renewal order
  memberCount    Int
  includedSeats  Int
  extraSeats     Int                                    // effective at capture
  seatAmountKopecks Int   @default(0)                   // the seats' share of the charge
  capturedAt     DateTime @default(now())
  @@index([workspaceId, capturedAt(sort: Desc)])
}

enum InvoiceRequestStatus { NEW IN_PROGRESS COMPLETED REJECTED }

model InvoiceRequest {
  id          String               @id @default(uuid(7)) @db.Uuid
  workspaceId String               @db.Uuid              // cascade
  userId      String               @db.Uuid              // the requesting OWNER; scalar
  legalName   String               @db.VarChar(255)
  inn         String               @db.VarChar(12)       // 10 or 12 digits, format-validated
  kpp         String?              @db.VarChar(9)
  legalAddress String              @db.VarChar(500)
  contactEmail String              @db.VarChar(255)
  periodMonths Int                 @default(12)          // 1..12
  seats       Int                                        // requested total seats
  comment     String?              @db.VarChar(1000)
  status      InvoiceRequestStatus @default(NEW)
  createdAt / updatedAt
  @@index([workspaceId, createdAt(sort: Desc)])
}
```

`Order.metadata` carries `{kind: 'seat_purchase', workspaceId, seats, periodEnd}`
for seat-purchase orders (no Order schema change). New env:
`BILLING_INVOICE_EMAIL` (.env.example + turbo.json; absent ⇒ the mail is
skipped with the standard `[mail]` log, the request row is still the record).
New MailKind `invoice-request` (payload: legalName, inn, workspaceName,
ownerEmail, seats, periodMonths, comment) — sent to the OPERATOR, not the user.

Audit (`BILLING_AUDIT_ACTIONS` in the new domain module, same WorkspaceAuditLog):
`seats.purchased`, `seats.reduction_scheduled`, `seats.renewal_applied`,
`seats.addons_reset`, `invoice.requested`. (MEMBER_JOINED/REMOVED ledger rows
intentionally do NOT double into the audit log — the people/identity audits
already record joins/removals; the LEDGER is the billing record.)

## 3. Domain module `packages/domain/src/seats/` (dto/repo/service)

- **SeatCounterService semantics** (pure + queries):
  `countBillableSeats(workspaceId)` = `WorkspaceMember` count (OWNER included,
  blocked included — seats free only on removal). Guests excluded by
  construction (no member row). `getSeatUsage(workspaceId)` →
  `{memberCount, includedSeats (Plan.maxMembersPerWorkspace via the owner
  chain), paidSeats, scheduledSeats, capacity = included + paid,
  seatPrice {monthly, yearly} | null (per the owner's CURRENT billingPeriod),
  periodEnd, canPurchase (plan has a non-zero seat price + owner sub ACTIVE)}`.
- **Capacity enforcement**: `assertSeatAvailable` (people module) changes its
  limit source: `WorkspaceLimit.maxMembers` (included) **+ addon.paidSeats**.
  One helper change → all five join paths (invite accept, link join, domain
  join, conversion, legacy inviteMember pre-check) inherit. The people
  repository's seat read gains the addon join.
- **Ledger**: `recordMemberEvent(tx, {workspaceId, type: MEMBER_JOINED|REMOVED,
  targetUserId, actorId})` — called IN THE SAME TX by every member-creating/
  removing path (people accept/join/convert/remove, identity domain-join,
  legacy workspace.inviteMember/removeMember). Implemented as a direct
  prisma write in those modules' repositories (the WorkspaceAuditLog
  precedent — billing-owned table, write-only cross-module coupling).
- **Proration** (pure, table-tested): `prorateSeatPurchase({seats, periodStart,
  periodEnd, now, seatPriceKopecks}) = max(1, ceil(seats × seatPriceKopecks ×
  remainingMs / periodMs))` where remainingMs = periodEnd − now (clamped ≥ 0;
  zero remaining ⇒ charge one day's worth? NO — clamp to minimum 1 kopeck-free?
  Decision: if remainingMs ≤ 0 the purchase is refused (`PERIOD_ENDED` —
  renew first). Deterministic; no Date.now inside (caller passes now).
- **Purchase flow**: `beginSeatPurchase({workspaceId, actorId, seats 1..50})` —
  OWNER-of-workspace AND the workspace owner's subscription must belong to the
  SAME user (only the paying owner can buy: actor must BE the workspace
  owner/subscription holder — `NOT_SUBSCRIPTION_OWNER` otherwise), plan seat
  price > 0 (`SEATS_NOT_AVAILABLE` on personal), computes the prorated amount →
  returns the order payload; the tRPC layer creates the Order
  (kind seat_purchase metadata) + YooKassa payment (the startCheckout
  pattern, mock-compatible). `applySeatPurchase(orderId)` — called from the
  payment-success path: addon.paidSeats += seats (upsert), ledger
  SEATS_PURCHASED {seatsDelta, seatsAfter, amountKopecks, orderId}, audit,
  idempotent on the order status (the handlePaymentSucceeded idempotency
  precedent).
- **Reduction**: `scheduleSeatReduction({workspaceId, actorId, targetSeats <
  paidSeats, ≥ 0})` — guard: capacity after reduction must still fit the
  CURRENT member count (`REDUCTION_BELOW_USAGE` otherwise — remove members
  first); sets scheduledSeats + ledger + audit. `cancelScheduledReduction`.
- **Renewal hooks** (consumed by the engines cron): `applyScheduledSeats(tx,
  workspaceId)` (paidSeats = scheduledSeats ?? paidSeats; clear scheduled;
  ledger SEATS_RENEWED comes with the charge), `computeOwnerSeatCharge(userId,
  billingPeriod)` → `{totalSeatKopecks, perWorkspace: [{workspaceId,
  effectiveSeats, seatKopecks, memberCount, includedSeats}]}` over ALL the
  owner's workspaces (applying scheduled values read-only — the cron applies
  + charges atomically per renewal).
- **Addon reset on tier change**: `resetAddonsForOwner(tx, userId)` — clears
  addons + scheduled for all owned workspaces, ledger ADDONS_RESET + audit
  (actor = the owner; metadata {reason: 'plan_change'}). Called from
  `handlePaymentSucceeded` on `isInitial` orders only.
- **Invoice requests**: `createInvoiceRequest({workspaceId, actorId, fields})`
  — OWNER; INN format validation (10|12 digits), KPP (9), seats ≥ current
  memberCount; row + audit; returns data for the operator mail.
  `listInvoiceRequests(workspaceId)` (OWNER).

## 4. Money integration (the only two producers touched + one new)

1. **Seat purchase** (new): `billing.purchaseSeats` tRPC mutation — domain
   begin → Order (PENDING, amount = prorated, metadata kind seat_purchase) →
   `ctx.yookassa.createPayment` (the startCheckout shape; same return-url
   polling page works — the return page polls `getOrder`/`syncOrder` which
   funnel `handlePaymentSucceeded`). `handlePaymentSucceeded` branches:
   seat_purchase orders call `applySeatPurchase` (NOT the subscription upsert);
   tier orders keep the existing path + `resetAddonsForOwner` when isInitial.
   The MockYookassaClient path works unchanged (it synchronously funnels
   handlePaymentSucceeded).
2. **Renewal** (`renewOne` in the engines service): amount = tier price +
   `computeOwnerSeatCharge(...).totalSeatKopecks`; on success: per-workspace in
   the same tx — `applyScheduledSeats`, `WorkspaceSeatSnapshot` rows
   (memberCount at capture, includedSeats, effective extraSeats,
   seatAmountKopecks), SEATS_RENEWED ledger rows (orderId), audits. The
   `expireCanceled` path: addons die with the subscription (reset, ledger,
   no charge).
3. Checkout (`startCheckout`) untouched.

## 5. tRPC `billing.*` router (new; the existing `subscription.*` untouched)

OWNER-of-the-workspace + must-be-subscription-holder where money moves:
- `seatUsage {workspaceId}` — the getSeatUsage shape (any OWNER/ADMIN may VIEW:
  assertRole OWNER|ADMIN; purchasing stays owner-only).
- `purchaseSeats {workspaceId, seats}` (OWNER + subscription holder) → `{confirmationUrl, orderId}`.
- `scheduleReduction {workspaceId, targetSeats}` / `cancelReduction` (same gate).
- `seatEvents {workspaceId, cursor}` — the ledger, keyset 30 (OWNER).
- `createInvoiceRequest {workspaceId, ...fields}` (OWNER; sends the operator
  mail via sendMailNow after the domain call), `listInvoiceRequests` (OWNER).
`people.getInvitePreview` gains `{atCapacity, seatPriceKopecks | null}` so the
members UI can show «все места заняты — докупите место за N ₽/мес».

## 6. Web UI

- **Workspace settings «Биллинг мест»** (slug `billing`, after `security`;
  show: `isOwner`; NOT plan-locked [the section explains seat economics even on
  personal — with an upgrade pointer]): usage card («Занято M из K мест: T по
  тарифу + N докупленных», scheduled-reduction notice, period end); purchase
  card (seat stepper, the prorated price preview computed server-side via
  seatUsage.seatPrice + period math displayed honestly «доплата до конца
  периода ≈ N ₽», «Купить» → YooKassa redirect — the checkout-modal pattern);
  reduction card (target stepper, guard messages); the ledger table («журнал
  мест», keyset); invoice-request form (юрлицо fields + validation + the list
  of past requests with status chips). testids: `billing-seat-usage`,
  `billing-buy-seats`, `billing-reduce-seats`, `billing-invoice-form`,
  `billing-seat-events`.
- **Members section**: the invite form's seat line gains the at-capacity CTA
  («Докупить место» → opens the billing section) using the extended preview.
- **User-level `/settings/billing`**: the current-plan card gains the seat
  breakdown for the next renewal («Следующее списание: тариф N ₽ + места M ₽»)
  from a small `subscription.nextChargePreview` query (computeOwnerSeatCharge).

## 7. Invariants (test-pinned)

1. Guests are NEVER billable: no guest path writes the ledger; countBillableSeats
   counts member rows only; conversion writes MEMBER_JOINED only after the
   member row exists (the same tx).
2. OWNER/ADMIN/EDITOR/COMMENTER/VIEWER (and legacy GUEST-role members) each
   occupy exactly one seat; blocked members keep their seat until removed.
3. Money events are idempotent: applySeatPurchase converges on order status;
   renewal seat charges/snapshots written once per renewal order (the renewOne
   idempotency follows the existing order lifecycle).
4. Reductions never refund mid-cycle; purchases charge only the prorated
   remainder; the proration formula is pure and table-tested (incl. month/year
   periods, same-day purchase, last-day purchase, period-ended refusal).
5. Capacity math: assertSeatAvailable everywhere = included + paidSeats;
   reduction below current usage refused; scheduled reductions don't shrink
   usable capacity until applied.
6. Only the subscription-holding owner can move money (purchase/reduce);
   ADMIN can view usage only (FORBIDDEN pinned on the money procs).
7. Every money/seat-config mutation audits; the ledger is append-only.
8. The seat-purchase order path never touches subscription rows; the tier
   path never touches addons except the isInitial reset (pinned).

## 8. Testing

- Domain vitest: the proration table; seat counting (guest fixture excluded,
  blocked counted, every role counted); purchase/apply idempotency (double
  success-callback converges); reduction guards; applyScheduledSeats;
  computeOwnerSeatCharge multi-workspace; addon reset; invoice validation
  (INN/KPP formats); ledger rows for every path (incl. MEMBER_JOINED from all
  five join paths — extend the people/identity suites' asserts).
- tRPC: the gate matrix (ADMIN view-only; non-holder owner? [a workspace's
  OWNER-role member who isn't the createdById subscription holder] FORBIDDEN
  on money procs); purchaseSeats end-to-end with the mocked YooKassa
  (order created, amount = prorated expectation, success applies seats);
  preview extension; invoice mail mock; seatEvents keyset.
- Engines: renewOne with seats (amount math, snapshots, scheduled application,
  the existing renewal tests stay green — flat-price workspaces charge
  identically [zero addon ⇒ zero delta — REGRESSION-PINNED]).
- E2E: owner opens «Биллинг мест» → buys 1 seat (mock YooKassa redirect flow
  → return page → success) → usage shows +1 → an invite that was blocked at
  capacity now succeeds; schedules a reduction → the notice renders; submits
  an invoice request → row with «Новая». (Renewal math is engine-tested, not
  E2E time travel.)
- Full gates + forced uncached sweep; changelog «Оплата по местам».

## 9. Non-goals

- Full per-member repricing; public pricing page changes (tier prices stand;
  the pricing page gains one line mentioning extra-seat prices — copy only).
- Mid-cycle refunds/credits; seat gifting/transfers between workspaces.
- An operator admin panel for InvoiceRequest statuses (the mail + DB row is
  the workflow; statuses are future-ops).
- YooKassa B2B invoice API integration; auto-generated PDF счета.
- Temporary/restricted member no-seat semantics (cl8 reserves them).
