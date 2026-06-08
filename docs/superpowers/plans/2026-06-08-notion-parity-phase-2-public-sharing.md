# Notion-parity Phase 2 — Public Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring AnyNote public sharing to Notion's Share-vs-Publish model: public links with expiry, published public sites with subpages/indexing/analytics, and copy-to-workspace — with a single `PublicShareAccessResolver` authority that never leaks private/personal/archived/deleted pages.

**Architecture:** Extend `PageShare` with a `mode` enum + site/extension fields (one migration). Add two `@repo/domain` modules — `share-access` (the `PublicShareAccessResolver`) and `share-copy` (the `PublicShareCopyService`) — following the established dto/repository/service + inversify pattern. Extend the `page.share` tRPC router with link/site settings, publish/unpublish, password, and `copyToWorkspace` procedures. Refactor the share dialog into Share/Publish tabs, add per-page `generateMetadata`, a nested public subpage route, and a copy dialog.

**Tech Stack:** Prisma 7, tRPC v11, Zod, inversify 8 (decorator-free), Next.js 16 App Router, MUI v6, Vitest, Playwright. Hashing via `@repo/auth`.

**Spec:** `docs/superpowers/specs/2026-06-08-notion-parity-phase-2-public-sharing-design.md`

---

## File Structure

**Created:**
- `packages/domain/src/share-access/` — `share-access.module.ts`, `share-access.tokens.ts`, `index.ts`, `dto/share-access.dto.ts`, `repositories/share-access.repository.ts`, `services/share-access.service.ts` (the `PublicShareAccessResolver`).
- `packages/domain/src/share-copy/` — same module shape; `services/share-copy.service.ts` (the `PublicShareCopyService`).
- `apps/web/src/app/(share)/s/[shareId]/[childPageId]/page.tsx` — nested subpage route.
- `apps/web/src/components/page/publish-tab.tsx` — Publish tab body.
- `apps/web/src/components/page/share-status-chips.tsx` — status chip row.
- `apps/web/src/components/share/public-share-tree-nav.tsx` — site navigation tree.
- `apps/web/src/components/share/copy-to-workspace-dialog.tsx` — copy dialog + button.
- `apps/web/src/components/share/share-unavailable.tsx` — unavailable-state + password-gate screens.
- `apps/web/src/components/workspace/settings/public-pages-section.tsx` — Manage public pages.
- `packages/trpc/test/public-share.test.ts`, `packages/trpc/test/share-copy.test.ts`.
- `packages/domain/test/share-access/services/share-access.service.test.ts`.
- `apps/e2e/public-site.spec.ts`.

**Modified:**
- `packages/db/prisma/schema.prisma` — `PageShareMode` enum + `PageShare`/`Page` fields.
- `packages/db/prisma/migrations/<ts>_public_sharing/migration.sql` — generated.
- `packages/domain/src/container.ts`, `packages/domain/src/index.ts` — wire new modules.
- `packages/domain/src/billing/dto/billing.dto.ts`, `.../billing/repositories/billing.repository.ts` — `publicSitesEnabled` flag.
- `packages/trpc/src/routers/page-share.ts` — new procedures.
- `apps/web/src/lib/share-access.ts` — delegate to the domain resolver.
- `apps/web/src/components/page/share-dialog.tsx` — two-tab refactor.
- `apps/web/src/app/(share)/s/[shareId]/page.tsx` + `share-page-client.tsx` — resolver, `generateMetadata`, unavailable states, copy button, tree nav.
- `apps/web/src/app/(share)/layout.tsx` — remove hardcoded `NOINDEX_METADATA` export.
- `apps/web/src/app/api/yjs/share-token/route.ts` — call the domain resolver.
- `apps/e2e/page-sharing.spec.ts` — link expiry + publish flows.

---

## Phase A — Schema + resolver foundation (Prompt 2.1)

### Task A1: PageShare schema extensions + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_public_sharing/migration.sql` (generated)

- [ ] **Step 1: Add the enum and fields to schema.prisma**

Add near the other share enums (after `PageShareRole`):

```prisma
enum PageShareMode {
  LINK
  SITE
}
```

In `model PageShare`, after `linkRole`, add:

```prisma
  mode                     PageShareMode @default(LINK)
  expiresAt                DateTime?     @map("expires_at") @db.Timestamptz(6)
  // Public-site (Publish tab) fields — meaningful when mode = SITE.
  publishedAt              DateTime?     @map("published_at") @db.Timestamptz(6)
  unpublishedAt            DateTime?     @map("unpublished_at") @db.Timestamptz(6)
  allowIndexing            Boolean       @default(false) @map("allow_indexing")
  allowCopy                Boolean       @default(false) @map("allow_copy")
  publishSubpages          Boolean       @default(true) @map("publish_subpages")
  analyticsGoogleId        String?       @map("analytics_google_id") @db.Text
  analyticsYandexMetricaId String?       @map("analytics_yandex_metrica_id") @db.Text
  // AnyNote extensions (NOT Notion parity): password gate + scheduled publish.
  passwordHash             String?       @map("password_hash") @db.Text
  exposesAt                DateTime?     @map("exposes_at") @db.Timestamptz(6)
```

In `model Page`, after `templateMeta`, add:

```prisma
  copiedFromShareId String?   @map("copied_from_share_id") @db.Text
  copiedFromPageId  String?   @map("copied_from_page_id") @db.Uuid
  copiedAt          DateTime? @map("copied_at") @db.Timestamptz(6)
```

- [ ] **Step 2: Validate schema**

