# Kanban Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-workspace participants (registered + unregistered) to Kanban tasks, sprint-aware task creation, avatars everywhere, bulk task actions with multi-drag, label tags in the card footer, and a status `<Select>` in the card dialog.

**Architecture:** A new `WorkspaceParticipant` table unifies assignable people; `TaskAssignee` is repointed from `userId` to `participantId` via a data-preserving migration. Participant write logic lives in `@repo/domain/kanban` and is exposed through a new `kanban.participant` tRPC router; `setTaskAssignees` takes a mixed `{ participantIds, userIdsToMirror }` input. The board query (`getBoard`) gains `user.image` and a `participants` list. Frontend changes are layered on top: a participant picker, a shared avatar component, a card-footer label row, a status select, sprint-aware add, and a page-scoped bulk-selection context with multi-drag.

**Tech Stack:** Prisma 7 + Postgres, tRPC v11, `@repo/domain` (inversify 8 DI + UnitOfWork), Next.js 16 / React 19 / MUI v6, `@hello-pangea/dnd`, vitest (domain + web), Zod.

**Reference spec:** `docs/superpowers/specs/2026-06-03-kanban-participants-bulk-actions-design.md`

**Conventions (read before starting):**
- Prettier: no semicolons, single quotes, trailing commas, 100-col. Run `pnpm format` if unsure.
- Domain files use explicit `.ts` import extensions and only depend on `@repo/db` + `zod`.
- UI imports come from `@repo/ui/components` / `@repo/ui/widgets`, never `@mui/material` directly.
- tRPC `setData` cast pattern (avoids TS2589): cast to an explicit function type before calling — see existing `board-view.tsx:56-59`.
- Commit format: Conventional Commits with scope, e.g. `feat(kanban): …`. Husky runs gates on commit — do NOT use `--no-verify`.
- After each task, the relevant package's `check-types` + `lint` must pass before committing.

---

## Phase 1 — Schema & data-preserving migration

### Task 1: Add `WorkspaceParticipant` model and repoint `TaskAssignee`

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (TaskAssignee block ~1210-1221; Workspace block ~321-349; User model)
- Generated: a new migration dir under `packages/db/prisma/migrations/`

- [ ] **Step 1: Edit the Prisma schema — add the new model and repoint TaskAssignee**

In `packages/db/prisma/schema.prisma`, replace the existing `TaskAssignee` model:

```prisma
model TaskAssignee {
  taskId    String   @map("task_id") @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")

  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([taskId, userId])
  @@index([userId])
  @@map("task_assignees")
}
```

with:

```prisma
model WorkspaceParticipant {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  userId      String?  @map("user_id") @db.Uuid
  fullName    String   @map("full_name") @db.VarChar(64)
  company     String?  @db.VarChar(64)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  workspace Workspace      @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User?          @relation(fields: [userId], references: [id], onDelete: Cascade)
  tasks     TaskAssignee[]

  @@unique([workspaceId, userId])
  @@index([workspaceId])
  @@map("workspace_participants")
}

model TaskAssignee {
  taskId        String   @map("task_id") @db.Uuid
  participantId String   @map("participant_id") @db.Uuid
  createdAt     DateTime @default(now()) @map("created_at")

  task        Task                 @relation(fields: [taskId], references: [id], onDelete: Cascade)
  participant WorkspaceParticipant @relation(fields: [participantId], references: [id], onDelete: Cascade)

  @@id([taskId, participantId])
  @@index([participantId])
  @@map("task_assignees")
}
```

- [ ] **Step 2: Update the `Workspace` model relations**

In the `Workspace` model, add this line alongside the other relation fields (e.g. after `members WorkspaceMember[]`):

```prisma
  participants WorkspaceParticipant[]
```

- [ ] **Step 3: Update the `User` model relations**

In the `User` model, find the existing `TaskAssignee` back-relation (a line like `taskAssignees TaskAssignee[]` or similar) and **replace** it with:

```prisma
  workspaceParticipants WorkspaceParticipant[]
```

(Search the User model for `TaskAssignee` — there should be exactly one back-relation field referencing it; if the field name differs, replace that one. The `Task.assignees TaskAssignee[]` relation on the `Task` model stays unchanged.)

- [ ] **Step 4: Create the migration WITHOUT applying schema-drop yet (so we can hand-edit the data step)**

Run:

```bash
pnpm --filter @repo/db exec prisma migrate dev --create-only --name kanban_workspace_participants
```

Expected: a new directory `packages/db/prisma/migrations/<timestamp>_kanban_workspace_participants/migration.sql` is created (NOT yet applied). The auto-generated SQL will create `workspace_participants`, drop the old `task_assignees` PK/column, and add `participant_id`. We will hand-edit it next to preserve data.

- [ ] **Step 5: Hand-edit `migration.sql` to interleave the data backfill**

Replace the entire contents of the generated `migration.sql` with this exact ordered SQL (this preserves existing assignees):

```sql
-- CreateTable
CREATE TABLE "workspace_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID,
    "full_name" VARCHAR(64) NOT NULL,
    "company" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_participants_workspace_id_user_id_key" ON "workspace_participants"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "workspace_participants_workspace_id_idx" ON "workspace_participants"("workspace_id");

-- AddForeignKey
ALTER TABLE "workspace_participants" ADD CONSTRAINT "workspace_participants_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_participants" ADD CONSTRAINT "workspace_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one mirror participant per (workspace, user) that currently has any assignment
INSERT INTO "workspace_participants" ("workspace_id", "user_id", "full_name", "updated_at")
SELECT DISTINCT
    p."workspace_id",
    ta."user_id",
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u."firstName", u."lastName")), ''), u."email"),
    CURRENT_TIMESTAMP
FROM "task_assignees" ta
JOIN "tasks" t ON t."id" = ta."task_id"
JOIN "pages" p ON p."id" = t."page_id"
JOIN "users" u ON u."id" = ta."user_id";

-- Add participant_id (nullable for the rewrite)
ALTER TABLE "task_assignees" ADD COLUMN "participant_id" UUID;

-- Rewrite each assignee to point at its participant row
UPDATE "task_assignees" ta
SET "participant_id" = wp."id"
FROM "tasks" t
JOIN "pages" p ON p."id" = t."page_id"
JOIN "workspace_participants" wp ON wp."workspace_id" = p."workspace_id"
WHERE t."id" = ta."task_id" AND wp."user_id" = ta."user_id";

-- Drop old PK, index, FK, and column
ALTER TABLE "task_assignees" DROP CONSTRAINT "task_assignees_pkey";
DROP INDEX IF EXISTS "task_assignees_user_id_idx";
ALTER TABLE "task_assignees" DROP CONSTRAINT IF EXISTS "task_assignees_user_id_fkey";
ALTER TABLE "task_assignees" DROP COLUMN "user_id";

-- Enforce NOT NULL + new PK/index/FK
ALTER TABLE "task_assignees" ALTER COLUMN "participant_id" SET NOT NULL;
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("task_id", "participant_id");
CREATE INDEX "task_assignees_participant_id_idx" ON "task_assignees"("participant_id");
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "workspace_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

> Note: raw SQL must use each column's PHYSICAL name. `page_id`/`workspace_id`/`user_id` are `@map`-ed to snake_case, BUT `User.firstName`/`User.lastName`/`User.email` have NO `@map` — their physical columns are the quoted camelCase identifiers `"firstName"`/`"lastName"`/`"email"` (verify against `packages/db/prisma/schema.prisma` User model lines ~13-15). If the auto-generated SQL named the old FK constraint differently than `task_assignees_user_id_fkey`, use `DROP CONSTRAINT IF EXISTS` (already used above) — the `IF EXISTS` makes it safe.

- [ ] **Step 6: Apply the migration and regenerate the client**

```bash
pnpm --filter @repo/db exec prisma migrate dev
pnpm --filter @repo/db prisma:generate
```

Expected: migration applies cleanly; `prisma generate` reports success. If the DB has no existing assignees, the backfill is a no-op and still succeeds.

- [ ] **Step 7: Verify types compile in db package**

Run: `pnpm --filter @repo/db check-types`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add WorkspaceParticipant, repoint TaskAssignee to participantId"
```

---

### Task 2: Migration data-integrity test

**Files:**
- Create: `packages/db/test/participant-migration.test.ts` (if `packages/db/test` doesn't exist, create it; check `packages/db/package.json` for a `test` script — if none, instead add this assertion to the engines integration suite. See Step 1.)

- [ ] **Step 1: Decide the test home**

Run: `cat packages/db/package.json`
- If it has a `"test"` script using vitest/jest with a real DB, put the test in `packages/db/test/participant-migration.test.ts`.
- If `@repo/db` has NO test runner, SKIP creating a runner here; instead this integrity check is covered by the domain repository integration test in Task 5. In that case, mark this task complete with a note and move on. (Do not add a new test toolchain to `@repo/db` just for this.)

- [ ] **Step 2: (Only if @repo/db has a DB-backed test runner) Write the integrity test**

```typescript
import { describe, it, expect } from 'vitest'
import { prisma } from '../src'

// Assumes the migration has run against the test DB.
describe('participant migration integrity', () => {
  it('every task_assignee points at a participant whose user matches its task workspace', async () => {
    const rows = await prisma.taskAssignee.findMany({
      include: { participant: true, task: { include: { page: true } } },
    })
    for (const row of rows) {
      expect(row.participant.workspaceId).toBe(row.task.page.workspaceId)
    }
  })
})
```

- [ ] **Step 3: Run it**

Run: `pnpm --filter @repo/db test` (only if the runner exists)
Expected: PASS (or trivially pass with zero rows on a fresh DB).

- [ ] **Step 4: Commit (if a test file was created)**

```bash
git add packages/db/test/participant-migration.test.ts
git commit -m "test(db): assert participant migration preserves workspace correspondence"
```

---

## Phase 2 — Domain layer (participants + reworked assignees)

### Task 3: Participant DTOs and reworked `setTaskAssignees` input

**Files:**
- Modify: `packages/domain/src/kanban/dto/kanban.dto.ts`

- [ ] **Step 1: Replace the `setTaskAssigneesInput` schema and add participant DTOs**

In `packages/domain/src/kanban/dto/kanban.dto.ts`, replace the existing `setTaskAssigneesInput` block (lines 53-58):

```typescript
export const setTaskAssigneesInput = z.object({
  pageId: z.string().uuid(),
  id: z.string().uuid(),
  userIds: z.array(z.string().uuid()),
})
export type SetTaskAssigneesInput = z.infer<typeof setTaskAssigneesInput>
```

with:

```typescript
export const setTaskAssigneesInput = z.object({
  pageId: z.string().uuid(),
  id: z.string().uuid(),
  participantIds: z.array(z.string().uuid()),
  userIdsToMirror: z.array(z.string().uuid()),
})
export type SetTaskAssigneesInput = z.infer<typeof setTaskAssigneesInput>

export const createParticipantInput = z.object({
  workspaceId: z.string().uuid(),
  fullName: z.string().min(1).max(64),
  company: z.string().max(64).optional(),
})
export type CreateParticipantInput = z.infer<typeof createParticipantInput>

export const updateParticipantInput = z.object({
  workspaceId: z.string().uuid(),
  id: z.string().uuid(),
  fullName: z.string().min(1).max(64),
  company: z.string().max(64).nullable().optional(),
})
export type UpdateParticipantInput = z.infer<typeof updateParticipantInput>

export const participantIdInput = z.object({
  workspaceId: z.string().uuid(),
  id: z.string().uuid(),
})
export type ParticipantIdInput = z.infer<typeof participantIdInput>

export const listParticipantsInput = z.object({
  workspaceId: z.string().uuid(),
})
export type ListParticipantsInput = z.infer<typeof listParticipantsInput>
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm --filter @repo/domain check-types`
Expected: This will FAIL in `kanban.service.ts` because `setTaskAssignees` still reads `input.userIds`. That's expected — Task 4 fixes the service. Confirm the ONLY errors are about `userIds` in the service, then proceed.

- [ ] **Step 3: Commit**

```bash
git add packages/domain/src/kanban/dto/kanban.dto.ts
git commit -m "feat(domain): participant DTOs + mixed setTaskAssignees input"
```

---

### Task 4: Repository methods for participants + participant-based assignees

**Files:**
- Modify: `packages/domain/src/kanban/repositories/kanban.repository.ts`

- [ ] **Step 1: Add a workspace-access helper and participant queries**

In `kanban.repository.ts`, after `findMembershipRole` (line 37), add:

```typescript
  // ── Workspace access ──────────────────────────────────────────────────────

  async findWorkspaceMembershipRole(userId: string, workspaceId: string): Promise<string | null> {
    const member = await this.uow.client().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    })
    return member?.role ?? null
  }

  // ── Participant queries ───────────────────────────────────────────────────

  async listGuestParticipants(workspaceId: string): Promise<
    { id: string; userId: string | null; fullName: string; company: string | null }[]
  > {
    return this.uow.client().workspaceParticipant.findMany({
      where: { workspaceId },
      select: { id: true, userId: true, fullName: true, company: true },
      orderBy: { fullName: 'asc' },
    })
  }

  async findParticipantById(
    id: string,
  ): Promise<{ id: string; workspaceId: string; userId: string | null } | null> {
    return this.uow.client().workspaceParticipant.findUnique({
      where: { id },
      select: { id: true, workspaceId: true, userId: true },
    })
  }

  async createGuestParticipant(data: {
    workspaceId: string
    fullName: string
    company: string | null
  }): Promise<{ id: string; workspaceId: string; userId: string | null; fullName: string; company: string | null }> {
    return this.uow.client().workspaceParticipant.create({
      data: { workspaceId: data.workspaceId, userId: null, fullName: data.fullName, company: data.company },
      select: { id: true, workspaceId: true, userId: true, fullName: true, company: true },
    })
  }

  async updateGuestParticipant(
    id: string,
    data: { fullName: string; company: string | null },
  ): Promise<{ id: string; fullName: string; company: string | null }> {
    return this.uow.client().workspaceParticipant.update({
      where: { id },
      data,
      select: { id: true, fullName: true, company: true },
    })
  }

  async deleteParticipant(id: string): Promise<void> {
    await this.uow.client().workspaceParticipant.delete({ where: { id } })
  }

  async findOrCreateUserParticipant(workspaceId: string, userId: string): Promise<{ id: string }> {
    const existing = await this.uow.client().workspaceParticipant.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    })
    if (existing) return existing
    const user = await this.uow.client().user.findUniqueOrThrow({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    })
    const fullName =
      `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email
    return this.uow.client().workspaceParticipant.create({
      data: { workspaceId, userId, fullName: fullName.slice(0, 64), company: null },
      select: { id: true },
    })
  }
```

- [ ] **Step 2: Repoint the assignee repo methods from userId to participantId**

In `kanban.repository.ts`, replace `findTaskForAssignees` (lines 219-228), `deleteAssignees` (230-234), and `createAssignees` (236-240) with:

```typescript
  async findTaskForAssignees(taskId: string): Promise<{
    id: string
    pageId: string
    assignees: { participantId: string }[]
  }> {
    return this.uow.client().task.findUniqueOrThrow({
      where: { id: taskId },
      select: { id: true, pageId: true, assignees: { select: { participantId: true } } },
    }) as Promise<{ id: string; pageId: string; assignees: { participantId: string }[] }>
  }

  async deleteAssignees(taskId: string, participantIds: string[]): Promise<void> {
    await this.uow.client().taskAssignee.deleteMany({
      where: { taskId, participantId: { in: participantIds } },
    })
  }

  async createAssignees(taskId: string, participantIds: string[]): Promise<void> {
    await this.uow.client().taskAssignee.createMany({
      data: participantIds.map((participantId) => ({ taskId, participantId })),
    })
  }

  async findParticipantWorkspaceIds(participantIds: string[]): Promise<{ id: string; workspaceId: string }[]> {
    return this.uow.client().workspaceParticipant.findMany({
      where: { id: { in: participantIds } },
      select: { id: true, workspaceId: true },
    })
  }
```

- [ ] **Step 3: Verify types compile (service still broken — expected)**

Run: `pnpm --filter @repo/domain check-types`
Expected: errors only in `kanban.service.ts` (still references old `userIds`/`userId` assignee shape). Proceed to Task 5.

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/kanban/repositories/kanban.repository.ts
git commit -m "feat(domain): participant repo methods + participant-based assignee queries"
```

---

### Task 5: Participant service methods + reworked `setTaskAssignees`

**Files:**
- Modify: `packages/domain/src/kanban/services/kanban.service.ts`
- Test: `packages/domain/test/kanban/service.test.ts`

- [ ] **Step 1: Write failing tests for the new behavior**

In `packages/domain/test/kanban/service.test.ts`, first update the `makeRepo` factory's assignee-related defaults. Replace the `findTaskForAssignees` default (line 47) and add the new participant method defaults inside the returned object (anywhere among the other `vi.fn` entries):

```typescript
    findTaskForAssignees: vi.fn(async () => ({ id: 't1', pageId: 'b1', assignees: [] as { participantId: string }[] })),
    findWorkspaceMembershipRole: vi.fn(async () => 'OWNER'),
    listGuestParticipants: vi.fn(async () => []),
    findParticipantById: vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', userId: null })),
    createGuestParticipant: vi.fn(async (d) => ({ id: 'p-new', workspaceId: d.workspaceId, userId: null, fullName: d.fullName, company: d.company })),
    updateGuestParticipant: vi.fn(async (id, d) => ({ id, fullName: d.fullName, company: d.company })),
    deleteParticipant: vi.fn(async () => undefined),
    findOrCreateUserParticipant: vi.fn(async () => ({ id: 'p-user' })),
    findParticipantWorkspaceIds: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, workspaceId: 'w1' }))),
```

Then replace the entire `describe('KanbanService.setTaskAssignees', …)` block with:

```typescript
describe('KanbanService.setTaskAssignees', () => {
  beforeEach(() => vi.clearAllMocks())

  it('mirrors a user id into a participant then assigns it', async () => {
    const repo = makeRepo()
    await makeService(repo).setTaskAssignees('u1', {
      pageId: 'b1', id: 't1', participantIds: [], userIdsToMirror: ['u9'],
    })
    expect(repo.findOrCreateUserParticipant).toHaveBeenCalledWith('w1', 'u9')
    expect(repo.createAssignees).toHaveBeenCalledWith('t1', ['p-user'])
  })

  it('adds a participant and records ASSIGNED', async () => {
    const repo = makeRepo({
      findTaskForAssignees: vi.fn(async () => ({ id: 't1', pageId: 'b1', assignees: [{ participantId: 'p2' }] })),
    })
    await makeService(repo).setTaskAssignees('u1', {
      pageId: 'b1', id: 't1', participantIds: ['p2', 'p3'], userIdsToMirror: [],
    })
    expect(repo.createAssignees).toHaveBeenCalledWith('t1', ['p3'])
    const rows = (repo.createActivityMany as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { type: string }[]
    expect(rows.some((r) => r.type === 'ASSIGNED')).toBe(true)
  })

  it('removes a participant and records UNASSIGNED', async () => {
    const repo = makeRepo({
      findTaskForAssignees: vi.fn(async () => ({ id: 't1', pageId: 'b1', assignees: [{ participantId: 'p2' }, { participantId: 'p3' }] })),
    })
    await makeService(repo).setTaskAssignees('u1', {
      pageId: 'b1', id: 't1', participantIds: ['p2'], userIdsToMirror: [],
    })
    expect(repo.deleteAssignees).toHaveBeenCalledWith('t1', ['p3'])
  })

  it('returns { ok: true }', async () => {
    const repo = makeRepo()
    const result = await makeService(repo).setTaskAssignees('u1', {
      pageId: 'b1', id: 't1', participantIds: [], userIdsToMirror: [],
    })
    expect(result).toEqual({ ok: true })
  })
})

describe('KanbanService.createParticipant', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a guest participant for a workspace member', async () => {
    const repo = makeRepo()
    const result = await makeService(repo).createParticipant('u1', {
      workspaceId: 'w1', fullName: 'Иван Гость', company: 'ООО Ромашка',
    })
    expect(result.id).toBe('p-new')
    expect(repo.createGuestParticipant).toHaveBeenCalledWith({
      workspaceId: 'w1', fullName: 'Иван Гость', company: 'ООО Ромашка',
    })
  })

  it('throws FORBIDDEN for a non-member', async () => {
    const repo = makeRepo({ findWorkspaceMembershipRole: vi.fn(async () => null) })
    await expect(
      makeService(repo).createParticipant('u1', { workspaceId: 'w1', fullName: 'X' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('KanbanService.updateParticipant / deleteParticipant', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects updating a user-linked participant', async () => {
    const repo = makeRepo({
      findParticipantById: vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', userId: 'u5' })),
    })
    await expect(
      makeService(repo).updateParticipant('u1', { workspaceId: 'w1', id: 'p1', fullName: 'X' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('rejects deleting a user-linked participant', async () => {
    const repo = makeRepo({
      findParticipantById: vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', userId: 'u5' })),
    })
    await expect(
      makeService(repo).deleteParticipant('u1', { workspaceId: 'w1', id: 'p1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('deletes a guest participant', async () => {
    const repo = makeRepo()
    const result = await makeService(repo).deleteParticipant('u1', { workspaceId: 'w1', id: 'p1' })
    expect(repo.deleteParticipant).toHaveBeenCalledWith('p1')
    expect(result).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @repo/domain test -- service.test.ts`
Expected: FAIL — `setTaskAssignees`/`createParticipant`/etc. don't yet have the new signatures.

- [ ] **Step 3: Rework `setTaskAssignees` and add participant methods in the service**

In `kanban.service.ts`, add the import for the new DTO types (extend the existing import block from `../dto/kanban.dto.ts`):