Run: `pnpm --filter @repo/db exec prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 3: Generate the migration against a fresh scratch DB (never the shared dev DB)**

```bash
docker exec anynote-postgres-1 psql -U user -d anynote -c "DROP DATABASE IF EXISTS anynote_p2_scratch;"
docker exec anynote-postgres-1 psql -U user -d anynote -c "CREATE DATABASE anynote_p2_scratch;"
cd packages/db
# baseline the scratch DB with existing migrations, then diff to create the new one
DATABASE_URL="postgresql://user:password@localhost:5432/anynote_p2_scratch" pnpm exec prisma migrate deploy
DATABASE_URL="postgresql://user:password@localhost:5432/anynote_p2_scratch" pnpm exec prisma migrate diff \
  --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma \
  --script > /tmp/p2.sql
cat /tmp/p2.sql
```

Create `packages/db/prisma/migrations/20260608120000_public_sharing/migration.sql` with the contents of `/tmp/p2.sql` (review it: should be ALTER TABLE adds + CREATE TYPE PageShareMode, no drops).

- [ ] **Step 4: Verify the full sequence applies clean on a fresh DB with zero drift**

```bash
docker exec anynote-postgres-1 psql -U user -d anynote -c "DROP DATABASE IF EXISTS anynote_p2_scratch;"
docker exec anynote-postgres-1 psql -U user -d anynote -c "CREATE DATABASE anynote_p2_scratch;"
cd packages/db
DATABASE_URL="postgresql://user:password@localhost:5432/anynote_p2_scratch" pnpm exec prisma migrate deploy
DATABASE_URL="postgresql://user:password@localhost:5432/anynote_p2_scratch" pnpm exec prisma migrate diff \
  --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --exit-code
docker exec anynote-postgres-1 psql -U user -d anynote -c "DROP DATABASE IF EXISTS anynote_p2_scratch;"
```
Expected: "All migrations have been successfully applied." then "No difference detected."

- [ ] **Step 5: Regenerate client + commit**

```bash
pnpm --filter @repo/db exec prisma generate
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): PageShare public-site/link fields + Page copy provenance"
```

### Task A2: share-access DTO + repository

**Files:**
- Create: `packages/domain/src/share-access/dto/share-access.dto.ts`
- Create: `packages/domain/src/share-access/repositories/share-access.repository.ts`
- Create: `packages/domain/src/share-access/share-access.tokens.ts`

- [ ] **Step 1: Write the DTO**

`packages/domain/src/share-access/dto/share-access.dto.ts`:

```ts
export type PublicAccessRole = 'READER' | 'COMMENTER' | 'EDITOR'

export type PublicUnavailableReason =
  | 'not_found'
  | 'disabled'
  | 'unpublished'
  | 'expired'
  | 'not_yet_exposed'
  | 'password_required'
  | 'restricted_child'

export type ResolvedPublicPage = {
  id: string
  type: string
  title: string | null
  icon: string | null
  workspaceId: string
}

export type ResolvedShareMeta = {
  shareId: string
  mode: 'LINK' | 'SITE'
  allowCopy: boolean
  allowIndexing: boolean
  publishSubpages: boolean
  analyticsGoogleId: string | null
  analyticsYandexMetricaId: string | null
}

export type PublicShareResult =
  | { status: 'ok'; role: PublicAccessRole; page: ResolvedPublicPage; share: ResolvedShareMeta }
  | { status: 'unavailable'; reason: PublicUnavailableReason }

export type ResolvePublicShareInput = {
  shareId: string
  requestedPageId?: string
  password?: string
  now: Date
}
```

- [ ] **Step 2: Write the tokens file**

`packages/domain/src/share-access/share-access.tokens.ts`:

```ts
export const SHARE_ACCESS = {
  Repository: Symbol.for('ShareAccessRepository'),
  Service: Symbol.for('ShareAccessService'),
} as const
```

- [ ] **Step 3: Write the repository (data access only, no decisions)**

`packages/domain/src/share-access/repositories/share-access.repository.ts`:

```ts
import type { PrismaClient } from '@repo/db'

export type ShareRow = {
  shareId: string
  access: string
  linkRole: string
  mode: string
  expiresAt: Date | null
  publishedAt: Date | null
  unpublishedAt: Date | null
  allowIndexing: boolean
  allowCopy: boolean
  publishSubpages: boolean
  analyticsGoogleId: string | null
  analyticsYandexMetricaId: string | null
  passwordHash: string | null
  exposesAt: Date | null
  page: {
    id: string
    type: string
    title: string | null
    icon: string | null
    workspaceId: string
    parentId: string | null
    collectionId: string | null
    archivedAt: Date | null
    deletedAt: Date | null
  }
}