```typescript
import type {
  CompleteSprintInput,
  CreateParticipantInput,
  CreateSprintInput,
  CreateTaskCommentInput,
  CreateTaskInput,
  MoveTaskInput,
  ParticipantIdInput,
  SetTaskAssigneesInput,
  SprintIdInput,
  TaskIdInput,
  UpdateParticipantInput,
  UpdateTaskInput,
} from '../dto/kanban.dto.ts'
```

Replace the whole `setTaskAssignees` method (lines 197-217) with:

```typescript
  async setTaskAssignees(actorUserId: string, input: SetTaskAssigneesInput) {
    const page = await this.assertCanEdit(actorUserId, input.pageId)
    const current = await this.repo.findTaskForAssignees(input.id)
    if (current.pageId !== page.id) throw notFound('Задача не найдена')

    return this.uow.transaction(async () => {
      // Mirror any raw user ids into participant rows for this workspace.
      const mirroredIds: string[] = []
      for (const userId of input.userIdsToMirror) {
        const p = await this.repo.findOrCreateUserParticipant(page.workspaceId, userId)
        mirroredIds.push(p.id)
      }
      const targetIds = new Set([...input.participantIds, ...mirroredIds])

      // Validate every target participant belongs to this workspace.
      if (targetIds.size > 0) {
        const rows = await this.repo.findParticipantWorkspaceIds([...targetIds])
        for (const id of targetIds) {
          const row = rows.find((r) => r.id === id)
          if (!row || row.workspaceId !== page.workspaceId)
            throw badRequest('Участник не принадлежит рабочей области')
        }
      }

      const currentIds = new Set(current.assignees.map((a) => a.participantId))
      const toRemove = [...currentIds].filter((id) => !targetIds.has(id))
      const toAdd = [...targetIds].filter((id) => !currentIds.has(id))

      if (toRemove.length > 0) await this.repo.deleteAssignees(input.id, toRemove)
      if (toAdd.length > 0) await this.repo.createAssignees(input.id, toAdd)
      const activityRows = [
        ...toRemove.map((participantId) => ({ taskId: input.id, actorId: actorUserId, type: 'UNASSIGNED' as const, payload: { participantId } })),
        ...toAdd.map((participantId) => ({ taskId: input.id, actorId: actorUserId, type: 'ASSIGNED' as const, payload: { participantId } })),
      ]
      if (activityRows.length > 0) await this.repo.createActivityMany(activityRows)
      return { ok: true as const }
    })
  }

  // ── Participant operations ────────────────────────────────────────────────

  private async assertWorkspaceMember(userId: string, workspaceId: string): Promise<void> {
    const role = await this.repo.findWorkspaceMembershipRole(userId, workspaceId)
    if (!role) throw forbidden('Недостаточно прав')
  }

  async listParticipants(actorUserId: string, workspaceId: string) {
    await this.assertWorkspaceMember(actorUserId, workspaceId)
    return this.repo.listGuestParticipants(workspaceId)
  }

  async createParticipant(actorUserId: string, input: CreateParticipantInput) {
    await this.assertWorkspaceMember(actorUserId, input.workspaceId)
    return this.repo.createGuestParticipant({
      workspaceId: input.workspaceId,
      fullName: input.fullName,
      company: input.company ?? null,
    })
  }

  async updateParticipant(actorUserId: string, input: UpdateParticipantInput) {
    await this.assertWorkspaceMember(actorUserId, input.workspaceId)
    const existing = await this.repo.findParticipantById(input.id)
    if (!existing || existing.workspaceId !== input.workspaceId) throw notFound('Участник не найден')
    if (existing.userId) throw conflict('Этот участник связан с пользователем и не редактируется')
    return this.repo.updateGuestParticipant(input.id, {
      fullName: input.fullName,
      company: input.company ?? null,
    })
  }

  async deleteParticipant(actorUserId: string, input: ParticipantIdInput) {
    await this.assertWorkspaceMember(actorUserId, input.workspaceId)
    const existing = await this.repo.findParticipantById(input.id)
    if (!existing || existing.workspaceId !== input.workspaceId) throw notFound('Участник не найден')
    if (existing.userId) throw conflict('Этот участник связан с пользователем и не удаляется')
    await this.repo.deleteParticipant(input.id)
    return { ok: true as const }
  }
```

> The `conflict` and `forbidden` helpers are already imported at the top of the file (line 1). `badRequest` and `notFound` too.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @repo/domain test -- service.test.ts`
Expected: PASS (all new + existing tests).

- [ ] **Step 5: Verify the whole domain package type-checks**

Run: `pnpm --filter @repo/domain check-types && pnpm --filter @repo/domain lint`
Expected: exit 0 both.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/kanban/services/kanban.service.ts packages/domain/test/kanban/service.test.ts
git commit -m "feat(domain): participant CRUD + participant-based setTaskAssignees"
```

---

## Phase 3 — tRPC layer (participant router, board query, bulk delete)

### Task 6: Update `getBoard` to select `image` and include participants

**Files:**
- Modify: `packages/trpc/src/routers/kanban/board.ts`
- Modify: `apps/web/src/components/kanban/types.ts`

- [ ] **Step 1: Add `image` to user selects and include participant on assignees**

In `board.ts`, change the task `assignees` include and the `members` include, and add a `participants` query. Replace the `Promise.all` destructuring and its array.

Change the destructuring line from:

```typescript
      const [columns, types, priorities, labels, sprints, tasks, members] = await Promise.all([
```

to:

```typescript
      const [columns, types, priorities, labels, sprints, tasks, members, participants] = await Promise.all([
```

Change the task `assignees` include block from:

```typescript
          include: {
            assignees: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true, email: true } },
              },
            },
            labels: { include: { label: true } },
          },
```

to:

```typescript
          include: {
            assignees: {
              include: {
                participant: {
                  include: {
                    user: { select: { id: true, firstName: true, lastName: true, email: true, image: true } },
                  },
                },
              },
            },
            labels: { include: { label: true } },
          },
```

Change the `members` include from:

```typescript
        ctx.prisma.workspaceMember.findMany({
          where: { workspaceId: page.workspaceId },
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        }),
```

to:

```typescript
        ctx.prisma.workspaceMember.findMany({
          where: { workspaceId: page.workspaceId },
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true, image: true } },
          },
        }),
        ctx.prisma.workspaceParticipant.findMany({
          where: { workspaceId: page.workspaceId },
          select: {
            id: true,
            userId: true,
            fullName: true,
            company: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true, image: true } },
          },
          orderBy: { fullName: 'asc' },
        }),
```

Add `participants` to the returned object (after `members,`):

```typescript
        members,
        participants,
```

- [ ] **Step 2: Update the frontend `BoardData` / assignee / member types**

In `apps/web/src/components/kanban/types.ts`, update `BoardMember.user` to include `image`, update the task `assignees` shape, and add a `BoardParticipant` type + `participants` to `BoardData`.

Replace the `BoardMember` interface:

```typescript
export interface BoardMember {
  userId: string
  role: string
  user: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string
    image: string | null
  }
}

export interface BoardParticipant {
  id: string
  userId: string | null
  fullName: string
  company: string | null
  user: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string
    image: string | null
  } | null
}

export interface BoardAssignee {
  participantId: string
  participant: {
    id: string
    userId: string | null
    fullName: string
    company: string | null
    user: {
      id: string
      firstName: string | null
      lastName: string | null
      email: string
      image: string | null
    } | null
  }
}
```

In `BoardTaskData`, replace the `assignees` field:

```typescript
  assignees: BoardAssignee[]
```

In `BoardData`, add after `members: BoardMember[]`:

```typescript
  participants: BoardParticipant[]
```

- [ ] **Step 3: Type-check (web will break in consumers — expected; fixed in Phase 4)**

Run: `pnpm --filter @repo/trpc check-types`
Expected: PASS (trpc compiles; it returns inferred types).
Run: `pnpm --filter web check-types`
Expected: FAIL in `board-card.tsx`, `task-form.tsx`, `table-view.tsx`, `sprint-section.tsx`, `assignee-avatars.tsx`, `apply-filters.ts` (all read the old `a.userId`/`a.user.id` shape). These are fixed in Phase 4. Note the failing files, then proceed.

- [ ] **Step 4: Commit**

```bash
git add packages/trpc/src/routers/kanban/board.ts apps/web/src/components/kanban/types.ts
git commit -m "feat(trpc): board query selects avatars + participants; repoint assignee types"
```

---

### Task 7: `kanban.participant` router + reworked `setAssignees` + `bulkSoftDelete`

**Files:**
- Create: `packages/trpc/src/routers/kanban/participant.ts`
- Modify: `packages/trpc/src/routers/kanban/index.ts`
- Modify: `packages/trpc/src/routers/kanban/task.ts`
- Test: `packages/trpc/test/kanban-participant.test.ts` (check `packages/trpc/test` exists; vitest)

- [ ] **Step 1: Create the participant router**

Create `packages/trpc/src/routers/kanban/participant.ts`:

```typescript
import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'

export const participantRouter = router({
  list: protectedProcedure
    .input(domain.listParticipantsInput)
    .query(async ({ ctx, input }) => {
      return mapDomain(() => domainSvc.kanban.listParticipants(ctx.user.id, input.workspaceId))
    }),

  create: protectedProcedure
    .input(domain.createParticipantInput)
    .mutation(async ({ ctx, input }) => {
      return mapDomain(() => domainSvc.kanban.createParticipant(ctx.user.id, input))
    }),

  update: protectedProcedure
    .input(domain.updateParticipantInput)
    .mutation(async ({ ctx, input }) => {
      return mapDomain(() => domainSvc.kanban.updateParticipant(ctx.user.id, input))
    }),

  delete: protectedProcedure
    .input(domain.participantIdInput)
    .mutation(async ({ ctx, input }) => {
      return mapDomain(() => domainSvc.kanban.deleteParticipant(ctx.user.id, input))
    }),
})
```

- [ ] **Step 2: Register the router**

In `packages/trpc/src/routers/kanban/index.ts`, add the import and the `participant` key:

```typescript
import { participantRouter } from './participant'
```

and inside `router({ … })` add (after `task: taskRouter,`):

```typescript
  participant: participantRouter,
```

- [ ] **Step 3: Add `bulkSoftDelete` to the task router**

In `packages/trpc/src/routers/kanban/task.ts`, add this procedure inside `taskRouter` (after the existing `softDelete` procedure). It reuses the same per-task creator-or-OWNER permission check but skips disallowed ids instead of throwing:

```typescript
  bulkSoftDelete: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), ids: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
      })
      const isOwner = member?.role === 'OWNER'
      const tasks = await ctx.prisma.task.findMany({
        where: { id: { in: input.ids }, pageId: page.id, deletedAt: null },
        select: { id: true, createdById: true },
      })
      const deletable = tasks.filter((t) => isOwner || t.createdById === ctx.user.id).map((t) => t.id)
      if (deletable.length > 0) {
        await ctx.prisma.task.updateMany({
          where: { id: { in: deletable } },
          data: { deletedAt: new Date(), updatedById: ctx.user.id },
        })
        for (const id of deletable) {
          kanbanBus.emit(page.id, { kind: 'task.deleted', taskId: id })
        }
      }
      return { deletedIds: deletable }
    }),
```