export class ShareAccessRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findShareByShareId(shareId: string): Promise<ShareRow | null> {
    return this.prisma.pageShare.findUnique({
      where: { shareId },
      select: {
        shareId: true, access: true, linkRole: true, mode: true, expiresAt: true,
        publishedAt: true, unpublishedAt: true, allowIndexing: true, allowCopy: true,
        publishSubpages: true, analyticsGoogleId: true, analyticsYandexMetricaId: true,
        passwordHash: true, exposesAt: true,
        page: {
          select: {
            id: true, type: true, title: true, icon: true, workspaceId: true,
            parentId: true, collectionId: true, archivedAt: true, deletedAt: true,
          },
        },
      },
    }) as Promise<ShareRow | null>
  }

  // Walks parentId from childId up toward rootId; returns the path of pages
  // (child-first) or null if rootId is never reached or a cycle is detected.
  async findPathToRoot(childId: string, rootId: string): Promise<
    Array<{ id: string; parentId: string | null; collectionId: string | null; archivedAt: Date | null; deletedAt: Date | null; collectionKind: string | null; collectionOwnerId: string | null }>
  | null> {
    const path: Array<{ id: string; parentId: string | null; collectionId: string | null; archivedAt: Date | null; deletedAt: Date | null; collectionKind: string | null; collectionOwnerId: string | null }> = []
    const seen = new Set<string>()
    let current: string | null = childId
    while (current) {
      if (seen.has(current)) return null
      seen.add(current)
      const row = await this.prisma.page.findUnique({
        where: { id: current },
        select: {
          id: true, parentId: true, collectionId: true, archivedAt: true, deletedAt: true,
          collection: { select: { kind: true, ownerId: true } },
        },
      })
      if (!row) return null
      path.push({
        id: row.id, parentId: row.parentId, collectionId: row.collectionId,
        archivedAt: row.archivedAt, deletedAt: row.deletedAt,
        collectionKind: row.collection?.kind ?? null, collectionOwnerId: row.collection?.ownerId ?? null,
      })
      if (row.id === rootId) return path
      current = row.parentId
    }
    return null
  }
}
```

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @repo/domain check-types`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/share-access/
git commit -m "feat(domain): share-access dto + repository (read layer)"
```

### Task A3: PublicShareAccessResolver service — LINK mode + expiry + disabled

**Files:**
- Create: `packages/domain/src/share-access/services/share-access.service.ts`
- Test: `packages/domain/test/share-access/services/share-access.service.test.ts`

- [ ] **Step 1: Write failing tests for LINK mode, expiry, archived/deleted**

`packages/domain/test/share-access/services/share-access.service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ShareAccessService } from '../../../src/share-access/services/share-access.service.ts'
import type { ShareRow } from '../../../src/share-access/repositories/share-access.repository.ts'

const NOW = new Date('2026-06-08T12:00:00Z')

function makeShare(over: Partial<ShareRow> = {}): ShareRow {
  return {
    shareId: 's1', access: 'PUBLIC', linkRole: 'READER', mode: 'LINK',
    expiresAt: null, publishedAt: null, unpublishedAt: null, allowIndexing: false,
    allowCopy: false, publishSubpages: true, analyticsGoogleId: null,
    analyticsYandexMetricaId: null, passwordHash: null, exposesAt: null,
    page: { id: 'p1', type: 'TEXT', title: 'T', icon: null, workspaceId: 'w1',
            parentId: null, collectionId: 'c1', archivedAt: null, deletedAt: null },
    ...over,
  }
}

function makeService(share: ShareRow | null) {
  const repo = {
    findShareByShareId: async () => share,
    findPathToRoot: async () => null,
  }
  return new ShareAccessService(repo as never)
}