(`assertPageAccess`, `z`, and `kanbanBus` are already imported at the top of `task.ts`.)

- [ ] **Step 4: Verify trpc type-checks**

Run: `pnpm --filter @repo/trpc check-types && pnpm --filter @repo/trpc lint`
Expected: exit 0 both. (The `setAssignees` procedure already passes `input` straight through to the domain; since `domain.setTaskAssigneesInput` changed shape in Task 3, the procedure compiles unchanged — its input type is inferred from the new DTO.)

- [ ] **Step 5: Write a router test for participant CRUD + bulkSoftDelete permission filtering**

Check the test conventions: `ls packages/trpc/test` and open one existing test to copy its harness (how it builds a caller + seeds a workspace/page/user). Create `packages/trpc/test/kanban-participant.test.ts` mirroring that harness, asserting:
- `participant.create` then `participant.list` returns the guest.
- `participant.update` on a guest changes the name; on a user-linked participant throws `CONFLICT`.
- `participant.delete` on a guest removes it.
- `task.bulkSoftDelete` as a non-owner non-creator returns `{ deletedIds: [] }` for others' tasks but deletes own; as OWNER deletes all.

> If `packages/trpc/test` has no DB-backed harness (it's pure-unit), instead defer these assertions to a domain-level test you already have in Task 5 for the CONFLICT cases, and cover `bulkSoftDelete` with a thin unit test that mocks `ctx.prisma`. Pick whichever matches the existing `packages/trpc/test` style — do not invent a new harness.

- [ ] **Step 6: Run the test**

Run: `pnpm --filter @repo/trpc test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/trpc/src/routers/kanban/participant.ts packages/trpc/src/routers/kanban/index.ts packages/trpc/src/routers/kanban/task.ts packages/trpc/test/kanban-participant.test.ts
git commit -m "feat(trpc): kanban.participant router + task.bulkSoftDelete"
```

---

## Phase 4 — Frontend: shared primitives, picker, avatars, labels, status, sprint-aware add

### Task 8: Shared participant display helpers + `ParticipantAvatar`

**Files:**
- Create: `apps/web/src/components/kanban/components/participant-display.ts`
- Modify: `apps/web/src/components/kanban/components/assignee-avatars.tsx`
- Test: `apps/web/test/kanban-participant-display.test.ts`

- [ ] **Step 1: Write failing tests for the display helpers**

Create `apps/web/test/kanban-participant-display.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { participantName, participantInitials } from '@/components/kanban/components/participant-display'

describe('participantName', () => {
  it('uses the linked user full name', () => {
    expect(
      participantName({
        id: 'p1', userId: 'u1', fullName: 'ignored', company: null,
        user: { id: 'u1', firstName: 'Анна', lastName: 'Петрова', email: 'a@x.io', image: null },
      }),
    ).toBe('Анна Петрова')
  })

  it('falls back to fullName for a guest', () => {
    expect(
      participantName({ id: 'p2', userId: null, fullName: 'Антон Гость', company: 'ООО', user: null }),
    ).toBe('Антон Гость')
  })

  it('falls back to email when a linked user has no name', () => {
    expect(
      participantName({
        id: 'p3', userId: 'u3', fullName: 'x', company: null,
        user: { id: 'u3', firstName: null, lastName: null, email: 'noname@x.io', image: null },
      }),
    ).toBe('noname@x.io')
  })
})

describe('participantInitials', () => {
  it('returns two uppercase initials for a named guest', () => {
    expect(
      participantInitials({ id: 'p2', userId: null, fullName: 'Антон Кузнецов', company: null, user: null }),
    ).toBe('АК')
  })

  it('returns one initial for a single-word name', () => {
    expect(
      participantInitials({ id: 'p2', userId: null, fullName: 'Антон', company: null, user: null }),
    ).toBe('А')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web test -- kanban-participant-display.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `apps/web/src/components/kanban/components/participant-display.ts`:

```typescript
import type { BoardParticipant } from '../types'

type ParticipantLike = Pick<BoardParticipant, 'fullName' | 'company' | 'user'>

export function participantName(p: ParticipantLike): string {
  if (p.user) {
    const full = `${p.user.firstName ?? ''} ${p.user.lastName ?? ''}`.trim()
    return full || p.user.email
  }
  return p.fullName
}

export function participantImage(p: ParticipantLike): string | null {
  return p.user?.image ?? null
}

export function participantInitials(p: ParticipantLike): string {
  const name = participantName(p)
  const parts = name.split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const second = parts[1]?.[0] ?? ''
  return `${first}${second}`.toUpperCase()
}
```

- [ ] **Step 4: Rewrite `assignee-avatars.tsx` to use MUI Avatar + participants**

Replace the full contents of `apps/web/src/components/kanban/components/assignee-avatars.tsx`:

```typescript
'use client'

import { Avatar, Stack, Tooltip } from '@repo/ui/components'

import type { BoardAssignee } from '../types'
import { participantImage, participantInitials, participantName } from './participant-display'

interface AssigneeAvatarsProps {
  readonly assignees: BoardAssignee[]
  readonly size?: number
  readonly max?: number
}

export function AssigneeAvatars({ assignees, size = 24, max = 3 }: AssigneeAvatarsProps) {
  if (assignees.length === 0) return null
  return (
    <Stack direction="row" spacing={-0.5}>
      {assignees.slice(0, max).map((a) => {
        const p = a.participant
        return (
          <Tooltip key={a.participantId} title={participantName(p)}>
            <Avatar
              src={participantImage(p) ?? undefined}
              sx={{
                width: size,
                height: size,
                fontSize: 11,
                border: 2,
                borderColor: 'background.paper',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
              }}
            >
              {participantInitials(p)}
            </Avatar>
          </Tooltip>
        )
      })}
      {assignees.length > max ? (
        <Avatar
          sx={{
            width: size,
            height: size,
            fontSize: 11,
            border: 2,
            borderColor: 'background.paper',
            bgcolor: 'action.disabledBackground',
            color: 'text.secondary',
          }}
        >
          +{assignees.length - max}
        </Avatar>
      ) : null}
    </Stack>
  )
}
```

> Ensure `Avatar` and `Tooltip` are exported from `@repo/ui/components`. If not, add re-exports to `packages/ui/src/components/index.ts` as a sub-step (the package re-exports MUI components explicitly).

- [ ] **Step 5: Run the display tests**

Run: `pnpm --filter web test -- kanban-participant-display.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/kanban/components/participant-display.ts apps/web/src/components/kanban/components/assignee-avatars.tsx apps/web/test/kanban-participant-display.test.ts packages/ui/src/components/index.ts
git commit -m "feat(kanban): shared participant display helpers + Avatar-based assignee avatars"
```

---

### Task 9: Participant picker component

**Files:**
- Create: `apps/web/src/components/kanban/task/participant-picker.tsx`

This is the chips-on-top + search-below picker. It takes the board's members + participants, the current selection (participant ids), and callbacks to assign existing participants, mirror a member, and create a guest.

- [ ] **Step 1: Build a pure selection-source helper (unit-testable)**

Create `apps/web/src/components/kanban/task/participant-picker-model.ts`:

```typescript
import type { BoardMember, BoardParticipant } from '../types'
import { participantName } from '../components/participant-display'

export interface PickerCandidate {
  readonly key: string // participantId if it exists, else `member:<userId>`
  readonly kind: 'participant' | 'member'
  readonly label: string
  readonly sublabel: string | null
  readonly inWorkspace: boolean
  readonly participantId: string | null
  readonly userId: string | null
  readonly image: string | null
  readonly initialsSource: BoardParticipant | { fullName: string; company: null; user: BoardMember['user'] }
}

export function buildCandidates(
  members: BoardMember[],
  participants: BoardParticipant[],
  query: string,
): PickerCandidate[] {
  const mirroredUserIds = new Set(participants.filter((p) => p.userId).map((p) => p.userId))
  const memberCandidates: PickerCandidate[] = members.map((m) => {
    const existing = participants.find((p) => p.userId === m.user.id)
    const name = `${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() || m.user.email
    return {
      key: existing ? existing.id : `member:${m.user.id}`,
      kind: 'member',
      label: name,
      sublabel: m.user.email,
      inWorkspace: true,
      participantId: existing?.id ?? null,
      userId: m.user.id,
      image: m.user.image,
      initialsSource: { fullName: name, company: null, user: m.user },
    }
  })
  const guestCandidates: PickerCandidate[] = participants
    .filter((p) => !p.userId || !mirroredUserIds.has(p.userId))
    .filter((p) => !p.userId) // pure guests only; mirrored users already shown as members
    .map((p) => ({
      key: p.id,
      kind: 'participant',
      label: participantName(p),
      sublabel: p.company,
      inWorkspace: false,
      participantId: p.id,
      userId: null,
      image: null,
      initialsSource: p,
    }))

  const q = query.trim().toLocaleLowerCase('ru-RU')
  const all = [...memberCandidates, ...guestCandidates]
  if (!q) return all
  return all.filter(
    (c) =>
      c.label.toLocaleLowerCase('ru-RU').includes(q) ||
      (c.sublabel?.toLocaleLowerCase('ru-RU').includes(q) ?? false),
  )
}
```

- [ ] **Step 2: Write a unit test for `buildCandidates`**

Create `apps/web/test/kanban-participant-picker-model.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildCandidates } from '@/components/kanban/task/participant-picker-model'

const member = {
  userId: 'u1', role: 'EDITOR',
  user: { id: 'u1', firstName: 'Анна', lastName: 'Петрова', email: 'a@x.io', image: null },
}
const guest = { id: 'p9', userId: null, fullName: 'Антон Гость', company: 'ООО', user: null }

describe('buildCandidates', () => {
  it('lists members first, then pure guests', () => {
    const res = buildCandidates([member], [guest], '')
    expect(res[0]!.kind).toBe('member')
    expect(res[1]!.kind).toBe('participant')
  })

  it('uses an existing mirror participant id for a member', () => {
    const mirror = { id: 'pm', userId: 'u1', fullName: 'Анна Петрова', company: null, user: member.user }
    const res = buildCandidates([member], [mirror], '')
    expect(res[0]!.participantId).toBe('pm')
  })

  it('filters by query across name and sublabel', () => {
    const res = buildCandidates([member], [guest], 'ромашка')
    expect(res).toHaveLength(0) // company is "ООО", not matching
    const res2 = buildCandidates([member], [guest], 'гост')
    expect(res2).toHaveLength(1)
    expect(res2[0]!.label).toBe('Антон Гость')
  })
})
```

Run: `pnpm --filter web test -- kanban-participant-picker-model.test.ts`
Expected: FAIL first (module missing), then after Step 1 exists, PASS. Run it now to confirm PASS.

- [ ] **Step 3: Build the picker UI component**

Create `apps/web/src/components/kanban/task/participant-picker.tsx`. It renders: selected chips (removable), a search field, the filtered candidate list, and a "Создать гостя «query»" row that opens a small inline form (ФИО + Компания). Use `Avatar` + `participantInitials`. Props:

```typescript
'use client'

import { useMemo, useState } from 'react'
import {
  Avatar,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import type { BoardMember, BoardParticipant } from '../types'
import { participantInitials, participantName } from '../components/participant-display'
import { buildCandidates } from './participant-picker-model'

interface ParticipantPickerProps {
  readonly members: BoardMember[]
  readonly participants: BoardParticipant[]
  readonly selectedParticipantIds: string[]
  readonly onAssignParticipant: (participantId: string) => void
  readonly onMirrorMember: (userId: string) => void
  readonly onUnassign: (participantId: string) => void
  readonly onCreateGuest: (input: { fullName: string; company: string | null }) => void
}

export function ParticipantPicker({
  members,
  participants,
  selectedParticipantIds,
  onAssignParticipant,
  onMirrorMember,
  onUnassign,
  onCreateGuest,
}: ParticipantPickerProps) {
  const [query, setQuery] = useState('')
  const [guestName, setGuestName] = useState('')
  const [guestCompany, setGuestCompany] = useState('')
  const [creating, setCreating] = useState(false)

  const selected = useMemo(
    () =>
      selectedParticipantIds
        .map((id) => participants.find((p) => p.id === id))
        .filter((p): p is BoardParticipant => Boolean(p)),
    [selectedParticipantIds, participants],
  )

  const candidates = useMemo(
    () => buildCandidates(members, participants, query),
    [members, participants, query],
  )

  function handleCandidateClick(participantId: string | null, userId: string | null) {
    if (participantId) {
      if (selectedParticipantIds.includes(participantId)) onUnassign(participantId)
      else onAssignParticipant(participantId)
      return
    }
    if (userId) onMirrorMember(userId)
  }

  function submitGuest() {
    const name = guestName.trim().slice(0, 64)
    if (!name) return
    onCreateGuest({ fullName: name, company: guestCompany.trim().slice(0, 64) || null })
    setGuestName('')
    setGuestCompany('')
    setCreating(false)
    setQuery('')
  }

  return (
    <Box sx={{ p: 1.5, minWidth: 300, maxWidth: 340 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 600 }}>
        Участники
      </Typography>

      {selected.length > 0 ? (
        <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ gap: 0.5, mb: 1 }}>
          {selected.map((p) => (
            <Chip
              key={p.id}
              size="small"
              avatar={<Avatar src={p.user?.image ?? undefined}>{participantInitials(p)}</Avatar>}
              label={participantName(p)}
              onDelete={() => onUnassign(p.id)}
            />
          ))}
        </Stack>
      ) : null}

      <TextField
        size="small"
        fullWidth
        autoFocus
        placeholder="Поиск или новое имя…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ mb: 1 }}
      />

      <Stack spacing={0.25} sx={{ maxHeight: 280, overflowY: 'auto' }}>
        {candidates.map((c) => {
          const checked = c.participantId ? selectedParticipantIds.includes(c.participantId) : false
          return (
            <Stack
              key={c.key}
              direction="row"
              alignItems="center"
              spacing={1}
              onClick={() => handleCandidateClick(c.participantId, c.userId)}
              sx={{
                px: 0.5, py: 0.5, borderRadius: 1, cursor: 'pointer',
                bgcolor: checked ? 'action.selected' : 'transparent',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Avatar src={c.image ?? undefined} sx={{ width: 24, height: 24, fontSize: 11 }}>
                {participantInitials(c.initialsSource)}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {c.label}
                  {c.inWorkspace ? (
                    <Box component="span" sx={{ ml: 0.75, fontSize: 10, color: 'primary.main', border: 1, borderColor: 'primary.light', borderRadius: 0.5, px: 0.5 }}>
                      в пространстве
                    </Box>
                  ) : null}
                </Typography>
                {c.sublabel ? (
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {c.sublabel}
                  </Typography>
                ) : null}
              </Box>
            </Stack>
          )
        })}
      </Stack>

      {creating ? (
        <Stack spacing={1} sx={{ mt: 1 }}>
          <TextField
            size="small" fullWidth autoFocus label="ФИО" inputProps={{ maxLength: 64 }}
            value={guestName} onChange={(e) => setGuestName(e.target.value)}
          />
          <TextField
            size="small" fullWidth label="Компания" inputProps={{ maxLength: 64 }}
            value={guestCompany} onChange={(e) => setGuestCompany(e.target.value)}
          />
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" onClick={submitGuest}>Создать</Button>
            <Button size="small" onClick={() => setCreating(false)}>Отмена</Button>
          </Stack>
        </Stack>
      ) : (
        <Box
          onClick={() => { setGuestName(query.trim()); setCreating(true) }}
          sx={{ mt: 1, p: 1, border: '1px dashed', borderColor: 'primary.light', borderRadius: 1, fontSize: 13, color: 'primary.main', cursor: 'pointer' }}
        >
          ＋ Создать гостя{query.trim() ? ` «${query.trim()}»` : ''}…
        </Box>
      )}
    </Box>
  )
}
```

- [ ] **Step 4: Type-check (will still fail at task-form until Task 10)**

Run: `pnpm --filter web check-types`
Expected: the picker file itself type-checks; remaining errors are the pre-existing assignee-shape errors in other files (fixed in Tasks 10-13). Confirm no NEW errors originate inside `participant-picker.tsx` / its model.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/kanban/task/participant-picker.tsx apps/web/src/components/kanban/task/participant-picker-model.ts apps/web/test/kanban-participant-picker-model.test.ts
git commit -m "feat(kanban): participant picker (chips + search + create-guest)"
```

---

### Task 10: Wire the picker into `task-form.tsx` + status (no change here) + assignee shape

**Files:**
- Modify: `apps/web/src/components/kanban/task/task-form.tsx`

- [ ] **Step 1: Replace assignee state to track participant ids and add mutations**

In `task-form.tsx`, change the assignee state initialization. Replace line 106:

```typescript
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task.assignees.map((a) => a.user.id))
```

with:

```typescript
  const [assigneeParticipantIds, setAssigneeParticipantIds] = useState<string[]>(
    task.assignees.map((a) => a.participantId),
  )
```

Replace the sync effect (line 116):

```typescript
  useEffect(() => setAssigneeIds(task.assignees.map((a) => a.user.id)), [task.assignees])
```

with:

```typescript
  useEffect(
    () => setAssigneeParticipantIds(task.assignees.map((a) => a.participantId)),
    [task.assignees],
  )
```

- [ ] **Step 2: Add a participant.create mutation and helper callbacks**

After the existing `labelDelete` mutation (line 101), add:

```typescript
  const participantCreate = trpc.kanban.participant.create.useMutation({ onSuccess: invalidateBoard })
```

Replace the `toggleAssignee` function (lines 201-207) with these callbacks:

```typescript
  function applyAssignees(participantIds: string[], userIdsToMirror: string[]) {
    setAssigneeParticipantIds(participantIds)
    setAssignees.mutate({ pageId, id: task.id, participantIds, userIdsToMirror })
  }
  function assignExistingParticipant(participantId: string) {
    applyAssignees([...assigneeParticipantIds, participantId], [])
  }
  function unassignParticipant(participantId: string) {
    applyAssignees(assigneeParticipantIds.filter((x) => x !== participantId), [])
  }
  function mirrorMember(userId: string) {
    applyAssignees(assigneeParticipantIds, [userId])
  }
  async function createGuestAndAssign(input: { fullName: string; company: string | null }) {
    const created = await participantCreate.mutateAsync({
      workspaceId: board.workspaceId,
      fullName: input.fullName,
      company: input.company ?? undefined,
    })
    applyAssignees([...assigneeParticipantIds, created.id], [])
  }
```

- [ ] **Step 3: Replace the assignees popover body with the picker**

Add the import near the top (after the `ManageListPopover` import, line 36):

```typescript
import { ParticipantPicker } from './participant-picker'
```

Replace the entire assignees `<Popover>` block (lines 419-479) with:

```typescript
        <Popover
          open={popover === 'assignees'}
          anchorEl={popoverAnchor}
          onClose={closePopover}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transitionDuration={0}
        >
          {popover === 'assignees' ? (
            <ParticipantPicker
              members={board.members}
              participants={board.participants}
              selectedParticipantIds={assigneeParticipantIds}
              onAssignParticipant={assignExistingParticipant}
              onMirrorMember={mirrorMember}
              onUnassign={unassignParticipant}
              onCreateGuest={createGuestAndAssign}
            />
          ) : null}
        </Popover>
```

- [ ] **Step 4: Update the "Участники (N)" chip count**

Replace the assignees `ActionChip` (lines 271-275):

```typescript
          <ActionChip
            label={assigneeIds.length > 0 ? `Участники (${assigneeIds.length})` : 'Участники'}
            highlighted={assigneeIds.length > 0}
            onClick={openPopover('assignees')}
          />
```

with:

```typescript
          <ActionChip
            label={
              assigneeParticipantIds.length > 0
                ? `Участники (${assigneeParticipantIds.length})`
                : 'Участники'
            }
            highlighted={assigneeParticipantIds.length > 0}
            onClick={openPopover('assignees')}
          />
```

- [ ] **Step 5: Remove the now-unused `memberLabel` helper**

Delete the `memberLabel` function (lines 46-48) — the picker handles labels now. (If lint flags it as unused, that confirms it should go.)

- [ ] **Step 6: Type-check + lint the file**

Run: `pnpm --filter web check-types`
Expected: `task-form.tsx` errors resolved; remaining errors only in board-card/table-view/sprint-section/apply-filters (Tasks 11-13).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/kanban/task/task-form.tsx
git commit -m "feat(kanban): wire participant picker into task form"
```

---

### Task 11: Status `<Select>` in the card dialog header

**Files:**
- Modify: `apps/web/src/components/kanban/task/task-detail-modal.tsx`

- [ ] **Step 1: Replace the read-only column title with a status Select**

In `task-detail-modal.tsx`, add imports (extend the `@repo/ui/components` import block):

```typescript
import {
  Box,
  CloseIcon,
  Dialog,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@repo/ui/components'
```

Add the trpc import and the move mutation:

```typescript
import { trpc } from '@/trpc/client'
```

Inside the component, after `const column = …` add:

```typescript
  const utils = trpc.useUtils()
  const moveTask = trpc.kanban.task.move.useMutation({
    onSuccess: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })
  const orderedColumns = [...board.columns].sort((a, b) => a.position - b.position)

  function changeStatus(targetColumnId: string) {
    if (targetColumnId === task.columnId) return
    moveTask.mutate({ pageId, id: task.id, targetColumnId, beforeId: null, afterId: null })
  }
```

Replace the header `<Typography>` that renders `{column?.title ?? ''}` with:

```typescript
        <Select
          size="small"
          value={task.columnId}
          onChange={(e) => changeStatus(e.target.value)}
          disabled={!editable}
          sx={{ flex: '0 0 auto', minWidth: 180 }}
        >
          {orderedColumns.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: c.color ?? 'text.disabled' }} />
                <span>{c.title}</span>
              </Stack>
            </MenuItem>
          ))}
        </Select>
        <Box sx={{ flex: 1 }} />
```

- [ ] **Step 2: Type-check + lint**

Run: `pnpm --filter web check-types`
Expected: no new errors in `task-detail-modal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/kanban/task/task-detail-modal.tsx
git commit -m "feat(kanban): status Select in card dialog header changes task column"
```

---

### Task 12: Card footer labels + assignee shape fixes in board/table/sprint/filters

**Files:**
- Modify: `apps/web/src/components/kanban/views/board-card.tsx`
- Modify: `apps/web/src/components/kanban/views/board-card-model.ts` (no change to logic; verify labels still computed)
- Modify: `apps/web/src/components/kanban/views/table-view.tsx`
- Modify: `apps/web/src/components/kanban/views/sprint-section.tsx`
- Modify: `apps/web/src/components/kanban/filters/apply-filters.ts`

- [ ] **Step 1: Fix `apply-filters.ts` assignee read**

In `apply-filters.ts`, replace line 69:

```typescript
      const assigneeIds = task.assignees.map((a) => a.userId)
```

with (filter by the linked user id, since the user filter is user-based):

```typescript
      const assigneeIds = task.assignees
        .map((a) => a.participant.userId)
        .filter((id): id is string => Boolean(id))
```

- [ ] **Step 2: Move labels to the card footer in `board-card.tsx`**

In `board-card.tsx`:

(a) Remove the top labels block (lines 175-204, the `{model.visibleLabels.length > 0 ? (…) : null}` Stack).

(b) Replace the assignees/date footer block (lines 206-232) with a row that includes labels (right-aligned, left of avatars). Replace it with:

```typescript
              {task.assignees.length > 0 || model.dateLabel || model.visibleLabels.length > 0 ? (
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.25, minWidth: 0 }}>
                  {model.dateLabel ? (
                    <Box
                      component="span"
                      sx={{
                        px: 0.75, py: 0.125, border: 1, borderRadius: 1,
                        color: dateBadge.color, borderColor: dateBadge.borderColor,
                        bgcolor: dateBadge.backgroundColor, fontSize: 12, lineHeight: '18px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {model.dateLabel}
                    </Box>
                  ) : null}
                  <Box sx={{ flex: 1 }} />
                  {model.visibleLabels.length > 0 ? (
                    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
                      {model.visibleLabels.map((item) => (
                        <Chip
                          key={item.labelId}
                          size="small"
                          label={item.label.name}
                          sx={{
                            height: 20, maxWidth: 96, borderRadius: 1,
                            bgcolor: item.label.color, color: '#fff',
                            '& .MuiChip-label': { px: 0.75, overflow: 'hidden', textOverflow: 'ellipsis' },
                          }}
                        />
                      ))}
                      {model.hiddenLabelCount > 0 ? (
                        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1 }}>
                          +{model.hiddenLabelCount}
                        </Typography>
                      ) : null}
                    </Stack>
                  ) : null}
                  {task.assignees.length > 0 ? <AssigneeAvatars assignees={task.assignees} /> : null}
                </Stack>
              ) : null}
```

(c) Fix the "assign to me" / "isAssignedToMe" logic that used `a.userId`. Replace line 70:

```typescript
  const isAssignedToMe = task.assignees.some((a) => a.userId === board.currentUserId)
```

with:

```typescript
  const isAssignedToMe = task.assignees.some((a) => a.participant.userId === board.currentUserId)
```

And replace the menu "Назначить на меня" handler (lines 252-263) which built `userIds` from `a.userId`:

```typescript
              {isAssignedToMe ? null : (
                <MenuItem
                  onClick={() => {
                    closeMenu()
                    setAssignees.mutate({
                      pageId,
                      id: task.id,
                      participantIds: task.assignees.map((a) => a.participantId),
                      userIdsToMirror: [board.currentUserId],
                    })
                  }}
                >
                  <ListItemText primary="Назначить на меня" />
                </MenuItem>
              )}
```

- [ ] **Step 3: Fix `table-view.tsx` assignee reads**

In `table-view.tsx`, the `assignTaskToMe` function (lines 165-184) reads `assignee.userId` and builds `userIds`. Replace it with:

```typescript
  function assignTaskToMe(taskId: string) {
    const task = board.tasks.find((candidate) => candidate.id === taskId)
    if (
      !task ||
      task.assignees.some((assignee) => assignee.participant.userId === board.currentUserId)
    ) {
      return
    }
    setAssignees.mutate({
      pageId,
      id: taskId,
      participantIds: task.assignees.map((a) => a.participantId),
      userIdsToMirror: [board.currentUserId],
    })
  }
```

(Remove the now-unused optimistic `patchTaskOptimistic` assignee block and `currentMember` lookup inside this function — the `onSuccess`/`onError` invalidation handles refresh. Keep `patchTaskOptimistic` itself; it's used by drag.)

- [ ] **Step 4: Fix `sprint-section.tsx` memberLookup + AssigneeAvatars usage**

In `sprint-section.tsx`, the `AssigneeAvatars` call (line 150) passes `memberLookup` and the old shape. Replace it with:

```typescript
      <AssigneeAvatars assignees={task.assignees} size={22} />
```

Remove the `memberLookup` prop from `TaskRowProps` (line 98) and the `memberLookup` argument threading (the `useCallback` at lines 366-372 and its usage at line 395). Also drop `memberLookup` from the `TaskRow` destructure (line 109) and its prop on the `<TaskRow>` element (line 395). The `AssigneeAvatars` now derives everything from `task.assignees[].participant`.

- [ ] **Step 5: Type-check the whole web app**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: exit 0 both. All assignee-shape errors resolved.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/kanban/views/board-card.tsx apps/web/src/components/kanban/views/table-view.tsx apps/web/src/components/kanban/views/sprint-section.tsx apps/web/src/components/kanban/filters/apply-filters.ts
git commit -m "feat(kanban): footer label tags + repoint assignee reads to participants"
```

---

### Task 13: Sprint-aware add from the board view

**Files:**
- Create: `apps/web/src/components/kanban/lib/resolve-add-sprint.ts`
- Modify: `apps/web/src/components/kanban/views/board-view.tsx`
- Modify: `apps/web/src/components/kanban/views/board-column.tsx`
- Test: `apps/web/test/kanban-resolve-add-sprint.test.ts`

- [ ] **Step 1: Write the failing test for the resolver**

Create `apps/web/test/kanban-resolve-add-sprint.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { resolveAddSprintId } from '@/components/kanban/lib/resolve-add-sprint'

const sprints = [
  { id: 's-active', status: 'ACTIVE' },
  { id: 's-plan', status: 'PLANNED' },
]

describe('resolveAddSprintId', () => {
  it('returns the chosen sprint id for a specific filter', () => {
    expect(resolveAddSprintId(['s-plan'], sprints)).toBe('s-plan')
  })
  it('returns the active sprint id for "current"', () => {
    expect(resolveAddSprintId('current', sprints)).toBe('s-active')
  })
  it('returns undefined for "all"', () => {
    expect(resolveAddSprintId('all', sprints)).toBeUndefined()
  })
  it('returns undefined for "current" when no active sprint', () => {
    expect(resolveAddSprintId('current', [{ id: 's-plan', status: 'PLANNED' }])).toBeUndefined()
  })
  it('returns undefined for a multi-select filter (ambiguous)', () => {
    expect(resolveAddSprintId(['s-plan', 's-active'], sprints)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web test -- kanban-resolve-add-sprint.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the resolver**

Create `apps/web/src/components/kanban/lib/resolve-add-sprint.ts`:

```typescript
import type { KanbanFilters } from '../filters/apply-filters'

export function resolveAddSprintId(
  sprintFilter: KanbanFilters['sprint'],
  sprints: ReadonlyArray<{ id: string; status: string }>,
): string | undefined {
  if (sprintFilter === 'all') return undefined
  if (sprintFilter === 'current') {
    return sprints.find((s) => s.status === 'ACTIVE')?.id ?? undefined
  }
  // array form: only unambiguous when exactly one sprint is selected
  if (Array.isArray(sprintFilter) && sprintFilter.length === 1) {
    const id = sprintFilter[0]!
    return sprints.some((s) => s.id === id) ? id : undefined
  }
  return undefined
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter web test -- kanban-resolve-add-sprint.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread the resolved sprint id from board-view → board-column → AddCardForm**

In `board-view.tsx`, the `BoardView` props need the active sprint filter. The simplest correct wiring: pass `addSprintId` down. Add to `BoardViewProps`:

```typescript
  readonly addSprintId?: string
```

Pass it to each `<BoardColumn>`:

```typescript
          <BoardColumn
            key={column.id}
            pageId={pageId}
            column={column}
            board={board}
            editable={editable}
            addSprintId={addSprintId}
          />
```

In `board-column.tsx`, add `addSprintId?: string` to `BoardColumnProps` and pass it to `<AddCardForm>`:

```typescript
      {editable ? <AddCardForm pageId={pageId} columnId={column.id} addSprintId={addSprintId} /> : null}
```

Add `addSprintId?: string` to `AddCardFormProps` and use it in `commit`:

```typescript
    const created = await createTask.mutateAsync({
      pageId,
      columnId,
      title: trimmed,
      ...(addSprintId ? { sprintId: addSprintId } : {}),
    })
```

- [ ] **Step 6: Compute and pass `addSprintId` in `kanban-board-page.tsx`**

In `kanban-board-page.tsx`, add the import:

```typescript
import { resolveAddSprintId } from './lib/resolve-add-sprint'
```

Before the `return`, compute:

```typescript
  const addSprintId = resolveAddSprintId(filtersBag.filters.sprint, board.sprints)
```

Pass it to `<BoardView>`:

```typescript
              <BoardView
                pageId={pageId}
                board={board}
                visibleTasks={visibleTasks}
                editable={editable}
                addSprintId={addSprintId}
              />
```

- [ ] **Step 7: Type-check + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/kanban/lib/resolve-add-sprint.ts apps/web/src/components/kanban/views/board-view.tsx apps/web/src/components/kanban/views/board-column.tsx apps/web/src/components/kanban/kanban-board-page.tsx apps/web/test/kanban-resolve-add-sprint.test.ts
git commit -m "feat(kanban): board add-card respects the sprint filter"
```

---

## Phase 5 — Bulk selection + multi-drag, settings tab, verification

### Task 14: Page-scoped selection context + bulk-action bar + multi-drag

**Files:**
- Create: `apps/web/src/components/kanban/selection/selection-context.tsx`
- Create: `apps/web/src/components/kanban/selection/bulk-action-bar.tsx`
- Modify: `apps/web/src/components/kanban/kanban-board-page.tsx`
- Modify: `apps/web/src/components/kanban/views/board-card.tsx`
- Modify: `apps/web/src/components/kanban/views/board-view.tsx`
- Modify: `apps/web/src/components/kanban/views/sprint-section.tsx`
- Modify: `apps/web/src/components/kanban/views/table-view.tsx`
- Test: `apps/web/test/kanban-selection.test.tsx`

- [ ] **Step 1: Write a failing test for the selection store reducer**

Create `apps/web/test/kanban-selection.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { selectionReducer } from '@/components/kanban/selection/selection-context'

describe('selectionReducer', () => {
  it('toggles a task id on and off', () => {
    const a = selectionReducer(new Set<string>(), { type: 'toggle', id: 't1' })
    expect(a.has('t1')).toBe(true)
    const b = selectionReducer(a, { type: 'toggle', id: 't1' })
    expect(b.has('t1')).toBe(false)
  })
  it('clears all', () => {
    const a = new Set(['t1', 't2'])
    expect(selectionReducer(a, { type: 'clear' }).size).toBe(0)
  })
  it('sets an explicit selection', () => {
    const a = selectionReducer(new Set(), { type: 'set', ids: ['t3', 't4'] })
    expect([...a].sort()).toEqual(['t3', 't4'])
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web test -- kanban-selection.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the selection context + reducer**

Create `apps/web/src/components/kanban/selection/selection-context.tsx`:

```typescript
'use client'

import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react'

export type SelectionAction =
  | { type: 'toggle'; id: string }
  | { type: 'set'; ids: string[] }
  | { type: 'clear' }

export function selectionReducer(state: Set<string>, action: SelectionAction): Set<string> {
  switch (action.type) {
    case 'toggle': {
      const next = new Set(state)
      if (next.has(action.id)) next.delete(action.id)
      else next.add(action.id)
      return next
    }
    case 'set':
      return new Set(action.ids)
    case 'clear':
      return state.size === 0 ? state : new Set()
  }
}

interface SelectionContextValue {
  readonly selected: Set<string>
  readonly toggle: (id: string) => void
  readonly setSelection: (ids: string[]) => void
  readonly clear: () => void
}

const SelectionContext = createContext<SelectionContextValue | null>(null)

export function SelectionProvider({ children }: { readonly children: ReactNode }) {
  const [selected, dispatch] = useReducer(selectionReducer, undefined, () => new Set<string>())
  const value = useMemo<SelectionContextValue>(
    () => ({
      selected,
      toggle: (id) => dispatch({ type: 'toggle', id }),
      setSelection: (ids) => dispatch({ type: 'set', ids }),
      clear: () => dispatch({ type: 'clear' }),
    }),
    [selected],
  )
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('useSelection must be used within SelectionProvider')
  return ctx
}
```

- [ ] **Step 4: Run the reducer test**

Run: `pnpm --filter web test -- kanban-selection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Build the bulk-action bar**

Create `apps/web/src/components/kanban/selection/bulk-action-bar.tsx`:

```typescript
'use client'

import { useState } from 'react'
import {
  Box,
  Button,
  CloseIcon,
  DeleteIcon,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { useSelection } from './selection-context'
import type { BoardData } from '../types'

interface BulkActionBarProps {
  readonly pageId: string
  readonly board: BoardData
}

export function BulkActionBar({ pageId, board }: BulkActionBarProps) {
  const { selected, clear } = useSelection()
  const utils = trpc.useUtils()
  const invalidate = () => utils.kanban.board.getBoard.invalidate({ pageId })
  const bulkDelete = trpc.kanban.task.bulkSoftDelete.useMutation({ onSuccess: invalidate })
  const updateTask = trpc.kanban.task.update.useMutation({ onSuccess: invalidate })
  const [busy, setBusy] = useState(false)

  if (selected.size === 0) return null
  const ids = [...selected]

  async function removeFromSprint() {
    setBusy(true)
    try {
      await Promise.all(
        ids
          .filter((id) => board.tasks.find((t) => t.id === id)?.sprintId)
          .map((id) => updateTask.mutateAsync({ pageId, id, sprintId: null, sprintPosition: null })),
      )
      clear()
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelected() {
    if (typeof globalThis.confirm === 'function' && !globalThis.confirm(`Удалить задачи (${ids.length})?`)) return
    setBusy(true)
    try {
      await bulkDelete.mutateAsync({ pageId, ids })
      clear()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper
      elevation={6}
      sx={{
        position: 'sticky', bottom: 0, zIndex: 5, mt: 1, py: 1, px: 2,
        borderRadius: 2, display: 'flex', alignItems: 'center',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={2} sx={{ width: '100%' }}>
        <Typography variant="body2" fontWeight={600}>
          {ids.length} выбрано
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={removeFromSprint} disabled={busy}>
          Удалить из спринта
        </Button>
        <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={deleteSelected} disabled={busy}>
          Удалить
        </Button>
        <IconButton size="small" onClick={clear} aria-label="Снять выделение">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Paper>
  )
}
```

- [ ] **Step 6: Wrap the board page in the provider and render the bar**

In `kanban-board-page.tsx`, add imports:

```typescript
import { SelectionProvider } from './selection/selection-context'
import { BulkActionBar } from './selection/bulk-action-bar'
```

Wrap the returned `<Stack>` body. Change the outer return so the content area and a `<BulkActionBar>` are inside a `<SelectionProvider>`. Specifically, wrap from the toolbar down:

```typescript
  return (
    <SelectionProvider>
      <Stack sx={{ height: '100%', minHeight: 0, overflow: 'hidden', bgcolor: 'background.paper' }}>
        <KanbanToolbar pageId={pageId} filtersBag={filtersBag} board={board} editable={editable} />
        <Box sx={{ flex: 1, overflow: 'auto', p: 2, bgcolor: 'background.paper' }}>
          {/* …existing view switch unchanged… */}
          {editable ? <BulkActionBar pageId={pageId} board={board} /> : null}
        </Box>
        <TaskDetailContainer pageId={pageId} board={board} editable={editable} canComment={canComment} />
      </Stack>
    </SelectionProvider>
  )
```

(Place `<BulkActionBar>` right after the closing of the `{!isTaskDetailOpen && (…)}` block, still inside the scrollable `<Box>`.)

- [ ] **Step 7: Add a selection checkbox to board cards**

In `board-card.tsx`, add the import:

```typescript
import { Checkbox } from '@repo/ui/components'
import { useSelection } from '../selection/selection-context'
```

Inside `BoardCard`, read selection:

```typescript
  const { selected, toggle } = useSelection()
  const isSelected = selected.has(task.id)
```

Add a checkbox in the card. Place it at the very top-left of the card content row — insert before the draggable content `<Box>` (the one with `{...provided.dragHandleProps}`). Wrap so clicking the checkbox doesn't open the detail:

```typescript
            {editable ? (
              <Checkbox
                size="small"
                checked={isSelected}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggle(task.id)}
                sx={{ mt: 0.5, ml: 0.5, p: 0.5, opacity: isSelected ? 1 : 0.5, '&:hover': { opacity: 1 } }}
              />
            ) : null}
```

Also give the card a selected outline: add to the `<Card>` `sx` a conditional `outline`:

```typescript
            outline: isSelected ? '2px solid' : 'none',
            outlineColor: 'primary.main',
```

- [ ] **Step 8: Implement multi-drag in `board-view.tsx`**

In `board-view.tsx`, import selection:

```typescript
import { useSelection } from '../selection/selection-context'
```

Inside `BoardView`, read it:

```typescript
  const { selected, clear } = useSelection()
```

Replace `handleDragEnd` so that if the dragged task is in the selection (and selection size > 1), all selected tasks move to the destination column contiguously at the drop point:

```typescript
  async function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    const sourceColId = result.source.droppableId
    const destColId = result.destination.droppableId
    const taskId = result.draggableId
    if (sourceColId === destColId && result.source.index === result.destination.index) return

    const destCol = columnsWithTasks.find((c) => c.id === destColId)
    if (!destCol) return

    const isMulti = selected.has(taskId) && selected.size > 1
    const movingIds = isMulti
      ? board.tasks.filter((t) => selected.has(t.id)).map((t) => t.id)
      : [taskId]

    const destTasksWithoutMoved = destCol.tasks.filter((t) => !movingIds.includes(t.id))
    const before = destTasksWithoutMoved[result.destination.index - 1] ?? null
    const after = destTasksWithoutMoved[result.destination.index] ?? null

    const setData = utils.kanban.board.getBoard.setData as (
      input: { pageId: string },
      updater: (prev: BoardData | undefined) => BoardData | undefined,
    ) => void

    // Compute contiguous positions for all moving tasks between before/after.
    let prevPos = before?.position ?? null
    const nextPos = after?.position ?? null
    const placements = movingIds.map((id) => {
      const pos = positionBetween(prevPos, nextPos)
      prevPos = pos
      return { id, pos }
    })

    setData({ pageId }, (prev) => {
      if (!prev) return prev
      const byId = new Map(placements.map((p) => [p.id, p.pos]))
      return {
        ...prev,
        tasks: prev.tasks.map((t) =>
          byId.has(t.id) ? { ...t, columnId: destColId, position: byId.get(t.id)! } : t,
        ),
      }
    })

    // Persist sequentially to keep before/after anchors valid.
    let anchorBeforeId = before?.id ?? null
    for (const placement of placements) {
      await moveTask.mutateAsync({
        pageId,
        id: placement.id,
        targetColumnId: destColId,
        beforeId: anchorBeforeId,
        afterId: after?.id ?? null,
      })
      anchorBeforeId = placement.id
    }

    if (isMulti) clear()
  }
```

- [ ] **Step 9: Add a count badge to the drag preview**

In `board-card.tsx`, the `<Draggable>` render already has `snapshot`. When dragging a card that is part of a multi-selection, overlay a small count badge. Inside the `<Card>`, after the content `<Stack>`, add:

```typescript
          {snapshot.isDragging && isSelected && selected.size > 1 ? (
            <Box
              sx={{
                position: 'absolute', top: -8, right: -8, minWidth: 22, height: 22,
                px: 0.75, borderRadius: 11, bgcolor: 'primary.main', color: 'primary.contrastText',
                fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ×{selected.size}
            </Box>
          ) : null}
```

- [ ] **Step 10: Add selection checkboxes to table/sprint rows**

In `sprint-section.tsx`, in `TaskRow`, read selection and render a checkbox before the title:

```typescript
import { Checkbox } from '@repo/ui/components'
import { useSelection } from '../selection/selection-context'
```

Inside `TaskRow`:

```typescript
  const { selected, toggle } = useSelection()
```

Before the `<Typography>` title (line 140), add:

```typescript
      <Checkbox
        size="small"
        checked={selected.has(task.id)}
        onClick={(e) => e.stopPropagation()}
        onChange={() => toggle(task.id)}
        sx={{ p: 0.5 }}
      />
```

- [ ] **Step 11: Implement multi-drag in `table-view.tsx`**

In `table-view.tsx`, import selection and read it inside `TableView`:

```typescript
import { useSelection } from '../selection/selection-context'
```

```typescript
  const { selected, clear } = useSelection()
```

Replace the existing `handleDragEnd` (lines 131-158) with a selection-aware version that moves all selected tasks to the target sprint/backlog contiguously:

```typescript
  async function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    const sourceId = result.source.droppableId
    const destId = result.destination.droppableId
    const draggedId = result.draggableId
    if (sourceId === destId && result.source.index === result.destination.index) return

    const targetSprintId = sectionKey(destId)
    const destList = grouped.get(targetSprintId) ?? []

    const isMulti = selected.has(draggedId) && selected.size > 1
    const movingIds = isMulti
      ? board.tasks.filter((t) => selected.has(t.id)).map((t) => t.id)
      : [draggedId]

    const filtered = destList.filter((t) => !movingIds.includes(t.id))
    const before = filtered[result.destination.index - 1] ?? null
    const after = filtered[result.destination.index] ?? null

    let prevPos = before ? tasksSortKey(before) : null
    const nextPos = after ? tasksSortKey(after) : null
    const placements = movingIds.map((id) => {
      const pos = positionBetween(prevPos, nextPos)
      prevPos = pos
      return { id, pos }
    })

    for (const placement of placements) {
      patchTaskOptimistic(placement.id, {
        sprintId: targetSprintId,
        sprintPosition: placement.pos,
      })
    }

    for (const placement of placements) {
      await updateTask.mutateAsync({
        pageId,
        id: placement.id,
        sprintId: targetSprintId,
        sprintPosition: placement.pos,
      })
    }

    if (isMulti) clear()
  }
```

(`positionBetween`, `tasksSortKey`, `sectionKey`, `grouped`, and `patchTaskOptimistic` already exist in this file.)

- [ ] **Step 12: Type-check + lint + run all web unit tests**

Run: `pnpm --filter web check-types && pnpm --filter web lint && pnpm --filter web test`
Expected: exit 0 / all pass.

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/components/kanban/selection apps/web/src/components/kanban/kanban-board-page.tsx apps/web/src/components/kanban/views/board-card.tsx apps/web/src/components/kanban/views/board-view.tsx apps/web/src/components/kanban/views/sprint-section.tsx apps/web/src/components/kanban/views/table-view.tsx apps/web/test/kanban-selection.test.tsx
git commit -m "feat(kanban): bulk task selection, bulk-action bar, multi-drag"
```

---

### Task 15: "Участники" settings tab

**Files:**
- Create: `apps/web/src/components/kanban/settings/participants-tab.tsx`
- Modify: `apps/web/src/components/kanban/settings/kanban-settings-dialog.tsx`

- [ ] **Step 1: Build the participants tab component**

Create `apps/web/src/components/kanban/settings/participants-tab.tsx`:

```typescript
'use client'

import { useState } from 'react'
import {
  Avatar,
  Box,
  Button,
  DeleteIcon,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { BoardData } from '../types'
import { participantInitials, participantName } from '../components/participant-display'

interface ParticipantsTabProps {
  readonly pageId: string
  readonly board: BoardData
}

export function ParticipantsTab({ pageId, board }: ParticipantsTabProps) {
  const utils = trpc.useUtils()
  const invalidate = () => utils.kanban.board.getBoard.invalidate({ pageId })
  const create = trpc.kanban.participant.create.useMutation({ onSuccess: invalidate })
  const update = trpc.kanban.participant.update.useMutation({ onSuccess: invalidate })
  const remove = trpc.kanban.participant.delete.useMutation({ onSuccess: invalidate })

  const [fullName, setFullName] = useState('')
  const [company, setCompany] = useState('')

  const guests = board.participants.filter((p) => !p.userId)

  function addGuest() {
    const name = fullName.trim().slice(0, 64)
    if (!name) return
    create.mutate({ workspaceId: board.workspaceId, fullName: name, company: company.trim().slice(0, 64) || undefined })
    setFullName('')
    setCompany('')
  }

  function deleteGuest(id: string) {
    const assignedCount = board.tasks.filter((t) => t.assignees.some((a) => a.participantId === id)).length
    const msg = assignedCount > 0
      ? `Этот участник назначен на ${assignedCount} задач(и). Удалить и снять назначения?`
      : 'Удалить участника?'
    if (typeof globalThis.confirm === 'function' && !globalThis.confirm(msg)) return
    remove.mutate({ workspaceId: board.workspaceId, id })
  }

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          Участники пространства
        </Typography>
        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
          {board.members.map((m) => (
            <Stack key={m.user.id} direction="row" alignItems="center" spacing={1}>
              <Avatar src={m.user.image ?? undefined} sx={{ width: 28, height: 28, fontSize: 12 }}>
                {participantInitials({ fullName: `${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() || m.user.email, company: null, user: m.user })}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {`${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() || m.user.email}
                </Typography>
              </Box>
              <Box component="span" sx={{ fontSize: 10, color: 'primary.main', border: 1, borderColor: 'primary.light', borderRadius: 0.5, px: 0.5 }}>
                в пространстве
              </Box>
            </Stack>
          ))}
        </Stack>
      </Box>

      <Divider />

      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          Внешние участники
        </Typography>
        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
          {guests.map((p) => (
            <GuestRow
              key={p.id}
              name={p.fullName}
              company={p.company}
              initials={participantInitials(p)}
              onSave={(name, comp) => update.mutate({ workspaceId: board.workspaceId, id: p.id, fullName: name, company: comp || null })}
              onDelete={() => deleteGuest(p.id)}
            />
          ))}
          {guests.length === 0 ? (
            <Typography variant="body2" color="text.secondary">Нет внешних участников</Typography>
          ) : null}
        </Stack>
      </Box>

      <Divider />

      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField size="small" label="ФИО" value={fullName} onChange={(e) => setFullName(e.target.value)} inputProps={{ maxLength: 64 }} />
        <TextField size="small" label="Компания" value={company} onChange={(e) => setCompany(e.target.value)} inputProps={{ maxLength: 64 }} />
        <Button variant="contained" onClick={addGuest} disabled={create.isPending}>Добавить</Button>
      </Stack>
    </Stack>
  )
}

interface GuestRowProps {
  readonly name: string
  readonly company: string | null
  readonly initials: string
  readonly onSave: (name: string, company: string) => void
  readonly onDelete: () => void
}

function GuestRow({ name, company, initials, onSave, onDelete }: GuestRowProps) {
  const [editName, setEditName] = useState(name)
  const [editCompany, setEditCompany] = useState(company ?? '')

  function commit() {
    const trimmed = editName.trim().slice(0, 64)
    if (!trimmed || (trimmed === name && editCompany.trim() === (company ?? ''))) return
    onSave(trimmed, editCompany.trim().slice(0, 64))
  }

  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <Avatar sx={{ width: 28, height: 28, fontSize: 12 }}>{initials}</Avatar>
      <TextField size="small" value={editName} onChange={(e) => setEditName(e.target.value)} onBlur={commit} inputProps={{ maxLength: 64 }} sx={{ flex: 1 }} />
      <TextField size="small" value={editCompany} onChange={(e) => setEditCompany(e.target.value)} onBlur={commit} inputProps={{ maxLength: 64 }} placeholder="Компания" sx={{ flex: 1 }} />
      <IconButton size="small" color="error" onClick={onDelete} aria-label="Удалить участника">
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Stack>
  )
}
```

- [ ] **Step 2: Add the tab to the settings dialog**

In `kanban-settings-dialog.tsx`, add the import:

```typescript
import { ParticipantsTab } from './participants-tab'
```

Extend the `TabKey` type and `TABS` array:

```typescript
type TabKey = 'types' | 'priorities' | 'labels' | 'statuses' | 'participants'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'types', label: 'Типы' },
  { key: 'priorities', label: 'Приоритеты' },
  { key: 'labels', label: 'Метки' },
  { key: 'statuses', label: 'Статусы' },
  { key: 'participants', label: 'Участники' },
]
```

Add the panel after the `statuses` block (before the closing `</DialogContent>`):

```typescript
        {tab === 'participants' ? <ParticipantsTab pageId={pageId} board={board} /> : null}
```

- [ ] **Step 3: Type-check + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/kanban/settings/participants-tab.tsx apps/web/src/components/kanban/settings/kanban-settings-dialog.tsx
git commit -m "feat(kanban): Участники settings tab (members + guest CRUD)"
```

---

### Task 16: Full gates + manual browser verification

**Files:** none (verification only)

- [ ] **Step 1: Run the merge gate**

Run: `pnpm gates`
Expected: `check-types`, `lint`, `build`, `test` all pass across the workspace. Fix any failures before proceeding (re-run the specific package's command to iterate).

- [ ] **Step 2: Start infra + dev server for manual verification**

```bash
docker compose up -d
pnpm --filter web dev
```

- [ ] **Step 3: Manually verify each feature in the browser**

Open a Kanban page and confirm:
1. **Participants**: open a task → Участники chip → picker shows members first (с «в пространстве»), then guests. Search filters. Type a new name → Создать гостя → fill ФИО/Компания → guest is created, assigned, and appears as a chip.
2. **Avatars**: assignees on cards, in the picker, and in the side panel show the user's avatar image when set, initials otherwise.
3. **Settings → Участники**: members listed read-only; add a guest; edit a guest's ФИО/Компания (blur saves); delete a guest (confirm dialog; assigned guests warn).
4. **Sprint-aware add**: set the sprint filter to "Текущий" (with an ACTIVE sprint), add a card on the board → it lands in the active sprint (verify in table view). Set filter to a specific sprint → new card lands there. Set "Все" → backlog.
5. **Labels**: cards show labels as solid color tags in the footer, left of avatars (not at the top).
6. **Status select**: open a task → header shows a Select of columns with the current one selected → change it → the task moves to that column (verify on the board).
7. **Bulk actions**: check 2+ cards → bulk bar appears → "Удалить из спринта" clears their sprint; "Удалить" removes them (confirm). Drag one selected card to another column → all selected move together with an "×N" badge; selection clears.

- [ ] **Step 4: Restore any test data you mutated**

If you created throwaway tasks/guests during verification, delete them so the page is left clean.

- [ ] **Step 5: Final commit (only if verification required fixes)**

If manual verification surfaced fixes, commit them with an appropriate `fix(kanban): …` message. Otherwise nothing to commit.

---

## Notes for the implementer

- **Assignee shape changed everywhere.** The single most error-prone part is that `task.assignees[]` went from `{ userId, user }` to `{ participantId, participant: { userId, user, fullName, company } }`. Every read of `a.userId` or `a.user.id` must become `a.participant.userId` (for the linked user) or `a.participantId` (for the assignment key). Tasks 12 covers the known sites: `board-card.tsx`, `table-view.tsx`, `sprint-section.tsx`, `apply-filters.ts`. If `pnpm --filter web check-types` flags another site, fix it the same way.
- **`setData` TS2589**: always cast `getBoard.setData` to the explicit function type before calling (pattern already in `board-view.tsx` / `table-view.tsx`).
- **DnD is not unit-testable here** (`@hello-pangea/dnd`); rely on the pure helpers (resolver, selection reducer, picker model, display helpers) for unit coverage and the Task 16 browser pass for the interactive paths.
- **Migration is destructive to the `user_id` column.** Run it against a dev DB first and confirm the integrity check (Task 2 / Task 5) before letting it near anything important.