describe('ShareAccessService (LINK mode)', () => {
  it('returns ok with linkRole when public link is enabled', async () => {
    const r = await makeService(makeShare()).resolve({ shareId: 's1', now: NOW })
    expect(r).toMatchObject({ status: 'ok', role: 'READER' })
  })

  it('denies not_found when no share row', async () => {
    const r = await makeService(null).resolve({ shareId: 'x', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'not_found' })
  })

  it('denies disabled when access is RESTRICTED', async () => {
    const r = await makeService(makeShare({ access: 'RESTRICTED' })).resolve({ shareId: 's1', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'disabled' })
  })

  it('denies expired after expiresAt', async () => {
    const r = await makeService(makeShare({ expiresAt: new Date('2026-06-07T00:00:00Z') }))
      .resolve({ shareId: 's1', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'expired' })
  })

  it('stays available before expiresAt', async () => {
    const r = await makeService(makeShare({ expiresAt: new Date('2026-06-09T00:00:00Z') }))
      .resolve({ shareId: 's1', now: NOW })
    expect(r).toMatchObject({ status: 'ok' })
  })

  it('denies disabled when page is archived', async () => {
    const s = makeShare(); s.page.archivedAt = NOW
    const r = await makeService(s).resolve({ shareId: 's1', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'disabled' })
  })

  it('denies disabled when page is deleted', async () => {
    const s = makeShare(); s.page.deletedAt = NOW
    const r = await makeService(s).resolve({ shareId: 's1', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'disabled' })
  })

  it('denies restricted_child when a child page is requested in LINK mode', async () => {
    const r = await makeService(makeShare()).resolve({ shareId: 's1', requestedPageId: 'p2', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'restricted_child' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @repo/domain test share-access`
Expected: FAIL ("Cannot find module .../share-access.service.ts")

- [ ] **Step 3: Implement the service (LINK + common checks)**

`packages/domain/src/share-access/services/share-access.service.ts`:

```ts
import type { ShareAccessRepository, ShareRow } from '../repositories/share-access.repository.ts'
import type {
  PublicShareResult, ResolvePublicShareInput, PublicAccessRole,
} from '../dto/share-access.dto.ts'

export class ShareAccessService {
  constructor(private readonly repo: ShareAccessRepository) {}

  async resolve(input: ResolvePublicShareInput): Promise<PublicShareResult> {
    const share = await this.repo.findShareByShareId(input.shareId)
    if (!share) return { status: 'unavailable', reason: 'not_found' }

    // Root page must not be archived/deleted (closes the legacy leak).
    if (share.page.archivedAt || share.page.deletedAt)
      return { status: 'unavailable', reason: 'disabled' }

    if (share.expiresAt && share.expiresAt.getTime() <= input.now.getTime())
      return { status: 'unavailable', reason: 'expired' }

    const denial =
      share.mode === 'SITE' ? this.checkSite(share, input) : this.checkLink(share)
    if (denial) return denial

    // Child access only valid in SITE mode (checked in checkChild below).
    if (input.requestedPageId && input.requestedPageId !== share.page.id) {
      if (share.mode !== 'SITE')
        return { status: 'unavailable', reason: 'restricted_child' }
      const child = await this.checkChild(share, input.requestedPageId)
      if (child) return child
    }

    const role = (share.mode === 'SITE' ? 'READER' : share.linkRole) as PublicAccessRole
    return {
      status: 'ok',
      role,
      page: {
        id: share.page.id, type: share.page.type, title: share.page.title,
        icon: share.page.icon, workspaceId: share.page.workspaceId,
      },
      share: {
        shareId: share.shareId, mode: share.mode as 'LINK' | 'SITE',
        allowCopy: share.allowCopy, allowIndexing: share.allowIndexing,
        publishSubpages: share.publishSubpages,
        analyticsGoogleId: share.analyticsGoogleId,
        analyticsYandexMetricaId: share.analyticsYandexMetricaId,
      },
    }
  }

  private checkLink(share: ShareRow): PublicShareResult | null {
    if (share.access !== 'PUBLIC') return { status: 'unavailable', reason: 'disabled' }
    return null
  }

  // checkSite + checkChild implemented in Task A4 (return null for now).
  protected checkSite(_share: ShareRow, _input: ResolvePublicShareInput): PublicShareResult | null {
    return { status: 'unavailable', reason: 'unpublished' }
  }
  protected async checkChild(_share: ShareRow, _childId: string): Promise<PublicShareResult | null> {
    return { status: 'unavailable', reason: 'restricted_child' }
  }
}
```

- [ ] **Step 4: Run to verify LINK tests pass**

Run: `pnpm --filter @repo/domain test share-access`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/share-access/services packages/domain/test/share-access
git commit -m "feat(domain): PublicShareAccessResolver — link mode, expiry, archived/deleted guard"
```

### Task A4: Resolver SITE mode + password + scheduled + subtree child access

**Files:**
- Modify: `packages/domain/src/share-access/services/share-access.service.ts`
- Modify: `packages/domain/test/share-access/services/share-access.service.test.ts`

- [ ] **Step 1: Add failing tests for SITE/password/exposesAt/child**

Append to the test file:

```ts
import { hashSharePassword } from '../../../src/share-access/services/share-access.service.ts'

describe('ShareAccessService (SITE mode)', () => {
  const siteBase = () => makeShare({ mode: 'SITE', publishedAt: new Date('2026-06-01T00:00:00Z') })

  it('ok when published', async () => {
    const r = await makeService(siteBase()).resolve({ shareId: 's1', now: NOW })
    expect(r).toMatchObject({ status: 'ok', role: 'READER' })
  })

  it('denies unpublished when no publishedAt', async () => {
    const r = await makeService(makeShare({ mode: 'SITE' })).resolve({ shareId: 's1', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'unpublished' })
  })

  it('denies unpublished when unpublishedAt is after publishedAt', async () => {
    const s = siteBase(); s.unpublishedAt = new Date('2026-06-05T00:00:00Z')
    const r = await makeService(s).resolve({ shareId: 's1', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'unpublished' })
  })

  it('denies not_yet_exposed when exposesAt is in the future', async () => {
    const s = siteBase(); s.exposesAt = new Date('2026-06-20T00:00:00Z')
    const r = await makeService(s).resolve({ shareId: 's1', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'not_yet_exposed' })
  })

  it('denies password_required when password missing', async () => {
    const s = siteBase(); s.passwordHash = await hashSharePassword('secret')
    const r = await makeService(s).resolve({ shareId: 's1', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'password_required' })
  })

  it('ok when correct password supplied', async () => {
    const s = siteBase(); s.passwordHash = await hashSharePassword('secret')
    const r = await makeService(s).resolve({ shareId: 's1', password: 'secret', now: NOW })
    expect(r).toMatchObject({ status: 'ok' })
  })

  it('denies child not descended from root', async () => {
    const repo = { findShareByShareId: async () => siteBase(), findPathToRoot: async () => null }
    const svc = new ShareAccessService(repo as never)
    const r = await svc.resolve({ shareId: 's1', requestedPageId: 'pX', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'restricted_child' })
  })

  it('ok for a child in the published subtree', async () => {
    const repo = {
      findShareByShareId: async () => siteBase(),
      findPathToRoot: async () => [
        { id: 'p2', parentId: 'p1', collectionId: 'c1', archivedAt: null, deletedAt: null, collectionKind: 'TEAM', collectionOwnerId: null },
        { id: 'p1', parentId: null, collectionId: 'c1', archivedAt: null, deletedAt: null, collectionKind: 'TEAM', collectionOwnerId: null },
      ],
    }
    const svc = new ShareAccessService(repo as never)
    const r = await svc.resolve({ shareId: 's1', requestedPageId: 'p2', now: NOW })
    expect(r).toMatchObject({ status: 'ok' })
  })

  it('denies child when an ancestor is archived', async () => {
    const repo = {
      findShareByShareId: async () => siteBase(),
      findPathToRoot: async () => [
        { id: 'p2', parentId: 'p1', collectionId: 'c1', archivedAt: NOW, deletedAt: null, collectionKind: 'TEAM', collectionOwnerId: null },
        { id: 'p1', parentId: null, collectionId: 'c1', archivedAt: null, deletedAt: null, collectionKind: 'TEAM', collectionOwnerId: null },
      ],
    }
    const svc = new ShareAccessService(repo as never)
    const r = await svc.resolve({ shareId: 's1', requestedPageId: 'p2', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'restricted_child' })
  })

  it('denies child in another user PERSONAL collection', async () => {
    const repo = {
      findShareByShareId: async () => siteBase(),
      findPathToRoot: async () => [
        { id: 'p2', parentId: 'p1', collectionId: 'cP', archivedAt: null, deletedAt: null, collectionKind: 'PERSONAL', collectionOwnerId: 'someoneElse' },
        { id: 'p1', parentId: null, collectionId: 'c1', archivedAt: null, deletedAt: null, collectionKind: 'TEAM', collectionOwnerId: null },
      ],
    }
    const svc = new ShareAccessService(repo as never)
    const r = await svc.resolve({ shareId: 's1', requestedPageId: 'p2', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'restricted_child' })
  })

  it('denies child when publishSubpages is false', async () => {
    const s = siteBase(); s.publishSubpages = false
    const repo = {
      findShareByShareId: async () => s,
      findPathToRoot: async () => [
        { id: 'p2', parentId: 'p1', collectionId: 'c1', archivedAt: null, deletedAt: null, collectionKind: 'TEAM', collectionOwnerId: null },
        { id: 'p1', parentId: null, collectionId: 'c1', archivedAt: null, deletedAt: null, collectionKind: 'TEAM', collectionOwnerId: null },
      ],
    }
    const svc = new ShareAccessService(repo as never)
    const r = await svc.resolve({ shareId: 's1', requestedPageId: 'p2', now: NOW })
    expect(r).toEqual({ status: 'unavailable', reason: 'restricted_child' })
  })
})
```

- [ ] **Step 2: Run to verify new tests fail**

Run: `pnpm --filter @repo/domain test share-access`
Expected: FAIL (SITE/password/child cases)

- [ ] **Step 3: Implement checkSite, checkChild, and password hashing**

In `share-access.service.ts`, add the imports + helper at top:

```ts
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'

const SCRYPT_KEYLEN = 64

export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  return `${salt}:${derived}`
}

export function verifySharePassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN)
  const expected = Buffer.from(hash, 'hex')
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}
```

Replace the placeholder `checkSite`/`checkChild`:

```ts
  protected checkSite(share: ShareRow, input: ResolvePublicShareInput): PublicShareResult | null {
    const published =
      share.publishedAt &&
      (!share.unpublishedAt || share.unpublishedAt.getTime() < share.publishedAt.getTime())
    if (!published) return { status: 'unavailable', reason: 'unpublished' }

    if (share.exposesAt && share.exposesAt.getTime() > input.now.getTime())
      return { status: 'unavailable', reason: 'not_yet_exposed' }

    if (share.passwordHash) {
      if (!input.password || !verifySharePassword(input.password, share.passwordHash))
        return { status: 'unavailable', reason: 'password_required' }
    }
    return null
  }

  protected async checkChild(share: ShareRow, childId: string): Promise<PublicShareResult | null> {
    if (!share.publishSubpages) return { status: 'unavailable', reason: 'restricted_child' }
    const path = await this.repo.findPathToRoot(childId, share.page.id)
    if (!path) return { status: 'unavailable', reason: 'restricted_child' }
    for (const node of path) {
      if (node.archivedAt || node.deletedAt)
        return { status: 'unavailable', reason: 'restricted_child' }
      if (node.collectionKind === 'PERSONAL')
        return { status: 'unavailable', reason: 'restricted_child' }
    }
    return null
  }
```

When child access succeeds for SITE, the returned `page` should be the child, not the root. Update `resolve` to re-fetch the child for the OK payload — change the child branch to capture the resolved child page:

```ts
    let resolvedPage = share.page
    if (input.requestedPageId && input.requestedPageId !== share.page.id) {
      if (share.mode !== 'SITE')
        return { status: 'unavailable', reason: 'restricted_child' }
      const child = await this.checkChild(share, input.requestedPageId)
      if (child) return child
      const childPage = await this.repo.findPublicPageById(input.requestedPageId)
      if (!childPage) return { status: 'unavailable', reason: 'restricted_child' }
      resolvedPage = { ...share.page, ...childPage }
    }
```

Then build the `page` payload from `resolvedPage`. Add to the repository (`share-access.repository.ts`) the helper used above:

```ts
  async findPublicPageById(id: string): Promise<
    { id: string; type: string; title: string | null; icon: string | null; workspaceId: string } | null
  > {
    return this.prisma.page.findUnique({
      where: { id },
      select: { id: true, type: true, title: true, icon: true, workspaceId: true },
    })
  }
```

Add `findPublicPageById: async () => ({ id: 'p2', type: 'TEXT', title: 'C', icon: null, workspaceId: 'w1' })` to the child-success test's repo stub.

- [ ] **Step 4: Run to verify all resolver tests pass**

Run: `pnpm --filter @repo/domain test share-access`
Expected: PASS (all ~21 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/share-access packages/domain/test/share-access
git commit -m "feat(domain): resolver SITE mode, password/scheduled extensions, subtree child access"
```

### Task A5: Wire share-access module into the domain container

**Files:**
- Create: `packages/domain/src/share-access/share-access.module.ts`
- Create: `packages/domain/src/share-access/index.ts`
- Modify: `packages/domain/src/container.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: Write the module (follow collections.module.ts pattern)**

Read `packages/domain/src/collections/collections.module.ts` for the exact inversify-8 decorator-free binding style, then create `share-access.module.ts` binding `SHARE_ACCESS.Repository` (factory needing `PrismaClient`) and `SHARE_ACCESS.Service` (needs the repository). Create `index.ts` re-exporting the dto, service class, `hashSharePassword`, `verifySharePassword`, and tokens.

- [ ] **Step 2: Register in container.ts**

In `packages/domain/src/container.ts`: import `SHARE_ACCESS`, `shareAccessModule`, and `ShareAccessService`; add `shareAccess: ShareAccessService` to the container interface; load `shareAccessModule`; resolve `shareAccess: c.get<ShareAccessService>(SHARE_ACCESS.Service)`.

- [ ] **Step 3: Export from index.ts**

Add `export * from './share-access/index.ts'` to `packages/domain/src/index.ts`.

- [ ] **Step 4: Type-check + container test**

Run: `pnpm --filter @repo/domain check-types && pnpm --filter @repo/domain test container`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/share-access packages/domain/src/container.ts packages/domain/src/index.ts
git commit -m "feat(domain): wire share-access module into container"
```

### Task A6: publicSitesEnabled plan feature flag

**Files:**
- Modify: `packages/domain/src/billing/dto/billing.dto.ts`
- Modify: `packages/domain/src/billing/repositories/billing.repository.ts`

- [ ] **Step 1: Add the flag to PlanFeatures DTO**

In `billing.dto.ts`, add `publicSitesEnabled: boolean` to the `PlanFeatures` type.

- [ ] **Step 2: Map it from Plan.features JSON in planToFeatures**

In `billing.repository.ts` `planToFeatures`, read it from the plan's `features` JSON array (treat `features` as a string array of enabled flags): `publicSitesEnabled: Array.isArray(plan.features) && (plan.features as string[]).includes('publicSites')`. Ensure the personal-plan fallback sets `publicSitesEnabled: false`.

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @repo/domain check-types`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/billing
git commit -m "feat(domain): publicSitesEnabled plan feature flag"
```

### Task A7: tRPC link/site settings + publish/unpublish + password procedures

**Files:**
- Modify: `packages/trpc/src/routers/page-share.ts`
- Test: `packages/trpc/test/public-share.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `packages/trpc/test/public-share.test.ts` following the existing `packages/trpc/test/*.test.ts` real-DB harness (see `collection-router.test.ts` for the self-contained fixture pattern — create user + workspace + consents + page inline). Cover:
- `updatePublicLinkSettings` sets access/linkRole/expiresAt;
- `publishSite` sets mode=SITE + publishedAt when `publicSitesEnabled` true, throws FORBIDDEN when false;
- `unpublishSite` sets unpublishedAt;
- `updatePublicSiteSettings` sets allowIndexing/allowCopy/publishSubpages/analytics;
- `setSharePassword` stores a non-plaintext hash (assert the stored value !== the password and contains ':'), `clearSharePassword` nulls it;
- non-manager (a plain member who isn't creator/owner/admin) gets FORBIDDEN on each.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/trpc test public-share`
Expected: FAIL (procedures undefined)

- [ ] **Step 3: Implement the procedures**

In `page-share.ts` add (after `setAccess`), reusing `assertCanManageShare` and an `ensureShare(ctx, pageId)` helper that lazily creates the row:
- `updatePublicLinkSettings({ pageId, access, linkRole, expiresAt: z.date().nullable().optional() })`
- `updatePublicSiteSettings({ pageId, allowIndexing, allowCopy, publishSubpages, analyticsGoogleId: z.string().nullable().optional(), analyticsYandexMetricaId: z.string().nullable().optional() })`
- `publishSite({ pageId })` — calls `getWorkspaceFeatures(page.workspaceId)`; if `!publicSitesEnabled` throw `TRPCError({ code: 'FORBIDDEN' })`; sets `mode: 'SITE', publishedAt: new Date(), unpublishedAt: null`.
- `unpublishSite({ pageId })` — sets `unpublishedAt: new Date()`.
- `setExposesAt({ pageId, exposesAt: z.date().nullable() })`
- `setSharePassword({ pageId, password: z.string().min(1) })` — `passwordHash: await hashSharePassword(password)` (import from `@repo/domain`). `clearSharePassword({ pageId })` — `passwordHash: null`.

Extend `shareSelect` to include the new fields so `get` returns them for the dialog.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @repo/trpc test public-share`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/page-share.ts packages/trpc/test/public-share.test.ts
git commit -m "feat(trpc): public link/site settings, publish/unpublish, password procedures"
```

### Task A8: validateSharePassword public procedure + wire web resolver + Yjs token

**Files:**
- Modify: `packages/trpc/src/routers/page-share.ts`
- Modify: `apps/web/src/lib/share-access.ts`
- Modify: `apps/web/src/app/api/yjs/share-token/route.ts`

- [ ] **Step 1: Add `validateSharePassword` (public-ish) procedure**

In `page-share.ts`, add `validateSharePassword: publicProcedure.input({ shareId, password }).mutation(...)` — look up the share by shareId, return `{ valid: verifySharePassword(password, share.passwordHash) }` (import `verifySharePassword` from `@repo/domain`); return `{ valid: false }` if no passwordHash. (If the router has no `publicProcedure`, use the existing public router pattern — check `packages/trpc/src/trpc.ts`.)

- [ ] **Step 2: Replace web `resolveShareAccess` internals to call the domain resolver**

Rewrite `apps/web/src/lib/share-access.ts` so `resolveShareAccess(prisma, shareId, session, opts?)` builds the domain container (or constructs `ShareAccessService` directly with a `ShareAccessRepository`), calls `.resolve({ shareId, requestedPageId: opts?.pageId, password: opts?.password, now: new Date() })`, and maps the result. Keep `mapMemberRole` and the authenticated-member fast-path (workspace members + named grants still win and are NOT subject to publish/expiry gating). Only fall through to the resolver for the public path. Return a discriminated shape the route can switch on: `{ kind: 'member'|'grant'|'public', role, page } | { kind: 'unavailable', reason } | { kind: 'not_found' }`.

- [ ] **Step 3: Make the Yjs share-token route use the resolver**

In `apps/web/src/app/api/yjs/share-token/route.ts`, replace the direct `resolveShareAccess` role logic so an unavailable resolver result (expired/unpublished/password/archived) returns 403. Members/grants keep working.

- [ ] **Step 4: Type-check + lint**

Run: `pnpm check-types && pnpm --filter web lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/page-share.ts apps/web/src/lib/share-access.ts apps/web/src/app/api/yjs/share-token/route.ts
git commit -m "feat(share): validateSharePassword + route resolver via domain authority"
```

---

## Phase B — Copy-to-workspace (Prompt 2.4, done early because it is domain-pure)

### Task B1: PublicShareCopyService + copyToWorkspace procedure

**Files:**
- Create: `packages/domain/src/share-copy/services/share-copy.service.ts` (+ module/tokens/index following the collections pattern)
- Modify: `packages/domain/src/container.ts`, `packages/domain/src/index.ts`
- Modify: `packages/trpc/src/routers/page-share.ts`
- Test: `packages/domain/test/share-copy/services/share-copy.service.test.ts`, `packages/trpc/test/share-copy.test.ts`

- [ ] **Step 1: Write failing domain test**

Test `copyTree({ rootPageId, targetWorkspaceId, targetCollectionId, actorUserId, includeSubtree })` with a mocked repo: asserts it creates a root copy + one child copy (when includeSubtree), copies content+contentYjs, sets `copiedFromShareId/PageId/At`, does NOT copy comments/grants, and skips archived/deleted/PERSONAL-of-other children.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/domain test share-copy`
Expected: FAIL

- [ ] **Step 3: Implement `PublicShareCopyService`**

Reuse the deep-copy shape from `templates.service.ts createPageFromTemplate` (live content fetch — avoid stale snapshots). Walk the published subtree (children where parentId chains from root, excluding archived/deleted/other-PERSONAL), create pages in target workspace/collection preserving the tree, copy `content`+`contentYjs`+`icon`+`type`, set provenance, enqueue `page.upserted` outbox events. Single page when `includeSubtree=false`.

- [ ] **Step 4: Run domain test to pass**

Run: `pnpm --filter @repo/domain test share-copy`
Expected: PASS

- [ ] **Step 5: Add `copyToWorkspace` tRPC procedure + integration test**

`share.copyToWorkspace({ shareId, rootPageId: uuid().optional(), targetWorkspaceId, targetCollectionId: uuid().optional(), includeSubtree: z.boolean().default(true) })` — `protectedProcedure`; re-validate via `ShareAccessService.resolve` (deny when `allowCopy` false or status unavailable); assert the caller is a member of `targetWorkspaceId`; default `targetCollectionId` to the caller's PERSONAL collection; call `copyTree`. Integration test: copy disabled when allowCopy=false; denied when unpublished/expired; creates page(s) in target; subtree includes visible children; private/archived children excluded.

- [ ] **Step 6: Run integration test + commit**

```bash
pnpm --filter @repo/trpc test share-copy
git add packages/domain/src/share-copy packages/domain/src/container.ts packages/domain/src/index.ts packages/trpc/src/routers/page-share.ts packages/domain/test/share-copy packages/trpc/test/share-copy.test.ts
git commit -m "feat(share): PublicShareCopyService + copyToWorkspace (duplicate-as-template)"
```

---

## Phase C — Share dialog + Publish tab UI (Prompt 2.2)

### Task C1: Status chips component

**Files:**
- Create: `apps/web/src/components/page/share-status-chips.tsx`
- Test: `apps/web/test/share-status-chips.test.tsx`

- [ ] **Step 1: Failing test** — render with a share object having `access=PUBLIC, mode=SITE, publishedAt set, allowIndexing=true, allowCopy=true, passwordHash set, exposesAt future`; assert chips render the expected Russian labels (link enabled, site published, indexing on, copy allowed, password-protected, scheduled).
- [ ] **Step 2: Run, verify fail.** `pnpm --filter web test share-status-chips`
- [ ] **Step 3: Implement** a pure presentational `ShareStatusChips` taking the share view-model; import MUI `Chip` via `@repo/ui/components`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat(web): share status chips`.

### Task C2: Publish tab body

**Files:**
- Create: `apps/web/src/components/page/publish-tab.tsx`

- [ ] **Step 1:** Build `PublishTab` (client component) with Publish/Unpublish button (calls `publishSite`/`unpublishSite`), public URL copy, status, Site settings (indexing/allowCopy/publishSubpages toggles → `updatePublicSiteSettings`, analytics id fields), and a `Расширения AnyNote` `Accordion`/section with password set/clear (`setSharePassword`/`clearSharePassword`) + scheduled-publish date (`setExposesAt`). Disable Publish with a tooltip when `!publicSitesEnabled` (read from a plan query).
- [ ] **Step 2:** Type-check + lint. `pnpm check-types && pnpm --filter web lint`
- [ ] **Step 3:** Commit `feat(web): Publish tab body`.

### Task C3: Two-tab share dialog refactor

**Files:**
- Modify: `apps/web/src/components/page/share-dialog.tsx`

- [ ] **Step 1:** Wrap existing content in MUI `Tabs`: tab 1 `Доступ` (current people + General access + a link-expiration picker under "Anyone with link" calling `updatePublicLinkSettings`), tab 2 `Публикация` (`<PublishTab/>`). Add `<ShareStatusChips/>` at the top. Keep the dialog compact.
- [ ] **Step 2:** Update any test in `apps/web/test/` that asserts old dialog structure (grep for `share-dialog`). Run `pnpm --filter web test` and fix breakages.
- [ ] **Step 3:** Type-check + lint.
- [ ] **Step 4:** Commit `feat(web): two-tab Share/Publish dialog`.

### Task C4: Manage public pages settings section

**Files:**
- Create: `apps/web/src/components/workspace/settings/public-pages-section.tsx`
- Modify: settings page to mount it; add `listManagedPublicPages` tRPC query (workspace-scoped list of shares with mode/published/expires) to `page-share.ts`.

- [ ] **Step 1:** Add `listManagedPublicPages({ workspaceId })` procedure + a focused trpc test.
- [ ] **Step 2:** Build the section: table of public links/sites with open-settings / copy-URL / unpublish actions.
- [ ] **Step 3:** Type-check + lint + test.
- [ ] **Step 4:** Commit `feat(web): Manage public pages settings section`.

---

## Phase D — Public route: states, subpages, copy, metadata (Prompts 2.2/2.3/2.4 UI)

### Task D1: Unavailable-state + password-gate screens

**Files:**
- Create: `apps/web/src/components/share/share-unavailable.tsx`
- Modify: `apps/web/src/app/(share)/s/[shareId]/page.tsx`

- [ ] **Step 1:** `ShareUnavailable({ reason })` renders a Russian message per reason (disabled/unpublished/expired/not_yet_exposed/restricted_child) and a `SharePasswordGate({ shareId })` for `password_required` that calls `validateSharePassword` then reloads with the password (store accepted password in a cookie/searchparam the route reads).
- [ ] **Step 2:** In `page.tsx`, switch on the resolver result: `not_found`→`notFound()`; `unavailable`→`<ShareUnavailable/>`; `ok`→ existing render. Pass `password` from the gate through to `resolveShareAccess`.
- [ ] **Step 3:** Type-check + lint.
- [ ] **Step 4:** Commit `feat(share): unavailable states + password gate`.

### Task D2: Per-page generateMetadata (fix noindex)

**Files:**
- Modify: `apps/web/src/app/(share)/layout.tsx` (remove `NOINDEX_METADATA` export)
- Modify: `apps/web/src/app/(share)/s/[shareId]/page.tsx` (add `generateMetadata`)
- Test: `apps/web/test/share-metadata.test.ts`

- [ ] **Step 1: Failing test** for a pure helper `shareRobots({ mode, published, allowIndexing })` → `{ index: boolean }`: index only when `mode==='SITE' && published && allowIndexing`.
- [ ] **Step 2:** Implement the helper; export `generateMetadata` in `page.tsx` using it (`robots: { index, follow: index }`); remove the layout-level metadata export.
- [ ] **Step 3:** Run test, type-check, lint.
- [ ] **Step 4:** Commit `feat(share): per-page robots metadata (indexing only when allowed)`.

### Task D3: Nested subpage route + tree navigation

**Files:**
- Create: `apps/web/src/app/(share)/s/[shareId]/[childPageId]/page.tsx`
- Create: `apps/web/src/components/share/public-share-tree-nav.tsx`
- Add: `share.publicTree({ shareId })` tRPC query returning the published subtree (resolver-validated) for nav.

- [ ] **Step 1:** Add `publicTree` procedure + trpc test (returns only published, non-archived, non-personal-of-others descendants; empty for LINK mode).
- [ ] **Step 2:** Build `[childPageId]/page.tsx` resolving via `resolveShareAccess(prisma, shareId, session, { pageId: childPageId })`; render the same `PageRenderer` + `PublicShareTreeNav`.
- [ ] **Step 3:** Build `PublicShareTreeNav` (SITE only): renders the tree, links to `/s/[shareId]/[childPageId]`.
- [ ] **Step 4:** Type-check + lint + test.
- [ ] **Step 5:** Commit `feat(share): nested public subpage route + tree navigation`.

### Task D4: CopyToWorkspace button + dialog

**Files:**
- Create: `apps/web/src/components/share/copy-to-workspace-dialog.tsx`
- Modify: `apps/web/src/app/(share)/s/[shareId]/share-page-client.tsx` (mount the button when `allowCopy`)

- [ ] **Step 1:** `CopyToWorkspaceButton` visible only when `share.allowCopy` and resolver permitted; opens a dialog choosing target workspace (from the user's memberships) + collection (defaults to PERSONAL); calls `copyToWorkspace`; on success navigates to the new page. Anonymous → redirect to sign-in with a return URL.
- [ ] **Step 2:** Type-check + lint.
- [ ] **Step 3:** Commit `feat(share): copy-to-workspace button + dialog`.

---

## Phase E — E2E + final gate

### Task E1: Playwright specs

**Files:**
- Modify: `apps/e2e/page-sharing.spec.ts` (link expiry, publish/unpublish flows)
- Create: `apps/e2e/public-site.spec.ts` (publish site → URL opens; subpage opens via nested URL; enable copy → button visible → copy creates owned page; password gate)

- [ ] **Step 1:** Write the specs using `signUpAndAuthAs` helper. Note: E2E webServer has no yjs server — assert tRPC-backed UI + route states, not collab content persistence (per `feedback_e2e_no_yjs_persistence`).
- [ ] **Step 2:** Run focused specs warm: `pnpm exec playwright test apps/e2e/page-sharing.spec.ts apps/e2e/public-site.spec.ts --retries 1`
- [ ] **Step 3:** Commit `test(e2e): public link expiry, publish site, subpages, copy`.

### Task E2: Full gate

- [ ] **Step 1:** `pnpm check-types` → 22/22 pass.
- [ ] **Step 2:** `pnpm lint` → all pass.
- [ ] **Step 3:** `pnpm --filter @repo/trpc test && pnpm --filter @repo/domain test && pnpm --filter web test && pnpm --filter engines test` → all pass.
- [ ] **Step 4:** `set -a; . ./.env; set +a; pnpm --filter web build` → succeeds.
- [ ] **Step 5:** Re-verify migration on a fresh scratch DB (zero drift).
- [ ] **Step 6:** Update `docs/changelog.md` with the public-sharing entry; commit.

---

## Self-review notes

- Spec coverage: A1–A8 cover schema + resolver + procedures + plan gate (2.1); B1 covers copy (2.4 domain/API); C1–C4 cover dialog/publish/manage (2.2); D1–D4 cover public states/metadata/subpages/copy UI (2.2/2.3/2.4 UI); E covers tests. Subpage navigation (2.3) = D3 + the `publicTree`/`findPathToRoot` resolver work in A2/A4.
- Password is hashed via scrypt (node:crypto) — never stored/returned plaintext; `setSharePassword`/`validateSharePassword` covered.
- Type consistency: `ShareAccessService.resolve` returns `PublicShareResult` everywhere; `copyTree` signature fixed in B1; chip view-model shared between C1/C3.
- The resolver is the single authority; both the route (A8/D1/D3) and the Yjs token (A8) go through it.
