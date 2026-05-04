# Genogram Editor UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширить пакет `@repo/genogram` слоем редактирования: формы (OwnerData/PersonData/Marriage/AddChildren), контекстные меню, правый Drawer, начальный экран, авто-создание родителей при "Создать генограмму", частичные даты, перетаскиваемая отметка развода, упорядочивание партнёров и детей.

**Architecture:** Подход A из спеки — весь UI внутри `@repo/genogram` (по аналогии с `@repo/excalidraw`). Состояние UI через `useReducer` в `GenogramFlow`. Формы вызывают новые/расширенные Yjs actions, которые атомарно меняют Y.Doc. Layout пересчитывается реактивно по `useGenogramLayout`.

**Tech Stack:** TypeScript, React 19, MUI v7, React Flow v12, Yjs, Vitest (+ jsdom для component tests), Playwright (E2E). Спека: [docs/superpowers/specs/2026-04-27-genogram-editor-ui-design.md](../specs/2026-04-27-genogram-editor-ui-design.md).

**Соглашения**:

- Vitest для unit и component тестов; co-located `*.test.ts` / `*.test.tsx` рядом с кодом (как существующий `src/yjs/actions.test.ts`).
- Component-тесты добавляют `// @vitest-environment jsdom` в первой строке.
- Прод-данных нет — миграции не требуются.
- Все user-facing строки берутся из `RU` (см. спеку, раздел "i18n").
- `pnpm --filter @repo/genogram <script>` — для запуска.

---

## Phase 0 — Setup

### Task 1: Add MUI dependencies and configure Vitest for component tests

**Files:**

- Modify: `packages/genogram/package.json`
- Modify: `packages/genogram/vitest.config.ts`
- Create: `packages/genogram/test-setup.ts`

- [ ] **Step 1: Add deps to package.json**

Edit `packages/genogram/package.json` `dependencies`:

```json
"@mui/material": "^7.3.10",
"@mui/icons-material": "^7.3.10",
"@emotion/react": "^11.13.0",
"@emotion/styled": "^11.13.0"
```

Add to `devDependencies`:

```json
"@testing-library/react": "^16.0.0",
"@testing-library/user-event": "^14.5.0",
"@testing-library/jest-dom": "^6.6.0",
"jsdom": "^25.0.0",
"react-dom": "^19.2.0"
```

- [ ] **Step 2: Install**

```bash
pnpm install
```

Expected: deps installed, no errors.

- [ ] **Step 3: Create test-setup.ts**

```ts
// packages/genogram/test-setup.ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 4: Update vitest.config.ts**

Replace `packages/genogram/vitest.config.ts` content:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
    setupFiles: ['./test-setup.ts'],
    environmentMatchGlobs: [
      ['**/*.test.tsx', 'jsdom'],
      ['**/*.test.ts', 'node'],
    ],
  },
})
```

- [ ] **Step 5: Verify existing tests still pass**

```bash
pnpm --filter @repo/genogram test
```

Expected: all existing tests in `src/yjs/actions.test.ts` pass.

- [ ] **Step 6: Commit**

```bash
git add packages/genogram/package.json packages/genogram/vitest.config.ts packages/genogram/test-setup.ts pnpm-lock.yaml
git commit -m "chore(genogram): add MUI + RTL deps; configure vitest for component tests"
```

---

## Phase 1 — Domain Types Extensions

### Task 2: Extend LifeDates with new fields and PartialDate

**Files:**

- Modify: `packages/genogram/src/types/domain.ts`

- [ ] **Step 1: Add new types and extend LifeDates**

Edit `packages/genogram/src/types/domain.ts`. After `DeathKind` add:

```ts
export type LifeStatus = 'alive' | 'deceased' | 'unknown'
export type BirthMode = 'date' | 'approximate'

export type ApproximateAge =
  | { kind: 'value'; value: number }
  | { kind: 'range'; from: number; to: number }

export interface PartialDate {
  year?: number
  month?: number
  day?: number
}
```

Replace `LifeDates` interface with:

```ts
export interface LifeDates {
  birthDate?: PartialDate
  deathDate?: PartialDate
  birthMode: BirthMode
  approximateAge?: ApproximateAge
  lifeStatus: LifeStatus
  tragically?: boolean
}
```

Remove existing `DeathKind` type (no longer used) — search and remove the `export type DeathKind = ...` line.

- [ ] **Step 2: Run type check**

```bash
pnpm --filter @repo/genogram check-types
```

Expected: errors in places that referenced `isDeceased`, `birthDateApprox`, `deathDateApprox`, `deathKind`. Note them — they will be fixed in following tasks.

- [ ] **Step 3: Update Union dates and UnionDivorce**

Edit `packages/genogram/src/types/domain.ts`. Replace `UnionDivorce` interface with:

```ts
export interface UnionDivorce {
  date?: PartialDate
  custodySide?: CustodySide
  markPosition?: number
}
```

Edit `Union` interface — change `startDate?: string` and `endDate?: string` to `startDate?: PartialDate` and `endDate?: PartialDate`.

Edit `PregnancyLoss` interface — change `date?: string` to `date?: PartialDate`.

- [ ] **Step 4: Add GenogramMeta type**

At end of `packages/genogram/src/types/domain.ts`:

```ts
export interface GenogramMeta {
  createdAt: string
  ownerId: PersonId
}
```

`PersonId` is imported at top of file from `./ids`. Add to existing import if not present.

- [ ] **Step 5: Verify check-types fails as expected**

```bash
pnpm --filter @repo/genogram check-types
```

Expected: failures on call sites using removed/changed fields. We'll fix them in later tasks.

- [ ] **Step 6: Commit**

```bash
git add packages/genogram/src/types/domain.ts
git commit -m "feat(genogram): extend domain model with PartialDate, LifeStatus, GenogramMeta, divorce.markPosition"
```

---

### Task 3: Update factories to use new domain shape

**Files:**

- Modify: `packages/genogram/src/model/factories.ts`

- [ ] **Step 1: Read current factories.ts to know exact shape**

```bash
cat packages/genogram/src/model/factories.ts
```

Identify call sites that produce `LifeDates`, `Union`, `PregnancyLoss`.

- [ ] **Step 2: Update LifeDates factories**

In `factories.ts`, find any place creating a `LifeDates` object. Update to new shape. Common pattern likely looks like:

```ts
const lifeDates: LifeDates = {
  birthMode: 'date',
  lifeStatus: 'unknown',
}
```

For owner creation (createOwner / createPersonOwner): use `lifeStatus: 'alive'`.
Add helper:

```ts
export function createDefaultParent(sex: Sex): Person {
  return createPerson({
    sex,
    bloodRelation: 'direct',
    role: 'regular',
    size: 'big',
    identity: { isUnknown: true },
    lifeDates: { birthMode: 'date', lifeStatus: 'unknown' },
    profile: {},
  })
}

export function createDefaultUnion(maleId: PersonId, femaleId: PersonId): Omit<Union, 'id'> {
  return {
    kind: 'marriage',
    malePartnerId: maleId,
    femalePartnerId: femaleId,
  }
}
```

- [ ] **Step 3: Run check-types**

```bash
pnpm --filter @repo/genogram check-types
```

Expected: more errors fixed; remaining errors localized to call sites elsewhere.

- [ ] **Step 4: Commit**

```bash
git add packages/genogram/src/model/factories.ts
git commit -m "feat(genogram): factories produce new LifeDates shape; add createDefaultParent/createDefaultUnion"
```

---

## Phase 2 — i18n and Date Formatting

### Task 4: Create i18n/format-date.ts (TDD)

**Files:**

- Create: `packages/genogram/src/i18n/format-date.ts`
- Create: `packages/genogram/src/i18n/format-date.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/genogram/src/i18n/format-date.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatPartialDate } from './format-date'

describe('formatPartialDate', () => {
  it('returns full date with genitive month when day+month+year present', () => {
    expect(formatPartialDate({ day: 15, month: 4, year: 2026 })).toBe('15 апреля 2026')
  })

  it('returns nominative month + year when no day', () => {
    expect(formatPartialDate({ month: 4, year: 2026 })).toBe('апрель 2026')
  })

  it('returns just year when only year', () => {
    expect(formatPartialDate({ year: 2026 })).toBe('2026')
  })

  it('returns day + genitive month when no year', () => {
    expect(formatPartialDate({ day: 15, month: 4 })).toBe('15 апреля')
  })

  it('returns empty string when only day', () => {
    expect(formatPartialDate({ day: 15 })).toBe('')
  })

  it('returns empty string when only month', () => {
    expect(formatPartialDate({ month: 4 })).toBe('')
  })

  it('returns empty string when empty', () => {
    expect(formatPartialDate({})).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(formatPartialDate(undefined)).toBe('')
  })
})
```

- [ ] **Step 2: Run test and confirm fail**

```bash
pnpm --filter @repo/genogram test src/i18n/format-date.test.ts
```

Expected: FAIL with "Cannot find module './format-date'".

- [ ] **Step 3: Implement format-date.ts**

Create `packages/genogram/src/i18n/format-date.ts`:

```ts
import type { PartialDate } from '../types/domain'

const MONTHS_NOMINATIVE = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
] as const

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const

export function formatPartialDate(d: PartialDate | undefined): string {
  if (!d) return ''
  const { day, month, year } = d
  const monthIdx = month !== undefined ? month - 1 : -1
  const monthNom = monthIdx >= 0 ? MONTHS_NOMINATIVE[monthIdx] : undefined
  const monthGen = monthIdx >= 0 ? MONTHS_GENITIVE[monthIdx] : undefined

  if (day !== undefined && monthGen && year !== undefined) return `${day} ${monthGen} ${year}`
  if (monthNom && year !== undefined) return `${monthNom} ${year}`
  if (year !== undefined && day === undefined && month === undefined) return `${year}`
  if (day !== undefined && monthGen && year === undefined) return `${day} ${monthGen}`
  return ''
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
pnpm --filter @repo/genogram test src/i18n/format-date.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/i18n/format-date.ts packages/genogram/src/i18n/format-date.test.ts
git commit -m "feat(genogram): add formatPartialDate with Russian declension"
```

---

### Task 5: Create i18n/ru.ts with all strings

**Files:**

- Create: `packages/genogram/src/i18n/ru.ts`
- Create: `packages/genogram/src/i18n/ru.test.ts`

- [ ] **Step 1: Write tests for non-trivial helpers**

Create `packages/genogram/src/i18n/ru.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RU } from './ru'

describe('RU.labels.yearsSuffix', () => {
  it('uses год for 1, 21, 31, ...', () => {
    expect(RU.labels.yearsSuffix(1)).toBe('год')
    expect(RU.labels.yearsSuffix(21)).toBe('год')
    expect(RU.labels.yearsSuffix(101)).toBe('год')
  })

  it('uses года for 2-4, 22-24, ...', () => {
    expect(RU.labels.yearsSuffix(2)).toBe('года')
    expect(RU.labels.yearsSuffix(3)).toBe('года')
    expect(RU.labels.yearsSuffix(4)).toBe('года')
    expect(RU.labels.yearsSuffix(22)).toBe('года')
  })

  it('uses лет for 5-20, 25-30, ...', () => {
    expect(RU.labels.yearsSuffix(5)).toBe('лет')
    expect(RU.labels.yearsSuffix(11)).toBe('лет')
    expect(RU.labels.yearsSuffix(12)).toBe('лет')
    expect(RU.labels.yearsSuffix(13)).toBe('лет')
    expect(RU.labels.yearsSuffix(14)).toBe('лет')
    expect(RU.labels.yearsSuffix(15)).toBe('лет')
    expect(RU.labels.yearsSuffix(20)).toBe('лет')
  })
})

describe('RU.labels.yearsOld', () => {
  it('combines number and suffix', () => {
    expect(RU.labels.yearsOld(1)).toBe('1 год')
    expect(RU.labels.yearsOld(2)).toBe('2 года')
    expect(RU.labels.yearsOld(42)).toBe('42 года')
    expect(RU.labels.yearsOld(11)).toBe('11 лет')
  })
})

describe('RU.labels.yearsOldApprox', () => {
  it('prefixes with ~', () => {
    expect(RU.labels.yearsOldApprox(42)).toBe('~42 года')
  })
})

describe('RU.labels.yearsOldRange', () => {
  it('renders range with ~ prefix', () => {
    expect(RU.labels.yearsOldRange(30, 35)).toBe('~30-35')
  })
})
```

- [ ] **Step 2: Run, confirm fail**

```bash
pnpm --filter @repo/genogram test src/i18n/ru.test.ts
```

Expected: FAIL "Cannot find module './ru'".

- [ ] **Step 3: Implement ru.ts**

Create `packages/genogram/src/i18n/ru.ts` using the full content from spec section "i18n" (RU object). Export as `export const RU = { ... }`. Reference: `docs/superpowers/specs/2026-04-27-genogram-editor-ui-design.md` lines covering `export const RU`. The yearsSuffix function:

```ts
yearsSuffix: (n: number): 'год' | 'года' | 'лет' => {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'год'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'года'
  return 'лет'
}
```

`yearsOld` references `RU.labels.yearsSuffix(n)` — the runtime lookup works because `RU` is fully defined by the time these helpers are called.

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm --filter @repo/genogram test src/i18n/ru.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/i18n/ru.ts packages/genogram/src/i18n/ru.test.ts
git commit -m "feat(genogram): add Russian i18n strings with declension helpers"
```

---

## Phase 3 — Computed Helpers

### Task 6: calcAge and calcAgeAtDeath

**Files:**

- Modify: `packages/genogram/src/model/computed.ts`
- Modify: `packages/genogram/src/model/computed.test.ts` (create if absent)

- [ ] **Step 1: Write failing tests**

Create or extend `packages/genogram/src/model/computed.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { calcAge, calcAgeAtDeath } from './computed'
import type { Person } from '../types/domain'

describe('calcAge', () => {
  it('returns exact age when full birthDate and full refDate', () => {
    expect(calcAge({ day: 5, month: 3, year: 1984 }, { day: 27, month: 4, year: 2026 })).toBe(42)
  })

  it('returns approximate age when only year in birthDate', () => {
    expect(calcAge({ year: 1984 }, { day: 27, month: 4, year: 2026 })).toBe(42)
  })

  it('returns undefined when no year in birthDate', () => {
    expect(calcAge({ day: 5, month: 3 }, { day: 27, month: 4, year: 2026 })).toBeUndefined()
  })

  it('accepts ISO string for refDate', () => {
    expect(calcAge({ day: 5, month: 3, year: 1984 }, '2026-04-27T00:00:00Z')).toBe(42)
  })

  it('accounts for not-yet-reached birthday', () => {
    expect(calcAge({ day: 5, month: 6, year: 1984 }, { day: 27, month: 4, year: 2026 })).toBe(41)
  })
})

describe('calcAgeAtDeath', () => {
  it('returns age based on death date when both dates have full info', () => {
    const p: Person = personWith({
      birthDate: { day: 5, month: 3, year: 1950 },
      deathDate: { day: 5, month: 3, year: 2000 },
      lifeStatus: 'deceased',
    })
    expect(calcAgeAtDeath(p)).toBe(50)
  })

  it('returns undefined when not deceased', () => {
    const p: Person = personWith({
      birthDate: { day: 5, month: 3, year: 1950 },
      lifeStatus: 'alive',
    })
    expect(calcAgeAtDeath(p)).toBeUndefined()
  })

  it('returns undefined when missing year in either date', () => {
    const p: Person = personWith({
      birthDate: { day: 5, month: 3, year: 1950 },
      deathDate: { day: 5 },
      lifeStatus: 'deceased',
    })
    expect(calcAgeAtDeath(p)).toBeUndefined()
  })
})

// Helper for tests
function personWith(life: Partial<Person['lifeDates']>): Person {
  return {
    id: 'p1' as Person['id'],
    sex: 'male',
    role: 'regular',
    size: 'big',
    bloodRelation: 'direct',
    identity: {},
    profile: {},
    label: {} as Person['label'],
    lifeDates: { birthMode: 'date', lifeStatus: 'alive', ...life },
  }
}
```

- [ ] **Step 2: Run, confirm fail**

```bash
pnpm --filter @repo/genogram test src/model/computed.test.ts
```

Expected: FAIL "calcAge is not exported" or "Cannot find name 'calcAge'".

- [ ] **Step 3: Implement calcAge / calcAgeAtDeath**

Add to `packages/genogram/src/model/computed.ts`:

```ts
import type { PartialDate, Person } from '../types/domain'

export function calcAge(
  birth: PartialDate | undefined,
  ref: PartialDate | string | undefined,
): number | undefined {
  if (!birth || birth.year === undefined || !ref) return undefined
  const refPartial = typeof ref === 'string' ? isoToPartial(ref) : ref
  if (!refPartial || refPartial.year === undefined) return undefined

  if (
    birth.day !== undefined &&
    birth.month !== undefined &&
    refPartial.day !== undefined &&
    refPartial.month !== undefined
  ) {
    let age = refPartial.year - birth.year
    if (
      refPartial.month < birth.month ||
      (refPartial.month === birth.month && refPartial.day < birth.day)
    ) {
      age -= 1
    }
    return age
  }
  return refPartial.year - birth.year
}

export function calcAgeAtDeath(person: Person): number | undefined {
  if (person.lifeDates.lifeStatus !== 'deceased') return undefined
  return calcAge(person.lifeDates.birthDate, person.lifeDates.deathDate)
}

function isoToPartial(iso: string): PartialDate | undefined {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return undefined
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}
```

If `computed.ts` already exists, append new exports (do not duplicate existing).

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm --filter @repo/genogram test src/model/computed.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/model/computed.ts packages/genogram/src/model/computed.test.ts
git commit -m "feat(genogram): add calcAge and calcAgeAtDeath helpers"
```

---

### Task 7: shouldShowDeathCross

**Files:**

- Modify: `packages/genogram/src/model/computed.ts`
- Modify: `packages/genogram/src/model/computed.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/genogram/src/model/computed.test.ts`:

```ts
import { shouldShowDeathCross } from './computed'

describe('shouldShowDeathCross', () => {
  it('returns false when not deceased', () => {
    const p = personWith({ lifeStatus: 'alive' })
    expect(shouldShowDeathCross(p)).toBe(false)
  })

  it('returns true when tragically=true regardless of age', () => {
    const p = personWith({
      lifeStatus: 'deceased',
      tragically: true,
      birthDate: { year: 1900 },
      deathDate: { year: 1990 }, // age 90
    })
    expect(shouldShowDeathCross(p)).toBe(true)
  })

  it('returns true when ageAtDeath < 65', () => {
    const p = personWith({
      lifeStatus: 'deceased',
      birthDate: { year: 1950 },
      deathDate: { year: 2000 }, // age 50
    })
    expect(shouldShowDeathCross(p)).toBe(true)
  })

  it('returns false when ageAtDeath >= 65 and not tragically', () => {
    const p = personWith({
      lifeStatus: 'deceased',
      birthDate: { year: 1900 },
      deathDate: { year: 2000 }, // age 100
    })
    expect(shouldShowDeathCross(p)).toBe(false)
  })

  it('returns false when ageAtDeath unknown and not tragically', () => {
    const p = personWith({
      lifeStatus: 'deceased',
      // no birth/death dates
    })
    expect(shouldShowDeathCross(p)).toBe(false)
  })
})
```

- [ ] **Step 2: Run, confirm fail**

```bash
pnpm --filter @repo/genogram test src/model/computed.test.ts
```

- [ ] **Step 3: Implement**

Append to `packages/genogram/src/model/computed.ts`:

```ts
export function shouldShowDeathCross(person: Person): boolean {
  if (person.lifeDates.lifeStatus !== 'deceased') return false
  if (person.lifeDates.tragically === true) return true
  const age = calcAgeAtDeath(person)
  return age !== undefined && age < 65
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm --filter @repo/genogram test src/model/computed.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/model/computed.ts packages/genogram/src/model/computed.test.ts
git commit -m "feat(genogram): shouldShowDeathCross combines tragically flag and age<65"
```

---

### Task 8: hasParents, getChildGroupOf, getChildrenOf

**Files:**

- Modify: `packages/genogram/src/model/computed.ts`
- Modify: `packages/genogram/src/model/computed.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
import { hasParents, getChildGroupOf, getChildrenOf } from './computed'
import type { ChildGroup, ChildGroupId, PersonId, UnionId } from '../types/domain'

describe('hasParents / getChildGroupOf', () => {
  const cgA: ChildGroup = {
    id: 'cgA' as ChildGroupId,
    unionId: 'u1' as UnionId,
    children: [
      { kind: 'person', personId: 'kid1' as PersonId },
      { kind: 'person', personId: 'kid2' as PersonId },
    ],
  }
  const groups = { cgA }

  it('hasParents returns true when person is in any childGroup', () => {
    expect(hasParents('kid1' as PersonId, groups)).toBe(true)
  })

  it('hasParents returns false when person is not a child', () => {
    expect(hasParents('outsider' as PersonId, groups)).toBe(false)
  })

  it('getChildGroupOf returns the matching group', () => {
    expect(getChildGroupOf('kid1' as PersonId, groups)?.id).toBe('cgA')
  })

  it('getChildGroupOf returns null when not a child', () => {
    expect(getChildGroupOf('outsider' as PersonId, groups)).toBeNull()
  })
})

describe('getChildrenOf', () => {
  it('returns children of the union, in order', () => {
    const cg: ChildGroup = {
      id: 'cg' as ChildGroupId,
      unionId: 'u1' as UnionId,
      children: [
        { kind: 'person', personId: 'a' as PersonId },
        { kind: 'person', personId: 'b' as PersonId },
      ],
    }
    expect(getChildrenOf('u1' as UnionId, { cg })).toEqual(cg.children)
  })

  it('returns empty array when no group for union', () => {
    expect(getChildrenOf('uX' as UnionId, {})).toEqual([])
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

Append to `computed.ts`:

```ts
import type { ChildEntry, ChildGroup, ChildGroupId, PersonId, UnionId } from '../types/domain'

export function getChildGroupOf(
  personId: PersonId,
  childGroups: Record<ChildGroupId, ChildGroup>,
): ChildGroup | null {
  for (const cg of Object.values(childGroups)) {
    if (cg.children.some((c) => c.kind === 'person' && c.personId === personId)) return cg
  }
  return null
}

export function hasParents(
  personId: PersonId,
  childGroups: Record<ChildGroupId, ChildGroup>,
): boolean {
  return getChildGroupOf(personId, childGroups) !== null
}

export function getChildrenOf(
  unionId: UnionId,
  childGroups: Record<ChildGroupId, ChildGroup>,
): ChildEntry[] {
  for (const cg of Object.values(childGroups)) {
    if (cg.unionId === unionId) return cg.children
  }
  return []
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/model/computed.ts packages/genogram/src/model/computed.test.ts
git commit -m "feat(genogram): add hasParents/getChildGroupOf/getChildrenOf"
```

---

### Task 9: Partner helpers (getBaseOf, getPartnersOf, countPartnersOf, shouldShowPartnerOrder)

**Files:**

- Modify: `packages/genogram/src/model/computed.ts`
- Modify: `packages/genogram/src/model/computed.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
import { getBaseOf, getPartnersOf, countPartnersOf, shouldShowPartnerOrder } from './computed'
import type { Union, UnionId } from '../types/domain'

describe('partner helpers', () => {
  const owner: Person = personWith({})
  owner.id = 'owner' as PersonId
  const wife1: Person = personWith({})
  wife1.id = 'w1' as PersonId
  wife1.sex = 'female'
  wife1.partnerOrder = 1
  const wife2: Person = personWith({})
  wife2.id = 'w2' as PersonId
  wife2.sex = 'female'
  wife2.partnerOrder = 2

  const u1: Union = {
    id: 'u1' as UnionId,
    kind: 'marriage',
    malePartnerId: 'owner' as PersonId,
    femalePartnerId: 'w1' as PersonId,
  }
  const u2: Union = {
    id: 'u2' as UnionId,
    kind: 'marriage',
    malePartnerId: 'owner' as PersonId,
    femalePartnerId: 'w2' as PersonId,
  }
  const unions = { u1, u2 }
  const people = { owner, w1: wife1, w2: wife2 }

  it('getBaseOf returns the other side when partner has 1 union', () => {
    expect(getBaseOf('w1' as PersonId, unions)).toBe('owner')
  })

  it('getBaseOf returns null when person has 2+ unions (is the central one)', () => {
    expect(getBaseOf('owner' as PersonId, unions)).toBeNull()
  })

  it('getPartnersOf returns partners sorted by partnerOrder', () => {
    const partners = getPartnersOf('owner' as PersonId, unions, people)
    expect(partners.map((p) => p.partnerId)).toEqual(['w1', 'w2'])
  })

  it('countPartnersOf returns count', () => {
    expect(countPartnersOf('owner' as PersonId, unions)).toBe(2)
    expect(countPartnersOf('w1' as PersonId, unions)).toBe(1)
  })

  it('shouldShowPartnerOrder returns true for partner of base with >1 partners', () => {
    expect(shouldShowPartnerOrder('w1' as PersonId, people, unions)).toBe(true)
  })

  it('shouldShowPartnerOrder returns false for base itself', () => {
    expect(shouldShowPartnerOrder('owner' as PersonId, people, unions)).toBe(false)
  })

  it('shouldShowPartnerOrder returns false when single partner', () => {
    const onlyOne = { u1 }
    expect(shouldShowPartnerOrder('w1' as PersonId, people, onlyOne)).toBe(false)
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

Append to `computed.ts`:

```ts
import type { Union, UnionId } from '../types/domain'

function unionsOfPerson(personId: PersonId, unions: Record<UnionId, Union>): Union[] {
  return Object.values(unions).filter(
    (u) => u.malePartnerId === personId || u.femalePartnerId === personId,
  )
}

export function getBaseOf(partnerId: PersonId, unions: Record<UnionId, Union>): PersonId | null {
  const own = unionsOfPerson(partnerId, unions)
  if (own.length !== 1) return null
  const u = own[0]!
  return u.malePartnerId === partnerId ? u.femalePartnerId : u.malePartnerId
}

export function getPartnersOf(
  basePersonId: PersonId,
  unions: Record<UnionId, Union>,
  people: Record<PersonId, Person>,
): { unionId: UnionId; partnerId: PersonId; partnerOrder?: number }[] {
  const own = unionsOfPerson(basePersonId, unions)
  return own
    .map((u) => {
      const partnerId = u.malePartnerId === basePersonId ? u.femalePartnerId : u.malePartnerId
      const partnerOrder = people[partnerId]?.partnerOrder
      return { unionId: u.id, partnerId, partnerOrder }
    })
    .sort((a, b) => {
      if (a.partnerOrder === undefined) return 1
      if (b.partnerOrder === undefined) return -1
      return a.partnerOrder - b.partnerOrder
    })
}

export function countPartnersOf(personId: PersonId, unions: Record<UnionId, Union>): number {
  return unionsOfPerson(personId, unions).length
}

export function shouldShowPartnerOrder(
  personId: PersonId,
  people: Record<PersonId, Person>,
  unions: Record<UnionId, Union>,
): boolean {
  const baseId = getBaseOf(personId, unions)
  if (!baseId) return false
  return countPartnersOf(baseId, unions) > 1
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/model/computed.ts packages/genogram/src/model/computed.test.ts
git commit -m "feat(genogram): add partner helpers (getBaseOf, getPartnersOf, etc.)"
```

---

## Phase 4 — Yjs Schema and Actions

### Task 10: Add meta map to Yjs schema and getMeta/setMeta

**Files:**

- Modify: `packages/genogram/src/yjs/schema.ts`
- Modify: `packages/genogram/src/yjs/actions.ts`
- Modify: `packages/genogram/src/yjs/actions.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/genogram/src/yjs/actions.test.ts`:

```ts
import { getMeta, setMeta } from './actions'

describe('meta', () => {
  it('returns null when meta empty', () => {
    const doc = new Y.Doc()
    expect(getMeta(doc)).toBeNull()
  })

  it('roundtrips createdAt and ownerId', () => {
    const doc = new Y.Doc()
    setMeta(doc, { createdAt: '2026-04-27T00:00:00Z', ownerId: 'p1' as PersonId })
    expect(getMeta(doc)).toEqual({ createdAt: '2026-04-27T00:00:00Z', ownerId: 'p1' })
  })
})
```

`PersonId` import should already exist in this file.

- [ ] **Step 2: Run, confirm fail**

```bash
pnpm --filter @repo/genogram test src/yjs/actions.test.ts
```

- [ ] **Step 3: Add meta map to schema**

Edit `packages/genogram/src/yjs/schema.ts`. Add:

```ts
export const META_MAP = 'genogram.meta'

export function getMetaMap(doc: Y.Doc): Y.Map<string> {
  return doc.getMap<string>(META_MAP)
}
```

(Adapt to existing schema.ts conventions; the goal is to expose a typed accessor for the meta Y.Map.)

- [ ] **Step 4: Implement getMeta/setMeta in actions.ts**

Add to `packages/genogram/src/yjs/actions.ts`:

```ts
import type { GenogramMeta, PersonId } from '../types/domain'
import { getMetaMap } from './schema'

export function getMeta(doc: Y.Doc): GenogramMeta | null {
  const map = getMetaMap(doc)
  const createdAt = map.get('createdAt')
  const ownerId = map.get('ownerId') as PersonId | undefined
  if (!createdAt || !ownerId) return null
  return { createdAt, ownerId }
}

export function setMeta(doc: Y.Doc, meta: GenogramMeta): void {
  doc.transact(() => {
    const map = getMetaMap(doc)
    map.set('createdAt', meta.createdAt)
    map.set('ownerId', meta.ownerId)
  })
}
```

- [ ] **Step 5: Run, confirm pass**

```bash
pnpm --filter @repo/genogram test src/yjs/actions.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/genogram/src/yjs/schema.ts packages/genogram/src/yjs/actions.ts packages/genogram/src/yjs/actions.test.ts
git commit -m "feat(genogram): add genogram.meta Y.Map with getMeta/setMeta"
```

---

### Task 11: createOwnerWithParents

**Files:**

- Modify: `packages/genogram/src/yjs/actions.ts`
- Modify: `packages/genogram/src/yjs/actions.test.ts`

- [ ] **Step 1: Write failing tests**

Add:

```ts
import { createOwnerWithParents, getMeta } from './actions'

describe('createOwnerWithParents', () => {
  it('creates owner + father + mother + union + childGroup; sets meta', () => {
    const doc = new Y.Doc()
    const result = createOwnerWithParents(doc, {
      firstName: 'Иван',
      lastName: 'Иванов',
      sex: 'male',
      birthDate: { day: 5, month: 3, year: 1984 },
    })

    const domain = assembleDomain(doc)
    const owner = domain.entities.people[result.ownerId]!
    expect(owner.role).toBe('owner')
    expect(owner.size).toBe('big')
    expect(owner.sex).toBe('male')
    expect(owner.identity.firstName).toBe('Иван')
    expect(owner.lifeDates.lifeStatus).toBe('alive')
    expect(owner.lifeDates.birthDate).toEqual({ day: 5, month: 3, year: 1984 })

    const father = domain.entities.people[result.fatherId]!
    expect(father.role).toBe('regular')
    expect(father.sex).toBe('male')
    expect(father.identity.isUnknown).toBe(true)
    expect(father.lifeDates.lifeStatus).toBe('unknown')

    const mother = domain.entities.people[result.motherId]!
    expect(mother.sex).toBe('female')
    expect(mother.identity.isUnknown).toBe(true)

    const union = domain.entities.unions[result.unionId]!
    expect(union.kind).toBe('marriage')
    expect(union.malePartnerId).toBe(result.fatherId)
    expect(union.femalePartnerId).toBe(result.motherId)

    const cg = domain.entities.childGroups[result.childGroupId]!
    expect(cg.unionId).toBe(result.unionId)
    expect(cg.children).toHaveLength(1)
    expect(cg.children[0]).toEqual({ kind: 'person', personId: result.ownerId })

    const meta = getMeta(doc)
    expect(meta?.ownerId).toBe(result.ownerId)
    expect(meta?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('female owner produces female owner shape', () => {
    const doc = new Y.Doc()
    const result = createOwnerWithParents(doc, { sex: 'female' })
    expect(assembleDomain(doc).entities.people[result.ownerId]!.sex).toBe('female')
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

Add to `actions.ts`:

```ts
import type { ChildGroupId, PartialDate, Sex, UnionId } from '../types/domain'

export interface OwnerDataDraft {
  firstName?: string
  lastName?: string
  middleName?: string
  sex: Sex
  birthDate?: PartialDate
}

export function createOwnerWithParents(
  doc: Y.Doc,
  draft: OwnerDataDraft,
): {
  ownerId: PersonId
  fatherId: PersonId
  motherId: PersonId
  unionId: UnionId
  childGroupId: ChildGroupId
} {
  let result!: ReturnType<typeof createOwnerWithParents>
  doc.transact(() => {
    const owner = addPerson(doc, {
      sex: draft.sex,
      bloodRelation: 'direct',
      role: 'owner',
      size: 'big',
      identity: {
        firstName: draft.firstName,
        lastName: draft.lastName,
        middleName: draft.middleName,
      },
      lifeDates: {
        birthMode: 'date',
        lifeStatus: 'alive',
        birthDate: draft.birthDate,
      },
      profile: {},
    })
    const father = addPerson(doc, {
      sex: 'male',
      bloodRelation: 'direct',
      role: 'regular',
      size: 'big',
      identity: { isUnknown: true },
      lifeDates: { birthMode: 'date', lifeStatus: 'unknown' },
      profile: {},
    })
    const mother = addPerson(doc, {
      sex: 'female',
      bloodRelation: 'direct',
      role: 'regular',
      size: 'big',
      identity: { isUnknown: true },
      lifeDates: { birthMode: 'date', lifeStatus: 'unknown' },
      profile: {},
    })
    const union = addUnion(doc, {
      kind: 'marriage',
      malePartnerId: father.id,
      femalePartnerId: mother.id,
    })
    const cg = addChildGroup(doc, { unionId: union.id })
    appendChild(doc, cg.id, { kind: 'person', personId: owner.id })

    setMeta(doc, { createdAt: new Date().toISOString(), ownerId: owner.id })
    result = {
      ownerId: owner.id,
      fatherId: father.id,
      motherId: mother.id,
      unionId: union.id,
      childGroupId: cg.id,
    }
  })
  return result
}
```

If `addPerson` does not currently accept the full Person shape with `identity`, `lifeDates`, `profile`, adapt the call to existing API (look at existing `actions.ts` to see input shape) — the goal is to materialize a Person with the documented fields.

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/yjs/actions.ts packages/genogram/src/yjs/actions.test.ts
git commit -m "feat(genogram): createOwnerWithParents composes owner + parents + union + meta"
```

---

### Task 12: addParents (with hasParents guard)

**Files:**

- Modify: `packages/genogram/src/yjs/actions.ts`
- Modify: `packages/genogram/src/yjs/actions.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { addParents } from './actions'

describe('addParents', () => {
  it('creates two unknown parents and a marriage union with the child', () => {
    const doc = new Y.Doc()
    const child = addPerson(doc, {
      sex: 'male',
      bloodRelation: 'direct',
      role: 'regular',
      size: 'big',
      identity: {},
      lifeDates: { birthMode: 'date', lifeStatus: 'alive' },
      profile: {},
    })
    const result = addParents(doc, child.id)

    const domain = assembleDomain(doc)
    expect(domain.entities.people[result.fatherId]!.sex).toBe('male')
    expect(domain.entities.people[result.motherId]!.sex).toBe('female')
    expect(domain.entities.unions[result.unionId]!.kind).toBe('marriage')
    const cg = domain.entities.childGroups[result.childGroupId]!
    expect(cg.children).toEqual([{ kind: 'person', personId: child.id }])
  })

  it('throws when child already has parents', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    expect(() => addParents(doc, owner.ownerId)).toThrow()
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```ts
import { hasParents } from '../model/computed'

export function addParents(
  doc: Y.Doc,
  childPersonId: PersonId,
): {
  fatherId: PersonId
  motherId: PersonId
  unionId: UnionId
  childGroupId: ChildGroupId
} {
  const domain = assembleDomain(doc)
  if (hasParents(childPersonId, domain.entities.childGroups)) {
    throw new Error(`Person ${childPersonId} already has parents`)
  }

  let result!: ReturnType<typeof addParents>
  doc.transact(() => {
    const father = addPerson(doc, {
      sex: 'male',
      bloodRelation: 'direct',
      role: 'regular',
      size: 'big',
      identity: { isUnknown: true },
      lifeDates: { birthMode: 'date', lifeStatus: 'unknown' },
      profile: {},
    })
    const mother = addPerson(doc, {
      sex: 'female',
      bloodRelation: 'direct',
      role: 'regular',
      size: 'big',
      identity: { isUnknown: true },
      lifeDates: { birthMode: 'date', lifeStatus: 'unknown' },
      profile: {},
    })
    const union = addUnion(doc, {
      kind: 'marriage',
      malePartnerId: father.id,
      femalePartnerId: mother.id,
    })
    const cg = addChildGroup(doc, { unionId: union.id })
    appendChild(doc, cg.id, { kind: 'person', personId: childPersonId })
    result = { fatherId: father.id, motherId: mother.id, unionId: union.id, childGroupId: cg.id }
  })
  return result
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/yjs/actions.ts packages/genogram/src/yjs/actions.test.ts
git commit -m "feat(genogram): addParents with hasParents guard"
```

---

### Task 13: addPartner with newPartnerOrder

**Files:**

- Modify: `packages/genogram/src/yjs/actions.ts`
- Modify: `packages/genogram/src/yjs/actions.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { addPartner } from './actions'

describe('addPartner', () => {
  it('creates partner with opposite sex and union (newPartnerOrder=1 → no ordinals)', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    const result = addPartner(
      doc,
      owner.ownerId,
      { firstName: 'Анна', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage', startDate: { day: 5, month: 6, year: 2020 } },
      1,
    )

    const domain = assembleDomain(doc)
    const partner = domain.entities.people[result.partnerId]!
    expect(partner.sex).toBe('female')
    expect(partner.partnerOrder).toBeUndefined()
    expect(domain.entities.unions[result.unionId]!.kind).toBe('marriage')
  })

  it('with newPartnerOrder=2 numbers existing partner=1 and new partner=2', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    const wife1 = addPartner(
      doc,
      owner.ownerId,
      { firstName: 'Анна', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' },
      1,
    )
    const wife2 = addPartner(
      doc,
      owner.ownerId,
      { firstName: 'Мария', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' },
      2,
    )

    const domain = assembleDomain(doc)
    expect(domain.entities.people[wife1.partnerId]!.partnerOrder).toBe(1)
    expect(domain.entities.people[wife2.partnerId]!.partnerOrder).toBe(2)
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```ts
import { getPartnersOf } from '../model/computed'

export interface PersonDataDraft {
  firstName?: string
  lastName?: string
  middleName?: string
  sex: Sex
  birthDate?: PartialDate
  birthMode: BirthMode
  approximateAge?: ApproximateAge
  lifeStatus: LifeStatus
  deathDate?: PartialDate
  tragically?: boolean
}

export interface UnionDraft {
  kind: UnionKind
  startDate?: PartialDate
  endDate?: PartialDate
  divorce?: UnionDivorce
}

export function addPartner(
  doc: Y.Doc,
  basePersonId: PersonId,
  personDraft: PersonDataDraft,
  unionDraft: UnionDraft,
  newPartnerOrder: number,
): { partnerId: PersonId; unionId: UnionId } {
  let result!: ReturnType<typeof addPartner>
  doc.transact(() => {
    const partner = addPerson(doc, {
      sex: personDraft.sex,
      bloodRelation: 'partner',
      role: 'regular',
      size: 'big',
      identity: {
        firstName: personDraft.firstName,
        lastName: personDraft.lastName,
        middleName: personDraft.middleName,
      },
      lifeDates: {
        birthMode: personDraft.birthMode,
        lifeStatus: personDraft.lifeStatus,
        birthDate: personDraft.birthDate,
        approximateAge: personDraft.approximateAge,
        deathDate: personDraft.deathDate,
        tragically: personDraft.tragically,
      },
      profile: {},
    })

    const malePartnerId = personDraft.sex === 'male' ? partner.id : basePersonId
    const femalePartnerId = personDraft.sex === 'female' ? partner.id : basePersonId
    const union = addUnion(doc, {
      kind: unionDraft.kind,
      malePartnerId,
      femalePartnerId,
      startDate: unionDraft.startDate,
      endDate: unionDraft.endDate,
      divorce: unionDraft.divorce,
    })

    if (newPartnerOrder > 1) {
      const domain = assembleDomain(doc)
      const partners = getPartnersOf(basePersonId, domain.entities.unions, domain.entities.people)
      partners.forEach((p, idx) => {
        const order = idx + 1
        if (p.partnerId === partner.id) return
        updatePerson(doc, p.partnerId, { partnerOrder: order } as Partial<Person>)
      })
      updatePerson(doc, partner.id, { partnerOrder: newPartnerOrder } as Partial<Person>)
    }

    result = { partnerId: partner.id, unionId: union.id }
  })
  return result
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/yjs/actions.ts packages/genogram/src/yjs/actions.test.ts
git commit -m "feat(genogram): addPartner with auto-numbering of multi-partner ordinals"
```

---

### Task 14: setPartnerOrder

**Files:**

- Modify: `packages/genogram/src/yjs/actions.ts`
- Modify: `packages/genogram/src/yjs/actions.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { setPartnerOrder } from './actions'

describe('setPartnerOrder', () => {
  it('swaps partner ordinals when moving partner #1 to #2', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    const w1 = addPartner(
      doc,
      owner.ownerId,
      { firstName: 'Анна', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' },
      1,
    )
    const w2 = addPartner(
      doc,
      owner.ownerId,
      { firstName: 'Мария', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' },
      2,
    )

    setPartnerOrder(doc, w1.partnerId, 2)

    const domain = assembleDomain(doc)
    expect(domain.entities.people[w1.partnerId]!.partnerOrder).toBe(2)
    expect(domain.entities.people[w2.partnerId]!.partnerOrder).toBe(1)
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```ts
import { getBaseOf, getPartnersOf } from '../model/computed'

export function setPartnerOrder(doc: Y.Doc, partnerId: PersonId, newOrder: number): void {
  doc.transact(() => {
    const domain = assembleDomain(doc)
    const baseId = getBaseOf(partnerId, domain.entities.unions)
    if (!baseId) throw new Error(`${partnerId} is not a partner of a base person`)
    const partners = getPartnersOf(baseId, domain.entities.unions, domain.entities.people)
    const reordered = partners
      .filter((p) => p.partnerId !== partnerId)
      .sort((a, b) => (a.partnerOrder ?? 0) - (b.partnerOrder ?? 0))

    reordered.splice(newOrder - 1, 0, partners.find((p) => p.partnerId === partnerId)!)
    reordered.forEach((p, idx) => {
      updatePerson(doc, p.partnerId, { partnerOrder: idx + 1 } as Partial<Person>)
    })
  })
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/yjs/actions.ts packages/genogram/src/yjs/actions.test.ts
git commit -m "feat(genogram): setPartnerOrder with consistent renumbering"
```

---

### Task 15: addChildren

**Files:**

- Modify: `packages/genogram/src/yjs/actions.ts`
- Modify: `packages/genogram/src/yjs/actions.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { addChildren } from './actions'

describe('addChildren', () => {
  it('adds Person and PregnancyLoss entries to ChildGroup', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    const partner = addPartner(
      doc,
      owner.ownerId,
      { firstName: 'Анна', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' },
      1,
    )

    addChildren(doc, partner.unionId, [
      {
        type: 'person',
        data: { firstName: 'Лиза', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      },
      { type: 'miscarriage', date: { day: 5, month: 4, year: 2020 } },
    ])

    const domain = assembleDomain(doc)
    const childGroups = Object.values(domain.entities.childGroups)
    const cg = childGroups.find((c) => c.unionId === partner.unionId)!
    expect(cg.children).toHaveLength(2)
    expect(cg.children[0]!.kind).toBe('person')
    expect(cg.children[1]!.kind).toBe('loss')
  })

  it('reorders existing children when reorderExisting is provided', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    const partner = addPartner(
      doc,
      owner.ownerId,
      { firstName: 'Анна', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' },
      1,
    )

    addChildren(doc, partner.unionId, [
      {
        type: 'person',
        data: { firstName: 'A', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      },
      {
        type: 'person',
        data: { firstName: 'B', sex: 'male', lifeStatus: 'alive', birthMode: 'date' },
      },
    ])

    let domain = assembleDomain(doc)
    let cg = Object.values(domain.entities.childGroups).find((c) => c.unionId === partner.unionId)!
    const reversed = [...cg.children].reverse()

    addChildren(doc, partner.unionId, [], reversed)

    domain = assembleDomain(doc)
    cg = Object.values(domain.entities.childGroups).find((c) => c.unionId === partner.unionId)!
    expect(cg.children).toEqual(reversed)
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```ts
export type ChildEntryDraft =
  | { type: 'person'; data: PersonDataDraft }
  | { type: 'miscarriage' | 'abortion'; date?: PartialDate }

export function addChildren(
  doc: Y.Doc,
  unionId: UnionId,
  newEntries: ChildEntryDraft[],
  reorderExisting?: ChildEntry[],
): void {
  doc.transact(() => {
    const domain = assembleDomain(doc)
    let cg = Object.values(domain.entities.childGroups).find((c) => c.unionId === unionId)
    if (!cg) {
      cg = addChildGroup(doc, { unionId })
    }

    if (reorderExisting) {
      replaceChildren(doc, cg.id, reorderExisting)
    }

    for (const entry of newEntries) {
      if (entry.type === 'person') {
        const child = addPerson(doc, {
          sex: entry.data.sex,
          bloodRelation: 'direct',
          role: 'regular',
          size: 'small',
          identity: {
            firstName: entry.data.firstName,
            lastName: entry.data.lastName,
            middleName: entry.data.middleName,
          },
          lifeDates: {
            birthMode: entry.data.birthMode,
            lifeStatus: entry.data.lifeStatus,
            birthDate: entry.data.birthDate,
            approximateAge: entry.data.approximateAge,
            deathDate: entry.data.deathDate,
            tragically: entry.data.tragically,
          },
          profile: {},
        })
        appendChild(doc, cg.id, { kind: 'person', personId: child.id })
      } else {
        const loss = addPregnancyLoss(doc, {
          kind: entry.type,
          childGroupId: cg.id,
          date: entry.date,
        })
        appendChild(doc, cg.id, { kind: 'loss', lossId: loss.id })
      }
    }
  })
}

function replaceChildren(doc: Y.Doc, childGroupId: ChildGroupId, newOrder: ChildEntry[]): void {
  // Use existing child-group update API. If not present, replace via Y.Map.set on the
  // `childGroups` map: write the same group with new `children` array.
  const map = doc.getMap('genogram.childGroups') as Y.Map<ChildGroup>
  const cg = map.get(childGroupId)
  if (!cg) return
  map.set(childGroupId, { ...cg, children: newOrder })
}
```

(Adapt `replaceChildren` to existing schema conventions — there may already be `updateChildGroup` or similar; prefer existing helpers over manual Y.Map writes.)

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/yjs/actions.ts packages/genogram/src/yjs/actions.test.ts
git commit -m "feat(genogram): addChildren with optional reorderExisting"
```

---

### Task 16: setChildOrder

**Files:**

- Modify: `packages/genogram/src/yjs/actions.ts`
- Modify: `packages/genogram/src/yjs/actions.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { setChildOrder } from './actions'

describe('setChildOrder', () => {
  it('moves child to new position', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    const partner = addPartner(
      doc,
      owner.ownerId,
      { firstName: 'Анна', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' },
      1,
    )

    addChildren(doc, partner.unionId, [
      {
        type: 'person',
        data: { firstName: 'A', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      },
      {
        type: 'person',
        data: { firstName: 'B', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      },
      {
        type: 'person',
        data: { firstName: 'C', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      },
    ])

    let domain = assembleDomain(doc)
    let cg = Object.values(domain.entities.childGroups).find((c) => c.unionId === partner.unionId)!
    const cId = (cg.children[2] as { kind: 'person'; personId: PersonId }).personId

    setChildOrder(doc, cId, 1) // C → first

    domain = assembleDomain(doc)
    cg = Object.values(domain.entities.childGroups).find((c) => c.unionId === partner.unionId)!
    expect((cg.children[0] as { kind: 'person'; personId: PersonId }).personId).toBe(cId)
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```ts
import { getChildGroupOf } from '../model/computed'

export function setChildOrder(doc: Y.Doc, childPersonId: PersonId, newOrder: number): void {
  doc.transact(() => {
    const domain = assembleDomain(doc)
    const cg = getChildGroupOf(childPersonId, domain.entities.childGroups)
    if (!cg) throw new Error(`Person ${childPersonId} is not a child in any group`)

    const idx = cg.children.findIndex((c) => c.kind === 'person' && c.personId === childPersonId)
    if (idx === -1) throw new Error('inconsistent state')

    const next = [...cg.children]
    const [item] = next.splice(idx, 1)
    next.splice(newOrder - 1, 0, item!)
    replaceChildren(doc, cg.id, next)
  })
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/yjs/actions.ts packages/genogram/src/yjs/actions.test.ts
git commit -m "feat(genogram): setChildOrder reorders ChildGroup.children"
```

---

### Task 17: Verify updatePerson handles new LifeDates fields

**Files:**

- Modify: `packages/genogram/src/yjs/actions.ts` (only if needed)
- Modify: `packages/genogram/src/yjs/actions.test.ts`

- [ ] **Step 1: Write failing test**

```ts
describe('updatePerson — extended fields', () => {
  it('writes lifeStatus, tragically, birthMode, approximateAge, partial dates', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })

    updatePerson(doc, owner.ownerId, {
      lifeDates: {
        birthMode: 'approximate',
        lifeStatus: 'deceased',
        tragically: true,
        approximateAge: { kind: 'value', value: 50 },
        deathDate: { day: 1, month: 1, year: 2024 },
      },
      partnerOrder: 1,
    })

    const updated = assembleDomain(doc).entities.people[owner.ownerId]!
    expect(updated.lifeDates.lifeStatus).toBe('deceased')
    expect(updated.lifeDates.tragically).toBe(true)
    expect(updated.lifeDates.birthMode).toBe('approximate')
    expect(updated.lifeDates.approximateAge).toEqual({ kind: 'value', value: 50 })
    expect(updated.lifeDates.deathDate).toEqual({ day: 1, month: 1, year: 2024 })
    expect(updated.partnerOrder).toBe(1)
  })
})
```

- [ ] **Step 2: Run**

If `updatePerson` already does shallow merge of provided fields, this test passes immediately. If it strips unknown keys, expand it to accept the full new shape.

```bash
pnpm --filter @repo/genogram test src/yjs/actions.test.ts
```

- [ ] **Step 3: If failing, fix updatePerson to pass through new fields**

Inspect existing `updatePerson` implementation and ensure it supports patching `lifeDates` (with new shape) and `partnerOrder`. Probable existing pattern:

```ts
export function updatePerson(doc: Y.Doc, id: PersonId, patch: Partial<Person>): void {
  const map = doc.getMap('genogram.people') as Y.Map<Person>
  const current = map.get(id)
  if (!current) return
  doc.transact(() =>
    map.set(id, { ...current, ...patch, lifeDates: { ...current.lifeDates, ...patch.lifeDates } }),
  )
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit (only if changed)**

```bash
git add packages/genogram/src/yjs/actions.ts packages/genogram/src/yjs/actions.test.ts
git commit -m "test(genogram): updatePerson accepts extended LifeDates fields"
```

---

### Task 18: setUnionDivorce supports markPosition

**Files:**

- Modify: `packages/genogram/src/yjs/actions.ts`
- Modify: `packages/genogram/src/yjs/actions.test.ts`

- [ ] **Step 1: Write failing test**

```ts
describe('setUnionDivorce — markPosition', () => {
  it('persists markPosition independently of date', () => {
    const doc = new Y.Doc()
    const owner = createOwnerWithParents(doc, { sex: 'male' })
    const partner = addPartner(
      doc,
      owner.ownerId,
      { firstName: 'Анна', sex: 'female', lifeStatus: 'alive', birthMode: 'date' },
      { kind: 'marriage' },
      1,
    )

    setUnionDivorce(doc, partner.unionId, {
      date: { day: 1, month: 1, year: 2025 },
      markPosition: 0.7,
    })

    const u = assembleDomain(doc).entities.unions[partner.unionId]!
    expect(u.divorce?.markPosition).toBe(0.7)
    expect(u.divorce?.date).toEqual({ day: 1, month: 1, year: 2025 })
  })
})
```

- [ ] **Step 2: Run, confirm fail (or pass if already supported)**

- [ ] **Step 3: Adapt setUnionDivorce if needed**

Existing API likely accepts `Partial<UnionDivorce>` already; ensure `markPosition` flows through (no whitelist filter).

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit (if changed)**

```bash
git add packages/genogram/src/yjs/actions.ts packages/genogram/src/yjs/actions.test.ts
git commit -m "feat(genogram): setUnionDivorce persists markPosition"
```

---

## Phase 5 — Layout Updates

### Task 19: Layout — partner placement (single by sex; multi by partnerOrder)

**Files:**

- Modify: `packages/genogram/src/layout/placement.ts`
- Create: `packages/genogram/src/layout/placement.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { computeLayout } from './computeLayout'
// or directly from placement: import { placePartners } from './placement'
import type { GenogramPageData } from '../types/page'
// Use a small fixture builder in this test file.

describe('partner placement', () => {
  it('places single male partner left of female base', () => {
    const data = buildFixture({
      base: { id: 'b', sex: 'female' },
      partners: [{ id: 'p1', sex: 'male' }],
    })
    const layout = computeLayout(data)
    expect(layout.positions['p1']!.x).toBeLessThan(layout.positions['b']!.x)
  })

  it('places single female partner right of male base', () => {
    const data = buildFixture({
      base: { id: 'b', sex: 'male' },
      partners: [{ id: 'p1', sex: 'female' }],
    })
    const layout = computeLayout(data)
    expect(layout.positions['p1']!.x).toBeGreaterThan(layout.positions['b']!.x)
  })

  it('orders 3 partners by partnerOrder ascending left-to-right', () => {
    const data = buildFixture({
      base: { id: 'b', sex: 'male' },
      partners: [
        { id: 'p1', sex: 'female', partnerOrder: 1 },
        { id: 'p2', sex: 'female', partnerOrder: 2 },
        { id: 'p3', sex: 'female', partnerOrder: 3 },
      ],
    })
    const layout = computeLayout(data)
    expect(layout.positions['p1']!.x).toBeLessThan(layout.positions['p2']!.x)
    expect(layout.positions['p2']!.x).toBeLessThan(layout.positions['p3']!.x)
  })

  it('all partners on same Y as base (one hierarchy line)', () => {
    const data = buildFixture({
      base: { id: 'b', sex: 'male' },
      partners: [
        { id: 'p1', sex: 'female', partnerOrder: 1 },
        { id: 'p2', sex: 'female', partnerOrder: 2 },
      ],
    })
    const layout = computeLayout(data)
    expect(layout.positions['p1']!.y).toBe(layout.positions['b']!.y)
    expect(layout.positions['p2']!.y).toBe(layout.positions['b']!.y)
  })
})

// fixture helper — minimal GenogramPageData with people + unions
function buildFixture(args: {
  base: { id: string; sex: 'male' | 'female' }
  partners: { id: string; sex: 'male' | 'female'; partnerOrder?: number }[]
}): GenogramPageData {
  // Construct people record + unions per partner; full helper code provided in spec section "computed helpers".
  // ...
}
```

If the existing `computeLayout` doesn't yet handle partner ordering, tests will fail. We'll fix `placement.ts`.

- [ ] **Step 2: Run, confirm fail**

```bash
pnpm --filter @repo/genogram test src/layout/placement.test.ts
```

- [ ] **Step 3: Update placement logic**

Read `packages/genogram/src/layout/placement.ts`. Find where partners are placed relative to base. Replace with:

```ts
function placePartnersForBase(
  baseId: PersonId,
  base: Person,
  domain: GenogramPageData,
  positions: Record<string, { x: number; y: number }>,
): void {
  const partners = getPartnersOf(baseId, domain.entities.unions, domain.entities.people)
  if (partners.length === 0) return

  const baseX = positions[baseId]!.x
  const baseY = positions[baseId]!.y
  const gap = LAYOUT.PARTNER_GAP ?? 140

  if (partners.length === 1) {
    const p = partners[0]!
    const partnerSex = domain.entities.people[p.partnerId]!.sex
    const dx = partnerSex === 'male' ? -gap : +gap
    positions[p.partnerId] = { x: baseX + dx, y: baseY }
    return
  }

  partners.sort((a, b) => (a.partnerOrder ?? 999) - (b.partnerOrder ?? 999))
  const total = partners.length
  partners.forEach((p, idx) => {
    const offset = (idx - (total - 1) / 2) * gap
    positions[p.partnerId] = { x: baseX + offset, y: baseY }
  })
}
```

Add `LAYOUT.PARTNER_GAP` to `packages/genogram/src/layout/constants.ts`.

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/layout/placement.ts packages/genogram/src/layout/placement.test.ts packages/genogram/src/layout/constants.ts
git commit -m "feat(genogram): partner placement by sex (single) and partnerOrder (multi)"
```

---

### Task 20: Layout — children by ChildGroup.children order

**Files:**

- Modify: `packages/genogram/src/layout/placement.ts`
- Modify: `packages/genogram/src/layout/placement.test.ts`

- [ ] **Step 1: Write failing test**

```ts
describe('children placement', () => {
  it('places children left-to-right in ChildGroup.children order', () => {
    const data = buildFixtureWithChildren({
      father: 'f',
      mother: 'm',
      children: ['c1', 'c2', 'c3'], // in this order
    })
    const layout = computeLayout(data)
    expect(layout.positions['c1']!.x).toBeLessThan(layout.positions['c2']!.x)
    expect(layout.positions['c2']!.x).toBeLessThan(layout.positions['c3']!.x)
  })
})
```

- [ ] **Step 2: Run, confirm fail (or pass if already correct)**

- [ ] **Step 3: Update if needed**

If `placement.ts` doesn't honor `ChildGroup.children` order, fix it:

```ts
const children = childGroup.children
children.forEach((entry, idx) => {
  const offset = (idx - (children.length - 1) / 2) * LAYOUT.CHILD_GAP
  if (entry.kind === 'person') {
    positions[entry.personId] = { x: childGroupX + offset, y: childRowY }
  } else {
    positions[entry.lossId] = { x: childGroupX + offset, y: childRowY }
  }
})
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/layout/placement.ts packages/genogram/src/layout/placement.test.ts
git commit -m "feat(genogram): children placement honors ChildGroup.children order"
```

---

## Phase 6 — UI Primitives

### Task 21: SexToggle and LifeStatusToggle

**Files:**

- Create: `packages/genogram/src/forms/primitives/SexToggle.tsx`
- Create: `packages/genogram/src/forms/primitives/SexToggle.test.tsx`
- Create: `packages/genogram/src/forms/primitives/LifeStatusToggle.tsx`
- Create: `packages/genogram/src/forms/primitives/LifeStatusToggle.test.tsx`

- [ ] **Step 1: Write failing test for SexToggle**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SexToggle } from './SexToggle'

describe('SexToggle', () => {
  it('renders both options and highlights value', () => {
    render(<SexToggle value="male" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Мужской' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Женский' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onChange when other option clicked', async () => {
    const onChange = vi.fn()
    render(<SexToggle value="male" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Женский' }))
    expect(onChange).toHaveBeenCalledWith('female')
  })

  it('does not call onChange when current option clicked', async () => {
    const onChange = vi.fn()
    render(<SexToggle value="male" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Мужской' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run, confirm fail**

```bash
pnpm --filter @repo/genogram test src/forms/primitives/SexToggle.test.tsx
```

- [ ] **Step 3: Implement SexToggle**

```tsx
import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { Sex } from '../../types/domain'
import { RU } from '../../i18n/ru'

interface Props {
  value: Sex
  onChange: (next: Sex) => void
}

export function SexToggle({ value, onChange }: Props) {
  return (
    <ToggleButtonGroup
      exclusive
      value={value}
      onChange={(_e, next: Sex | null) => {
        if (next && next !== value) onChange(next)
      }}
    >
      <ToggleButton value="male">{RU.fields.sexMale}</ToggleButton>
      <ToggleButton value="female">{RU.fields.sexFemale}</ToggleButton>
    </ToggleButtonGroup>
  )
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Repeat for LifeStatusToggle**

Test:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LifeStatusToggle } from './LifeStatusToggle'

describe('LifeStatusToggle', () => {
  it('renders three options', () => {
    render(<LifeStatusToggle value="alive" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Жив' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Умер' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Неизвестно' })).toBeInTheDocument()
  })

  it('calls onChange', async () => {
    const onChange = vi.fn()
    render(<LifeStatusToggle value="alive" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Умер' }))
    expect(onChange).toHaveBeenCalledWith('deceased')
  })
})
```

Implementation:

```tsx
import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { LifeStatus } from '../../types/domain'
import { RU } from '../../i18n/ru'

interface Props {
  value: LifeStatus
  onChange: (next: LifeStatus) => void
}

export function LifeStatusToggle({ value, onChange }: Props) {
  return (
    <ToggleButtonGroup
      exclusive
      value={value}
      onChange={(_e, next: LifeStatus | null) => {
        if (next && next !== value) onChange(next)
      }}
    >
      <ToggleButton value="alive">{RU.fields.alive}</ToggleButton>
      <ToggleButton value="deceased">{RU.fields.deceased}</ToggleButton>
      <ToggleButton value="unknown">{RU.fields.unknown}</ToggleButton>
    </ToggleButtonGroup>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/genogram/src/forms/primitives/SexToggle.tsx packages/genogram/src/forms/primitives/SexToggle.test.tsx packages/genogram/src/forms/primitives/LifeStatusToggle.tsx packages/genogram/src/forms/primitives/LifeStatusToggle.test.tsx
git commit -m "feat(genogram): SexToggle + LifeStatusToggle primitives"
```

---

### Task 22: PartialDateInput

**Files:**

- Create: `packages/genogram/src/forms/primitives/PartialDateInput.tsx`
- Create: `packages/genogram/src/forms/primitives/PartialDateInput.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PartialDateInput } from './PartialDateInput'

describe('PartialDateInput', () => {
  it('renders three independent fields', () => {
    render(<PartialDateInput value={{}} onChange={() => {}} />)
    expect(screen.getByLabelText('День')).toBeInTheDocument()
    expect(screen.getByLabelText('Месяц')).toBeInTheDocument()
    expect(screen.getByLabelText('Год')).toBeInTheDocument()
  })

  it('emits onChange when day changes', async () => {
    const onChange = vi.fn()
    render(<PartialDateInput value={{}} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('День'), '15')
    expect(onChange).toHaveBeenLastCalledWith({ day: 15 })
  })

  it('clears field on empty input', async () => {
    const onChange = vi.fn()
    render(<PartialDateInput value={{ day: 15 }} onChange={onChange} />)
    await userEvent.clear(screen.getByLabelText('День'))
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('preserves other fields on partial update', async () => {
    const onChange = vi.fn()
    render(<PartialDateInput value={{ year: 2020 }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('День'), '1')
    expect(onChange).toHaveBeenLastCalledWith({ day: 1, year: 2020 })
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```tsx
import { MenuItem, Stack, TextField } from '@mui/material'
import type { PartialDate } from '../../types/domain'

interface Props {
  value: PartialDate
  onChange: (next: PartialDate) => void
  label?: string
}

const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
]

export function PartialDateInput({ value, onChange, label }: Props) {
  const update = (patch: Partial<PartialDate>) => {
    const next: PartialDate = { ...value, ...patch }
    Object.keys(next).forEach((k) => {
      if ((next as Record<string, unknown>)[k] === undefined) {
        delete (next as Record<string, unknown>)[k]
      }
    })
    onChange(next)
  }

  return (
    <Stack spacing={1}>
      {label && <span>{label}</span>}
      <Stack direction="row" spacing={1}>
        <TextField
          label="День"
          type="number"
          size="small"
          value={value.day ?? ''}
          inputProps={{ min: 1, max: 31 }}
          onChange={(e) => {
            const n = e.target.value === '' ? undefined : Number(e.target.value)
            update({ day: n })
          }}
        />
        <TextField
          select
          label="Месяц"
          size="small"
          value={value.month ?? ''}
          onChange={(e) => {
            const n = e.target.value === '' ? undefined : Number(e.target.value)
            update({ month: n })
          }}
          sx={{ minWidth: 120 }}
        >
          <MenuItem value="">—</MenuItem>
          {MONTHS.map((m, idx) => (
            <MenuItem key={idx} value={idx + 1}>
              {m}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Год"
          type="number"
          size="small"
          value={value.year ?? ''}
          inputProps={{ min: 1700, max: 2200 }}
          onChange={(e) => {
            const n = e.target.value === '' ? undefined : Number(e.target.value)
            update({ year: n })
          }}
        />
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/forms/primitives/PartialDateInput.tsx packages/genogram/src/forms/primitives/PartialDateInput.test.tsx
git commit -m "feat(genogram): PartialDateInput primitive (day/month/year independent)"
```

---

### Task 23: ApproximateAgeInput

**Files:**

- Create: `packages/genogram/src/forms/primitives/ApproximateAgeInput.tsx`
- Create: `packages/genogram/src/forms/primitives/ApproximateAgeInput.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApproximateAgeInput } from './ApproximateAgeInput'

describe('ApproximateAgeInput', () => {
  it('starts in single-value mode and emits {kind:"value"}', async () => {
    const onChange = vi.fn()
    render(<ApproximateAgeInput value={undefined} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Возраст'), '42')
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'value', value: 42 })
  })

  it('switches to range and emits {kind:"range"}', async () => {
    const onChange = vi.fn()
    render(<ApproximateAgeInput value={undefined} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Диапазон' }))
    await userEvent.type(screen.getByLabelText('От'), '30')
    await userEvent.type(screen.getByLabelText('До'), '35')
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'range', from: 30, to: 35 })
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react'
import { Stack, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { ApproximateAge } from '../../types/domain'
import { RU } from '../../i18n/ru'

interface Props {
  value: ApproximateAge | undefined
  onChange: (next: ApproximateAge | undefined) => void
}

export function ApproximateAgeInput({ value, onChange }: Props) {
  const [mode, setMode] = useState<'single' | 'range'>(value?.kind === 'range' ? 'range' : 'single')

  return (
    <Stack spacing={1}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={mode}
        onChange={(_e, next: 'single' | 'range' | null) => {
          if (next) {
            setMode(next)
            onChange(undefined)
          }
        }}
      >
        <ToggleButton value="single">{RU.fields.ageModeSingle}</ToggleButton>
        <ToggleButton value="range">{RU.fields.ageModeRange}</ToggleButton>
      </ToggleButtonGroup>

      {mode === 'single' ? (
        <TextField
          label="Возраст"
          type="number"
          size="small"
          value={value?.kind === 'value' ? value.value : ''}
          inputProps={{ min: 0, max: 150 }}
          onChange={(e) => {
            const n = e.target.value === '' ? undefined : Number(e.target.value)
            onChange(n === undefined ? undefined : { kind: 'value', value: n })
          }}
        />
      ) : (
        <Stack direction="row" spacing={1}>
          <TextField
            label={RU.fields.ageFrom}
            type="number"
            size="small"
            value={value?.kind === 'range' ? value.from : ''}
            onChange={(e) => {
              const from = e.target.value === '' ? undefined : Number(e.target.value)
              const to = value?.kind === 'range' ? value.to : 0
              onChange(from === undefined ? undefined : { kind: 'range', from, to })
            }}
          />
          <TextField
            label={RU.fields.ageTo}
            type="number"
            size="small"
            value={value?.kind === 'range' ? value.to : ''}
            onChange={(e) => {
              const to = e.target.value === '' ? undefined : Number(e.target.value)
              const from = value?.kind === 'range' ? value.from : 0
              onChange(to === undefined ? undefined : { kind: 'range', from, to })
            }}
          />
        </Stack>
      )}
    </Stack>
  )
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/forms/primitives/ApproximateAgeInput.tsx packages/genogram/src/forms/primitives/ApproximateAgeInput.test.tsx
git commit -m "feat(genogram): ApproximateAgeInput with single/range modes"
```

---

## Phase 7 — Forms

### Task 24: OwnerDataForm

**Files:**

- Create: `packages/genogram/src/forms/OwnerDataForm.tsx`
- Create: `packages/genogram/src/forms/OwnerDataForm.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OwnerDataForm } from './OwnerDataForm'

describe('OwnerDataForm', () => {
  it('mode=create — submit emits owner draft with sex', async () => {
    const onSubmit = vi.fn()
    render(
      <OwnerDataForm
        mode="create"
        initial={{ sex: 'male' }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )

    await userEvent.type(screen.getByLabelText('Фамилия'), 'Иванов')
    await userEvent.type(screen.getByLabelText('Имя'), 'Иван')
    await userEvent.click(screen.getByRole('button', { name: 'Создать генограмму' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        lastName: 'Иванов',
        firstName: 'Иван',
        sex: 'male',
      }),
    )
  })

  it('mode=edit — submit emits patch', async () => {
    const onSubmit = vi.fn()
    render(
      <OwnerDataForm
        mode="edit"
        initial={{ firstName: 'Иван', sex: 'male' }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onSubmit).toHaveBeenCalled()
  })

  it('Cancel button calls onCancel', async () => {
    const onCancel = vi.fn()
    render(
      <OwnerDataForm
        mode="create"
        initial={{ sex: 'male' }}
        onSubmit={() => {}}
        onCancel={onCancel}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react'
import { Button, Stack, TextField } from '@mui/material'
import type { OwnerDataDraft } from '../yjs/actions'
import type { PartialDate } from '../types/domain'
import { SexToggle } from './primitives/SexToggle'
import { PartialDateInput } from './primitives/PartialDateInput'
import { RU } from '../i18n/ru'

interface Props {
  mode: 'create' | 'edit'
  initial: Partial<OwnerDataDraft>
  onSubmit: (draft: OwnerDataDraft) => void
  onCancel: () => void
}

export function OwnerDataForm({ mode, initial, onSubmit, onCancel }: Props) {
  const [draft, setDraft] = useState<OwnerDataDraft>({
    sex: initial.sex ?? 'male',
    firstName: initial.firstName,
    lastName: initial.lastName,
    middleName: initial.middleName,
    birthDate: initial.birthDate,
  })

  const update = <K extends keyof OwnerDataDraft>(k: K, v: OwnerDataDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  return (
    <Stack spacing={2}>
      <TextField
        label={RU.fields.lastName}
        value={draft.lastName ?? ''}
        onChange={(e) => update('lastName', e.target.value)}
      />
      <TextField
        label={RU.fields.firstName}
        value={draft.firstName ?? ''}
        onChange={(e) => update('firstName', e.target.value)}
      />
      <TextField
        label={RU.fields.middleName}
        value={draft.middleName ?? ''}
        onChange={(e) => update('middleName', e.target.value)}
      />
      <SexToggle value={draft.sex} onChange={(v) => update('sex', v)} />
      <PartialDateInput
        label={RU.fields.birthDate}
        value={draft.birthDate ?? {}}
        onChange={(v: PartialDate) => update('birthDate', Object.keys(v).length ? v : undefined)}
      />
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button onClick={onCancel}>{RU.drawer.cancel}</Button>
        <Button variant="contained" onClick={() => onSubmit(draft)}>
          {mode === 'create' ? RU.drawer.create : RU.drawer.save}
        </Button>
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/forms/OwnerDataForm.tsx packages/genogram/src/forms/OwnerDataForm.test.tsx
git commit -m "feat(genogram): OwnerDataForm (create + edit modes)"
```

---

### Task 25: PersonDataForm (basic fields)

**Files:**

- Create: `packages/genogram/src/forms/PersonDataForm.tsx`
- Create: `packages/genogram/src/forms/PersonDataForm.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PersonDataForm } from './PersonDataForm'

describe('PersonDataForm — basic', () => {
  it('shows birthDate field by default', () => {
    render(<PersonDataForm initial={{ sex: 'male' }} onSubmit={() => {}} onCancel={() => {}} />)
    expect(screen.getByLabelText('Месяц')).toBeInTheDocument()
  })

  it('switches to ApproximateAgeInput when "Приблизительный возраст" toggled', async () => {
    render(<PersonDataForm initial={{ sex: 'male' }} onSubmit={() => {}} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Приблизительный возраст' }))
    expect(screen.queryByLabelText('Месяц')).not.toBeInTheDocument()
  })

  it('shows deathDate + tragically when "Умер" selected', async () => {
    render(<PersonDataForm initial={{ sex: 'male' }} onSubmit={() => {}} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Умер' }))
    // PartialDateInput labelled "Дата смерти" renders three sub-fields (День, Месяц, Год).
    // Verify presence of label text + checkbox.
    expect(screen.getByText('Дата смерти')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Трагически' })).toBeInTheDocument()
  })

  it('hides death fields when not "Умер"', () => {
    render(<PersonDataForm initial={{ sex: 'male' }} onSubmit={() => {}} onCancel={() => {}} />)
    expect(screen.queryByRole('checkbox', { name: 'Трагически' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react'
import {
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material'
import type { PersonDataDraft } from '../yjs/actions'
import type { ApproximateAge, BirthMode, LifeStatus, PartialDate } from '../types/domain'
import { SexToggle } from './primitives/SexToggle'
import { LifeStatusToggle } from './primitives/LifeStatusToggle'
import { PartialDateInput } from './primitives/PartialDateInput'
import { ApproximateAgeInput } from './primitives/ApproximateAgeInput'
import { RU } from '../i18n/ru'

interface Props {
  initial: Partial<PersonDataDraft>
  onSubmit: (draft: PersonDataDraft) => void
  onCancel: () => void
  submitLabel?: string
}

export function PersonDataForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel = RU.drawer.save,
}: Props) {
  const [draft, setDraft] = useState<PersonDataDraft>({
    sex: initial.sex ?? 'male',
    birthMode: initial.birthMode ?? 'date',
    lifeStatus: initial.lifeStatus ?? 'unknown',
    firstName: initial.firstName,
    lastName: initial.lastName,
    middleName: initial.middleName,
    birthDate: initial.birthDate,
    approximateAge: initial.approximateAge,
    deathDate: initial.deathDate,
    tragically: initial.tragically,
  })

  const update = <K extends keyof PersonDataDraft>(k: K, v: PersonDataDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  return (
    <Stack spacing={2}>
      <TextField
        label={RU.fields.lastName}
        value={draft.lastName ?? ''}
        onChange={(e) => update('lastName', e.target.value)}
      />
      <TextField
        label={RU.fields.firstName}
        value={draft.firstName ?? ''}
        onChange={(e) => update('firstName', e.target.value)}
      />
      <TextField
        label={RU.fields.middleName}
        value={draft.middleName ?? ''}
        onChange={(e) => update('middleName', e.target.value)}
      />

      <SexToggle value={draft.sex} onChange={(v) => update('sex', v)} />

      <ToggleButtonGroup
        exclusive
        value={draft.birthMode}
        onChange={(_e, next: BirthMode | null) => {
          if (next) update('birthMode', next)
        }}
      >
        <ToggleButton value="date">{RU.fields.birthDate}</ToggleButton>
        <ToggleButton value="approximate">{RU.fields.approximateAge}</ToggleButton>
      </ToggleButtonGroup>

      {draft.birthMode === 'date' ? (
        <PartialDateInput
          value={draft.birthDate ?? {}}
          onChange={(v: PartialDate) => update('birthDate', Object.keys(v).length ? v : undefined)}
        />
      ) : (
        <ApproximateAgeInput
          value={draft.approximateAge}
          onChange={(v: ApproximateAge | undefined) => update('approximateAge', v)}
        />
      )}

      <LifeStatusToggle
        value={draft.lifeStatus}
        onChange={(v: LifeStatus) => update('lifeStatus', v)}
      />

      {draft.lifeStatus === 'deceased' && (
        <>
          <PartialDateInput
            label={RU.fields.deathDate}
            value={draft.deathDate ?? {}}
            onChange={(v: PartialDate) =>
              update('deathDate', Object.keys(v).length ? v : undefined)
            }
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={draft.tragically === true}
                onChange={(e) => update('tragically', e.target.checked)}
              />
            }
            label={RU.fields.tragically}
          />
        </>
      )}

      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button onClick={onCancel}>{RU.drawer.cancel}</Button>
        <Button variant="contained" onClick={() => onSubmit(draft)}>
          {submitLabel}
        </Button>
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/forms/PersonDataForm.tsx packages/genogram/src/forms/PersonDataForm.test.tsx
git commit -m "feat(genogram): PersonDataForm with conditional birth/death/tragically fields"
```

---

### Task 26: PersonDataForm conditional ordinal fields

**Files:**

- Modify: `packages/genogram/src/forms/PersonDataForm.tsx`
- Modify: `packages/genogram/src/forms/PersonDataForm.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
describe('PersonDataForm — conditional ordinal fields', () => {
  it('shows "Укажите количество партнёров" only when context=add-partner', () => {
    const { rerender } = render(
      <PersonDataForm
        initial={{ sex: 'male' }}
        context={{ kind: 'add-partner', existingPartnersOfBase: 1 }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByLabelText(RU.fields.partnerCount)).toBeInTheDocument()

    rerender(
      <PersonDataForm
        initial={{ sex: 'male' }}
        context={{ kind: 'edit-data' }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.queryByLabelText(RU.fields.partnerCount)).not.toBeInTheDocument()
  })

  it('shows "Порядковый номер партнёра" only when editing partner of base with >1 partners', () => {
    render(
      <PersonDataForm
        initial={{ sex: 'female', partnerOrder: 1 }}
        context={{ kind: 'edit-data', isPartnerOfMultiBase: true, totalPartnersOfBase: 2 }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByLabelText(RU.fields.partnerOrder)).toBeInTheDocument()
  })

  it('shows "Порядковый номер ребёнка" only when editing a child', () => {
    render(
      <PersonDataForm
        initial={{ sex: 'female' }}
        context={{ kind: 'edit-data', isChild: true, childOrder: 1, siblingsCount: 3 }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByLabelText(RU.fields.childOrder)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Add `context` prop and conditional fields to PersonDataForm**

Extend the Props interface:

```tsx
type FormContext =
  | {
      kind: 'edit-data'
      isPartnerOfMultiBase?: boolean
      totalPartnersOfBase?: number
      isChild?: boolean
      childOrder?: number
      siblingsCount?: number
    }
  | { kind: 'add-partner'; existingPartnersOfBase: number }
  | { kind: 'add-child' }

interface Props {
  initial: Partial<PersonDataDraft & { partnerOrder?: number }>
  context: FormContext
  onSubmit: (
    draft: PersonDataDraft & { partnerOrder?: number; childOrder?: number; partnerCount?: number },
  ) => void
  onCancel: () => void
  submitLabel?: string
}
```

In the component body, render extra fields based on context. Default `partnerCount = existingPartnersOfBase + 1`. After collecting them in state, include in `onSubmit` payload.

```tsx
{
  context.kind === 'add-partner' && (
    <TextField
      label={RU.fields.partnerCount}
      type="number"
      inputProps={{ min: context.existingPartnersOfBase + 1 }}
      value={partnerCount}
      onChange={(e) => setPartnerCount(Number(e.target.value))}
    />
  )
}

{
  context.kind === 'edit-data' && context.isPartnerOfMultiBase && (
    <TextField
      label={RU.fields.partnerOrder}
      type="number"
      inputProps={{ min: 1, max: context.totalPartnersOfBase }}
      value={partnerOrder ?? ''}
      onChange={(e) => setPartnerOrder(Number(e.target.value))}
    />
  )
}

{
  context.kind === 'edit-data' && context.isChild && (
    <TextField
      label={RU.fields.childOrder}
      type="number"
      inputProps={{ min: 1, max: context.siblingsCount }}
      value={childOrder ?? ''}
      onChange={(e) => setChildOrder(Number(e.target.value))}
    />
  )
}
```

`partnerCount`, `partnerOrder`, `childOrder` are local state. Include them in the submit payload.

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/forms/PersonDataForm.tsx packages/genogram/src/forms/PersonDataForm.test.tsx
git commit -m "feat(genogram): PersonDataForm conditional partner/child ordinal fields"
```

---

### Task 27: MarriageRelationForm

**Files:**

- Create: `packages/genogram/src/forms/MarriageRelationForm.tsx`
- Create: `packages/genogram/src/forms/MarriageRelationForm.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MarriageRelationForm } from './MarriageRelationForm'

describe('MarriageRelationForm', () => {
  it('marriage default — shows wedding date and divorced checkbox', () => {
    render(
      <MarriageRelationForm
        initial={{ kind: 'marriage' }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('Дата свадьбы')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Брак расторгнут' })).toBeInTheDocument()
  })

  it('shows divorce date when divorced toggled', async () => {
    render(
      <MarriageRelationForm
        initial={{ kind: 'marriage' }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('checkbox', { name: 'Брак расторгнут' }))
    expect(screen.getByText('Дата развода')).toBeInTheDocument()
  })

  it('cohabitation — shows start date and ended checkbox', async () => {
    render(
      <MarriageRelationForm
        initial={{ kind: 'marriage' }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Отношения' }))
    expect(screen.getByText('Дата начала')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Отношения закончены' })).toBeInTheDocument()
  })

  it('submit emits union draft with divorce', async () => {
    const onSubmit = vi.fn()
    render(
      <MarriageRelationForm
        initial={{ kind: 'marriage' }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('checkbox', { name: 'Брак расторгнут' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'marriage',
        divorce: expect.any(Object),
      }),
    )
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react'
import {
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material'
import type { UnionDraft } from '../yjs/actions'
import type { PartialDate, UnionKind } from '../types/domain'
import { PartialDateInput } from './primitives/PartialDateInput'
import { RU } from '../i18n/ru'

interface Props {
  initial: Partial<UnionDraft>
  onSubmit: (draft: UnionDraft) => void
  onCancel: () => void
  submitLabel?: string
}

export function MarriageRelationForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel = RU.drawer.save,
}: Props) {
  const [kind, setKind] = useState<UnionKind>(initial.kind ?? 'marriage')
  const [startDate, setStartDate] = useState<PartialDate | undefined>(initial.startDate)
  const [endDate, setEndDate] = useState<PartialDate | undefined>(initial.endDate)
  const [divorced, setDivorced] = useState<boolean>(!!initial.divorce)
  const [divorceDate, setDivorceDate] = useState<PartialDate | undefined>(initial.divorce?.date)
  const [ended, setEnded] = useState<boolean>(!!initial.endDate && initial.kind === 'cohabitation')

  const submit = () => {
    if (kind === 'marriage') {
      onSubmit({
        kind: 'marriage',
        startDate,
        divorce: divorced
          ? { date: divorceDate, markPosition: initial.divorce?.markPosition }
          : undefined,
      })
    } else {
      onSubmit({
        kind: 'cohabitation',
        startDate,
        endDate: ended ? endDate : undefined,
      })
    }
  }

  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        exclusive
        value={kind}
        onChange={(_e, next: UnionKind | null) => {
          if (next) setKind(next)
        }}
      >
        <ToggleButton value="marriage">{RU.fields.marriage}</ToggleButton>
        <ToggleButton value="cohabitation">{RU.fields.cohabitation}</ToggleButton>
      </ToggleButtonGroup>

      {kind === 'marriage' ? (
        <>
          <PartialDateInput
            label={RU.fields.weddingDate}
            value={startDate ?? {}}
            onChange={(v) => setStartDate(Object.keys(v).length ? v : undefined)}
          />
          <FormControlLabel
            control={
              <Checkbox checked={divorced} onChange={(e) => setDivorced(e.target.checked)} />
            }
            label={RU.fields.divorced}
          />
          {divorced && (
            <PartialDateInput
              label={RU.fields.divorceDate}
              value={divorceDate ?? {}}
              onChange={(v) => setDivorceDate(Object.keys(v).length ? v : undefined)}
            />
          )}
        </>
      ) : (
        <>
          <PartialDateInput
            label={RU.fields.relationStartDate}
            value={startDate ?? {}}
            onChange={(v) => setStartDate(Object.keys(v).length ? v : undefined)}
          />
          <FormControlLabel
            control={<Checkbox checked={ended} onChange={(e) => setEnded(e.target.checked)} />}
            label={RU.fields.relationEnded}
          />
          {ended && (
            <PartialDateInput
              label={RU.fields.relationEndDate}
              value={endDate ?? {}}
              onChange={(v) => setEndDate(Object.keys(v).length ? v : undefined)}
            />
          )}
        </>
      )}

      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button onClick={onCancel}>{RU.drawer.cancel}</Button>
        <Button variant="contained" onClick={submit}>
          {submitLabel}
        </Button>
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/forms/MarriageRelationForm.tsx packages/genogram/src/forms/MarriageRelationForm.test.tsx
git commit -m "feat(genogram): MarriageRelationForm with marriage/cohabitation toggle"
```

---

### Task 28: ChildEntryRow

**Files:**

- Create: `packages/genogram/src/forms/ChildEntryRow.tsx`
- Create: `packages/genogram/src/forms/ChildEntryRow.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChildEntryRow } from './ChildEntryRow'

describe('ChildEntryRow', () => {
  it('default child shows person fields', () => {
    render(
      <ChildEntryRow
        value={{ type: 'person', data: { sex: 'male', lifeStatus: 'alive', birthMode: 'date' } }}
        onChange={() => {}}
      />,
    )
    expect(screen.getByLabelText('Имя')).toBeInTheDocument()
  })

  it('switching to "Выкидыш" shows date input only', async () => {
    const onChange = vi.fn()
    render(
      <ChildEntryRow
        value={{ type: 'person', data: { sex: 'male', lifeStatus: 'alive', birthMode: 'date' } }}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Выкидыш' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'miscarriage' }))
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```tsx
import { Stack, ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { ChildEntryDraft } from '../yjs/actions'
import { PersonDataForm } from './PersonDataForm'
import { PartialDateInput } from './primitives/PartialDateInput'
import { RU } from '../i18n/ru'

interface Props {
  value: ChildEntryDraft
  onChange: (next: ChildEntryDraft) => void
  readOnly?: boolean // for existing children
}

export function ChildEntryRow({ value, onChange, readOnly }: Props) {
  return (
    <Stack spacing={1}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={value.type}
        onChange={(_e, next) => {
          if (next === 'person') {
            onChange({
              type: 'person',
              data: { sex: 'male', lifeStatus: 'alive', birthMode: 'date' },
            })
          } else if (next === 'miscarriage' || next === 'abortion') {
            onChange({ type: next })
          }
        }}
      >
        <ToggleButton value="person">{RU.fields.childKindChild}</ToggleButton>
        <ToggleButton value="miscarriage">{RU.fields.childKindMiscarriage}</ToggleButton>
        <ToggleButton value="abortion">{RU.fields.childKindAbortion}</ToggleButton>
      </ToggleButtonGroup>

      {value.type === 'person' ? (
        readOnly ? (
          <span>
            {[value.data.lastName, value.data.firstName, value.data.middleName]
              .filter(Boolean)
              .join(' ')}
          </span>
        ) : (
          <PersonDataForm
            initial={value.data}
            context={{ kind: 'add-child' }}
            onSubmit={(d) => onChange({ type: 'person', data: d })}
            onCancel={() => {}}
            submitLabel="" // hide buttons — composed inside AddChildrenForm
          />
        )
      ) : (
        <PartialDateInput
          label={RU.fields.eventDate}
          value={value.date ?? {}}
          onChange={(v) =>
            onChange({ type: value.type, date: Object.keys(v).length ? v : undefined })
          }
        />
      )}
    </Stack>
  )
}
```

(Note: hiding inner submit buttons — likely needs an explicit `embedded` prop on `PersonDataForm` to skip its own button row. Add to PersonDataForm Props if missing.)

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/forms/ChildEntryRow.tsx packages/genogram/src/forms/ChildEntryRow.test.tsx packages/genogram/src/forms/PersonDataForm.tsx
git commit -m "feat(genogram): ChildEntryRow with person/miscarriage/abortion modes"
```

---

### Task 29: AddChildrenForm

**Files:**

- Create: `packages/genogram/src/forms/AddChildrenForm.tsx`
- Create: `packages/genogram/src/forms/AddChildrenForm.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddChildrenForm } from './AddChildrenForm'

describe('AddChildrenForm', () => {
  it('renders count rows for empty existing', () => {
    render(
      <AddChildrenForm
        existingChildren={[]}
        initialCount={2}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    // 2 rows
    expect(screen.getAllByRole('group').length).toBeGreaterThanOrEqual(2)
  })

  it('renders existing children first as readOnly rows', () => {
    render(
      <AddChildrenForm
        existingChildren={[
          { entry: { kind: 'person', personId: 'p1' as never }, label: 'Иванов И.' },
        ]}
        initialCount={3}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('Иванов И.')).toBeInTheDocument()
  })

  it('submit emits new entries and reorder if changed', async () => {
    const onSubmit = vi.fn()
    render(
      <AddChildrenForm
        existingChildren={[]}
        initialCount={1}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onSubmit).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react'
import { Button, Stack, TextField } from '@mui/material'
import type { ChildEntryDraft } from '../yjs/actions'
import type { ChildEntry } from '../types/domain'
import { ChildEntryRow } from './ChildEntryRow'
import { RU } from '../i18n/ru'

interface ExistingChildView {
  entry: ChildEntry
  label: string
}

interface Props {
  existingChildren: ExistingChildView[]
  initialCount?: number
  onSubmit: (newEntries: ChildEntryDraft[], reorderExisting?: ChildEntry[]) => void
  onCancel: () => void
}

export function AddChildrenForm({ existingChildren, initialCount, onSubmit, onCancel }: Props) {
  const K = existingChildren.length
  const [count, setCount] = useState<number>(initialCount ?? K + 1)
  const [orderedExisting, setOrderedExisting] = useState<ExistingChildView[]>(existingChildren)
  const [newEntries, setNewEntries] = useState<ChildEntryDraft[]>(() =>
    Array.from({ length: Math.max(0, count - K) }, () => ({
      type: 'person',
      data: { sex: 'male', lifeStatus: 'alive', birthMode: 'date' },
    })),
  )

  const updateCount = (n: number) => {
    if (n < K) return
    setCount(n)
    setNewEntries((prev) => {
      const need = n - K
      if (need > prev.length)
        return [
          ...prev,
          ...Array.from({ length: need - prev.length }, () => ({
            type: 'person' as const,
            data: {
              sex: 'male' as const,
              lifeStatus: 'alive' as const,
              birthMode: 'date' as const,
            },
          })),
        ]
      return prev.slice(0, need)
    })
  }

  const updateNew = (idx: number, next: ChildEntryDraft) =>
    setNewEntries((arr) => arr.map((e, i) => (i === idx ? next : e)))

  const move = (idx: number, dir: -1 | 1) => {
    setOrderedExisting((arr) => {
      const next = [...arr]
      const target = idx + dir
      if (target < 0 || target >= next.length) return next
      ;[next[idx], next[target]] = [next[target]!, next[idx]!]
      return next
    })
  }

  const submit = () => {
    const reordered = orderedExisting.map((x) => x.entry)
    const reorderChanged =
      JSON.stringify(reordered) !== JSON.stringify(existingChildren.map((x) => x.entry))
    onSubmit(newEntries, reorderChanged ? reordered : undefined)
  }

  return (
    <Stack spacing={2}>
      <TextField
        label={RU.fields.childCount}
        type="number"
        inputProps={{ min: K }}
        value={count}
        onChange={(e) => updateCount(Number(e.target.value))}
      />
      {orderedExisting.map((c, i) => (
        <Stack key={i} direction="row" alignItems="center" spacing={1} role="group">
          <Button size="small" onClick={() => move(i, -1)}>
            ↑
          </Button>
          <Button size="small" onClick={() => move(i, 1)}>
            ↓
          </Button>
          <span>{i + 1}.</span>
          <span>{c.label}</span>
        </Stack>
      ))}
      {newEntries.map((entry, i) => (
        <Stack key={`new-${i}`} role="group" spacing={1}>
          <span>{K + i + 1}.</span>
          <ChildEntryRow value={entry} onChange={(next) => updateNew(i, next)} />
        </Stack>
      ))}
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button onClick={onCancel}>{RU.drawer.cancel}</Button>
        <Button variant="contained" onClick={submit}>
          {RU.drawer.save}
        </Button>
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/forms/AddChildrenForm.tsx packages/genogram/src/forms/AddChildrenForm.test.tsx
git commit -m "feat(genogram): AddChildrenForm with reorderable existing rows + new entries"
```

---

## Phase 8 — UI Shell (state, menus, empty state, drawer)

### Task 30: ui-state reducer

**Files:**

- Create: `packages/genogram/src/ui/ui-state.ts`
- Create: `packages/genogram/src/ui/ui-state.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { initialUiState, uiReducer } from './ui-state'

describe('uiReducer', () => {
  it('select-node sets menu', () => {
    const state = uiReducer(initialUiState, {
      type: 'select-node',
      id: 'n1',
      anchorEl: {} as HTMLElement,
    })
    expect(state.menu).toEqual({ anchorEl: expect.any(Object), kind: 'node', targetId: 'n1' })
    expect(state.selection).toEqual({ kind: 'node', id: 'n1' })
  })

  it('open-drawer closes menu', () => {
    let state = uiReducer(initialUiState, {
      type: 'select-node',
      id: 'n1',
      anchorEl: {} as HTMLElement,
    })
    state = uiReducer(state, {
      type: 'open-drawer',
      drawer: { mode: 'edit-data', personId: 'n1' as never },
    })
    expect(state.menu).toBeNull()
    expect(state.drawer.mode).toBe('edit-data')
  })

  it('cancel resets drawer to closed and menu to null', () => {
    let state = uiReducer(initialUiState, {
      type: 'open-drawer',
      drawer: { mode: 'edit-data', personId: 'n1' as never },
    })
    state = uiReducer(state, { type: 'cancel' })
    expect(state.drawer.mode).toBe('closed')
    expect(state.menu).toBeNull()
  })

  it('open-create transitions to create-genogram drawer', () => {
    const state = uiReducer(initialUiState, { type: 'open-create' })
    expect(state.drawer.mode).toBe('create-genogram')
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```ts
import type { PersonId, UnionId } from '../types/domain'

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null

export type DrawerState =
  | { mode: 'closed' }
  | { mode: 'create-genogram' }
  | { mode: 'edit-data'; personId: PersonId }
  | { mode: 'edit-owner-data'; personId: PersonId }
  | { mode: 'add-partner'; basePersonId: PersonId }
  | { mode: 'edit-connection'; unionId: UnionId }
  | { mode: 'add-children'; unionId: UnionId }

export interface UiState {
  selection: Selection
  menu: { anchorEl: HTMLElement; kind: 'node' | 'edge'; targetId: string } | null
  drawer: DrawerState
}

export type UiAction =
  | { type: 'select-node'; id: string; anchorEl: HTMLElement }
  | { type: 'select-edge'; id: string; anchorEl: HTMLElement }
  | { type: 'close-menu' }
  | { type: 'open-create' }
  | { type: 'open-drawer'; drawer: DrawerState }
  | { type: 'cancel' }

export const initialUiState: UiState = {
  selection: null,
  menu: null,
  drawer: { mode: 'closed' },
}

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'select-node':
      return {
        ...state,
        selection: { kind: 'node', id: action.id },
        menu: { anchorEl: action.anchorEl, kind: 'node', targetId: action.id },
      }
    case 'select-edge':
      return {
        ...state,
        selection: { kind: 'edge', id: action.id },
        menu: { anchorEl: action.anchorEl, kind: 'edge', targetId: action.id },
      }
    case 'close-menu':
      return { ...state, menu: null }
    case 'open-create':
      return { ...state, menu: null, drawer: { mode: 'create-genogram' } }
    case 'open-drawer':
      return { ...state, menu: null, drawer: action.drawer }
    case 'cancel':
      return { ...state, menu: null, drawer: { mode: 'closed' }, selection: null }
  }
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/ui/ui-state.ts packages/genogram/src/ui/ui-state.test.ts
git commit -m "feat(genogram): UI state reducer for selection, menu, drawer"
```

---

### Task 31: ElementMenu

**Files:**

- Create: `packages/genogram/src/ui/ElementMenu.tsx`
- Create: `packages/genogram/src/ui/ElementMenu.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ElementMenu } from './ElementMenu'

describe('ElementMenu', () => {
  const anchor = document.createElement('div')

  it('small element shows only "Редактировать данные"', () => {
    render(
      <ElementMenu
        open
        anchorEl={anchor}
        personSize="small"
        personRole="regular"
        hasParents
        onClose={() => {}}
        onAction={() => {}}
      />,
    )
    expect(screen.getByText('Редактировать данные')).toBeInTheDocument()
    expect(screen.queryByText('Добавить партнёра')).not.toBeInTheDocument()
    expect(screen.queryByText('Добавить родителей')).not.toBeInTheDocument()
  })

  it('big regular without parents shows three items', () => {
    render(
      <ElementMenu
        open
        anchorEl={anchor}
        personSize="big"
        personRole="regular"
        hasParents={false}
        onClose={() => {}}
        onAction={() => {}}
      />,
    )
    expect(screen.getByText('Редактировать данные')).toBeInTheDocument()
    expect(screen.getByText('Добавить партнёра')).toBeInTheDocument()
    expect(screen.getByText('Добавить родителей')).toBeInTheDocument()
  })

  it('big regular WITH parents hides "Добавить родителей"', () => {
    render(
      <ElementMenu
        open
        anchorEl={anchor}
        personSize="big"
        personRole="regular"
        hasParents
        onClose={() => {}}
        onAction={() => {}}
      />,
    )
    expect(screen.queryByText('Добавить родителей')).not.toBeInTheDocument()
  })

  it('big owner shows owner-specific menu', () => {
    render(
      <ElementMenu
        open
        anchorEl={anchor}
        personSize="big"
        personRole="owner"
        hasParents
        onClose={() => {}}
        onAction={() => {}}
      />,
    )
    expect(screen.getByText('Редактировать данные владельца')).toBeInTheDocument()
    expect(screen.getByText('Добавить партнёра')).toBeInTheDocument()
    expect(screen.queryByText('Добавить родителей')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```tsx
import { Menu, MenuItem } from '@mui/material'
import type { PersonRole, PersonSize } from '../types/domain'
import { RU } from '../i18n/ru'

export type ElementAction = 'edit-data' | 'edit-owner' | 'add-partner' | 'add-parents'

interface Props {
  open: boolean
  anchorEl: HTMLElement | null
  personSize: PersonSize
  personRole: PersonRole
  hasParents: boolean
  onClose: () => void
  onAction: (action: ElementAction) => void
}

export function ElementMenu({
  open,
  anchorEl,
  personSize,
  personRole,
  hasParents,
  onClose,
  onAction,
}: Props) {
  const items: { action: ElementAction; label: string }[] = []
  if (personSize === 'small') {
    items.push({ action: 'edit-data', label: RU.menu.editData })
  } else if (personRole === 'owner') {
    items.push({ action: 'edit-owner', label: RU.menu.editOwnerData })
    items.push({ action: 'add-partner', label: RU.menu.addPartner })
  } else {
    items.push({ action: 'edit-data', label: RU.menu.editData })
    items.push({ action: 'add-partner', label: RU.menu.addPartner })
    if (!hasParents) items.push({ action: 'add-parents', label: RU.menu.addParents })
  }

  return (
    <Menu open={open} anchorEl={anchorEl} onClose={onClose}>
      {items.map((it) => (
        <MenuItem
          key={it.action}
          onClick={() => {
            onAction(it.action)
            onClose()
          }}
        >
          {it.label}
        </MenuItem>
      ))}
    </Menu>
  )
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/ui/ElementMenu.tsx packages/genogram/src/ui/ElementMenu.test.tsx
git commit -m "feat(genogram): ElementMenu — context-aware actions per node type"
```

---

### Task 32: EdgeMenu

**Files:**

- Create: `packages/genogram/src/ui/EdgeMenu.tsx`
- Create: `packages/genogram/src/ui/EdgeMenu.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EdgeMenu } from './EdgeMenu'

describe('EdgeMenu', () => {
  const anchor = document.createElement('div')

  it('shows two items', () => {
    render(<EdgeMenu open anchorEl={anchor} onClose={() => {}} onAction={() => {}} />)
    expect(screen.getByText('Редактировать связь')).toBeInTheDocument()
    expect(screen.getByText('Добавить детей')).toBeInTheDocument()
  })

  it('emits action on click', async () => {
    const onAction = vi.fn()
    render(<EdgeMenu open anchorEl={anchor} onClose={() => {}} onAction={onAction} />)
    await userEvent.click(screen.getByText('Добавить детей'))
    expect(onAction).toHaveBeenCalledWith('add-children')
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```tsx
import { Menu, MenuItem } from '@mui/material'
import { RU } from '../i18n/ru'

export type EdgeAction = 'edit-connection' | 'add-children'

interface Props {
  open: boolean
  anchorEl: HTMLElement | null
  onClose: () => void
  onAction: (action: EdgeAction) => void
}

export function EdgeMenu({ open, anchorEl, onClose, onAction }: Props) {
  const items: { action: EdgeAction; label: string }[] = [
    { action: 'edit-connection', label: RU.menu.editConnection },
    { action: 'add-children', label: RU.menu.addChildren },
  ]
  return (
    <Menu open={open} anchorEl={anchorEl} onClose={onClose}>
      {items.map((it) => (
        <MenuItem
          key={it.action}
          onClick={() => {
            onAction(it.action)
            onClose()
          }}
        >
          {it.label}
        </MenuItem>
      ))}
    </Menu>
  )
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/ui/EdgeMenu.tsx packages/genogram/src/ui/EdgeMenu.test.tsx
git commit -m "feat(genogram): EdgeMenu — edit connection + add children"
```

---

### Task 33: EmptyState

**Files:**

- Create: `packages/genogram/src/ui/EmptyState.tsx`
- Create: `packages/genogram/src/ui/EmptyState.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('shows CTA in editor mode', () => {
    render(<EmptyState mode="editor" onCreate={() => {}} />)
    expect(screen.getByRole('button', { name: 'Создать генограмму' })).toBeInTheDocument()
  })

  it('hides CTA in readonly mode', () => {
    render(<EmptyState mode="readonly" onCreate={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Создать генограмму' })).not.toBeInTheDocument()
  })

  it('emits onCreate when CTA clicked', async () => {
    const onCreate = vi.fn()
    render(<EmptyState mode="editor" onCreate={onCreate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Создать генограмму' }))
    expect(onCreate).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**

```tsx
import { Button, Stack, Typography } from '@mui/material'
import { RU } from '../i18n/ru'

interface Props {
  mode: 'editor' | 'readonly'
  onCreate: () => void
}

export function EmptyState({ mode, onCreate }: Props) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={2}
      sx={{ height: '100%', minHeight: 300 }}
    >
      <Typography variant="h5">{RU.emptyState.title}</Typography>
      <Typography variant="body2" color="text.secondary">
        {RU.emptyState.subtitle}
      </Typography>
      {mode === 'editor' && (
        <Button variant="contained" size="large" onClick={onCreate}>
          {RU.emptyState.cta}
        </Button>
      )}
    </Stack>
  )
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/ui/EmptyState.tsx packages/genogram/src/ui/EmptyState.test.tsx
git commit -m "feat(genogram): EmptyState with conditional CTA"
```

---

### Task 34: DrawerHost

**Files:**

- Create: `packages/genogram/src/ui/DrawerHost.tsx`

- [ ] **Step 1: Implement**

```tsx
import { Drawer, IconButton, Stack, Typography } from '@mui/material'
import * as Y from 'yjs'
import type { DrawerState } from './ui-state'
import type { PersonId, UnionId } from '../types/domain'
import { RU } from '../i18n/ru'
import { OwnerDataForm } from '../forms/OwnerDataForm'
import { PersonDataForm } from '../forms/PersonDataForm'
import { MarriageRelationForm } from '../forms/MarriageRelationForm'
import { AddChildrenForm } from '../forms/AddChildrenForm'
import {
  addChildren,
  addParents,
  addPartner,
  createOwnerWithParents,
  setChildOrder,
  setPartnerOrder,
  setUnionDivorce,
  updatePerson,
} from '../yjs/actions'
import { assembleDomain } from '../yjs/assembleDomain'
import { getBaseOf, countPartnersOf, getChildGroupOf } from '../model/computed'

interface Props {
  doc: Y.Doc
  drawer: DrawerState
  onClose: () => void
}

const DRAWER_WIDTH = 360

const TITLES: Record<DrawerState['mode'], string> = {
  closed: '',
  'create-genogram': RU.drawer.titleCreate,
  'edit-data': RU.drawer.titleEditData,
  'edit-owner-data': RU.drawer.titleEditOwner,
  'add-partner': RU.drawer.titleAddPartner,
  'edit-connection': RU.drawer.titleEditConnection,
  'add-children': RU.drawer.titleAddChildren,
}

export function DrawerHost({ doc, drawer, onClose }: Props) {
  const open = drawer.mode !== 'closed'
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: DRAWER_WIDTH, p: 2 } }}
    >
      <Stack spacing={2}>
        <Typography variant="h6">{TITLES[drawer.mode]}</Typography>
        {renderForm(doc, drawer, onClose)}
      </Stack>
    </Drawer>
  )
}

function renderForm(doc: Y.Doc, drawer: DrawerState, onClose: () => void) {
  const domain = assembleDomain(doc)
  if (drawer.mode === 'create-genogram') {
    return (
      <OwnerDataForm
        mode="create"
        initial={{ sex: 'male' }}
        onCancel={onClose}
        onSubmit={(d) => {
          createOwnerWithParents(doc, d)
          onClose()
        }}
      />
    )
  }
  if (drawer.mode === 'edit-owner-data') {
    const owner = domain.entities.people[drawer.personId]
    if (!owner) return null
    return (
      <OwnerDataForm
        mode="edit"
        initial={{
          sex: owner.sex,
          firstName: owner.identity.firstName,
          lastName: owner.identity.lastName,
          middleName: owner.identity.middleName,
          birthDate: owner.lifeDates.birthDate,
        }}
        onCancel={onClose}
        onSubmit={(d) => {
          updatePerson(doc, drawer.personId, {
            sex: d.sex,
            identity: {
              ...owner.identity,
              firstName: d.firstName,
              lastName: d.lastName,
              middleName: d.middleName,
            },
            lifeDates: { ...owner.lifeDates, birthDate: d.birthDate },
          })
          onClose()
        }}
      />
    )
  }
  if (drawer.mode === 'edit-data') {
    const p = domain.entities.people[drawer.personId]
    if (!p) return null
    const baseId = getBaseOf(drawer.personId, domain.entities.unions)
    const isPartnerOfMultiBase = baseId
      ? countPartnersOf(baseId, domain.entities.unions) > 1
      : false
    const childGroup = getChildGroupOf(drawer.personId, domain.entities.childGroups)
    const isChild = !!childGroup
    const childOrder = childGroup
      ? childGroup.children.findIndex(
          (c) => c.kind === 'person' && c.personId === drawer.personId,
        ) + 1
      : undefined
    return (
      <PersonDataForm
        initial={{
          sex: p.sex,
          firstName: p.identity.firstName,
          lastName: p.identity.lastName,
          middleName: p.identity.middleName,
          birthMode: p.lifeDates.birthMode,
          lifeStatus: p.lifeDates.lifeStatus,
          birthDate: p.lifeDates.birthDate,
          approximateAge: p.lifeDates.approximateAge,
          deathDate: p.lifeDates.deathDate,
          tragically: p.lifeDates.tragically,
          partnerOrder: p.partnerOrder,
        }}
        context={{
          kind: 'edit-data',
          isPartnerOfMultiBase,
          totalPartnersOfBase: baseId ? countPartnersOf(baseId, domain.entities.unions) : undefined,
          isChild,
          childOrder,
          siblingsCount: childGroup?.children.length,
        }}
        onCancel={onClose}
        onSubmit={(d) => {
          updatePerson(doc, drawer.personId, {
            sex: d.sex,
            identity: {
              ...p.identity,
              firstName: d.firstName,
              lastName: d.lastName,
              middleName: d.middleName,
            },
            lifeDates: {
              birthMode: d.birthMode,
              lifeStatus: d.lifeStatus,
              birthDate: d.birthDate,
              approximateAge: d.approximateAge,
              deathDate: d.deathDate,
              tragically: d.tragically,
            },
          })
          if (d.partnerOrder !== undefined && d.partnerOrder !== p.partnerOrder) {
            setPartnerOrder(doc, drawer.personId, d.partnerOrder)
          }
          if (d.childOrder !== undefined && d.childOrder !== childOrder) {
            setChildOrder(doc, drawer.personId, d.childOrder)
          }
          onClose()
        }}
      />
    )
  }
  if (drawer.mode === 'add-partner') {
    const baseId = drawer.basePersonId
    const existingPartnersOfBase = countPartnersOf(baseId, domain.entities.unions)
    return (
      <AddPartnerForm
        doc={doc}
        basePersonId={baseId}
        existingPartnersOfBase={existingPartnersOfBase}
        onCancel={onClose}
        onSubmit={onClose}
      />
    )
  }
  if (drawer.mode === 'edit-connection') {
    const u = domain.entities.unions[drawer.unionId]
    if (!u) return null
    return (
      <MarriageRelationForm
        initial={{ kind: u.kind, startDate: u.startDate, endDate: u.endDate, divorce: u.divorce }}
        onCancel={onClose}
        onSubmit={(draft) => {
          // updateUnion or setUnionDivorce calls
          if (draft.divorce) {
            setUnionDivorce(doc, drawer.unionId, draft.divorce)
          }
          // For the rest of fields, use a hypothetical updateUnion or write through schema
          // (Use existing or add new updateUnion in actions.ts as part of this task.)
          onClose()
        }}
      />
    )
  }
  if (drawer.mode === 'add-children') {
    const cg = Object.values(domain.entities.childGroups).find((c) => c.unionId === drawer.unionId)
    const existing = (cg?.children ?? []).map((entry) => {
      if (entry.kind === 'person') {
        const p = domain.entities.people[entry.personId]
        return {
          entry,
          label: [p?.identity.lastName, p?.identity.firstName, p?.identity.middleName]
            .filter(Boolean)
            .join(' '),
        }
      }
      return { entry, label: '(потеря)' }
    })
    return (
      <AddChildrenForm
        existingChildren={existing}
        onCancel={onClose}
        onSubmit={(newEntries, reorderExisting) => {
          addChildren(doc, drawer.unionId, newEntries, reorderExisting)
          onClose()
        }}
      />
    )
  }
  return null
}
```

- [ ] **Step 2: Implement AddPartnerForm composite (inline in DrawerHost.tsx)**

Add at the bottom of `DrawerHost.tsx`:

```tsx
import { useState } from 'react'

function AddPartnerForm({
  doc,
  basePersonId,
  existingPartnersOfBase,
  onCancel,
  onSubmit,
}: {
  doc: Y.Doc
  basePersonId: PersonId
  existingPartnersOfBase: number
  onCancel: () => void
  onSubmit: () => void
}) {
  const [personDraft, setPersonDraft] = useState<PersonDataDraft>({
    sex: 'female',
    lifeStatus: 'alive',
    birthMode: 'date',
  })
  const [unionDraft, setUnionDraft] = useState<UnionDraft>({ kind: 'marriage' })
  const [partnerCount, setPartnerCount] = useState<number>(existingPartnersOfBase + 1)

  return (
    <Stack spacing={3}>
      <PersonDataForm
        initial={personDraft}
        context={{ kind: 'add-partner', existingPartnersOfBase }}
        onCancel={onCancel}
        onSubmit={(d) => {
          setPersonDraft(d)
          if (d.partnerCount !== undefined) setPartnerCount(d.partnerCount)
        }}
        embedded
      />
      <MarriageRelationForm
        initial={unionDraft}
        onCancel={onCancel}
        onSubmit={(d) => setUnionDraft(d)}
        embedded
      />
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button onClick={onCancel}>{RU.drawer.cancel}</Button>
        <Button
          variant="contained"
          onClick={() => {
            addPartner(doc, basePersonId, personDraft, unionDraft, partnerCount)
            onSubmit()
          }}
        >
          {RU.drawer.save}
        </Button>
      </Stack>
    </Stack>
  )
}
```

`embedded` prop on `PersonDataForm` and `MarriageRelationForm` skips their internal save/cancel button row (the wrapper renders its own buttons). Add this prop to both forms' Props interface and gate the trailing button `<Stack>`:

```tsx
{
  !embedded && (
    <Stack direction="row" spacing={1} justifyContent="flex-end">
      <Button onClick={onCancel}>{RU.drawer.cancel}</Button>
      <Button variant="contained" onClick={() => onSubmit(draft)}>
        {submitLabel}
      </Button>
    </Stack>
  )
}
```

While in `embedded` mode, treat each call to `setPersonDraft` / `setUnionDraft` (i.e., field change) as an autosave to local draft — the wrapper triggers the actual `addPartner` only on its own primary button click. To make this work with internal `useState` of the inner forms, lift the `onSubmit` callback to fire on every meaningful change instead of just on click. Simpler: switch the inner forms in embedded mode to a "controlled" style — accept `value` and `onChange` props instead of `initial` + `onSubmit`. Add this controlled mode now.

- [ ] **Step 3: Manual smoke test**

Run `pnpm --filter @repo/genogram check-types`. Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/genogram/src/ui/DrawerHost.tsx packages/genogram/src/forms/PersonDataForm.tsx packages/genogram/src/forms/MarriageRelationForm.tsx
git commit -m "feat(genogram): DrawerHost dispatches forms by drawer.mode; AddPartner composite"
```

---

## Phase 9 — Visual Updates

### Task 35: PersonNode — owner inner shape

**Files:**

- Modify: `packages/genogram/src/nodes/PersonNode.tsx`

- [ ] **Step 1: Inspect existing PersonNode**

```bash
cat packages/genogram/src/nodes/PersonNode.tsx
```

- [ ] **Step 2: Verify inner shape rendering for role='owner'**

If existing code has correct inner shape rendering (per memory: "PersonNode Already Renders All Required Visual States Including Owner, Unknown, Deceased Cross"), ensure it still works after the LifeDates changes. Specifically: replace any reference to `lifeDates.isDeceased` with `lifeDates.lifeStatus === 'deceased'`. Replace `deathKind === 'tragic' || deathKind === 'early'` with `shouldShowDeathCross(person)` from `model/computed`.

- [ ] **Step 3: Run check-types**

```bash
pnpm --filter @repo/genogram check-types
```

- [ ] **Step 4: Commit (if changes were made)**

```bash
git add packages/genogram/src/nodes/PersonNode.tsx
git commit -m "fix(genogram): PersonNode references lifeStatus and shouldShowDeathCross"
```

---

### Task 36: PersonNode — partner ordinal number inside element

**Files:**

- Modify: `packages/genogram/src/nodes/PersonNode.tsx`

- [ ] **Step 1: Add partner ordinal rendering**

In the SVG body of `PersonNode`, after rendering shape and possibly X-marker, add:

```tsx
{
  showOrdinal && (
    <text x={cx} y={cy + 6} textAnchor="middle" fontSize={18} fontWeight="bold" fill="currentColor">
      {person.partnerOrder}
    </text>
  )
}
```

`showOrdinal` is computed from props (passed in from `domainToFlow`):

```tsx
const showOrdinal = data.shouldShowPartnerOrder && person.partnerOrder !== undefined
```

In `domainToFlow.ts`, add `shouldShowPartnerOrder` to node `data` for each person:

```ts
data: {
  ...,
  shouldShowPartnerOrder: shouldShowPartnerOrder(person.id, domain.entities.people, domain.entities.unions),
}
```

- [ ] **Step 2: Manual visual test** via Playwright sample (deferred to E2E phase).

- [ ] **Step 3: Commit**

```bash
git add packages/genogram/src/nodes/PersonNode.tsx packages/genogram/src/react-flow/domainToFlow.ts
git commit -m "feat(genogram): render partner ordinal number inside element when base has >1 partners"
```

---

### Task 37: PersonLabel — new positioning rules and "?" suffix

**Files:**

- Modify: `packages/genogram/src/nodes/primitives/PersonLabel.tsx`

- [ ] **Step 1: Replace label rendering**

Update `PersonLabel.tsx` to:

- For `size='big'` → render right of element (existing behaviour).
- For `size='small'` → render below element.
- Append `?` to first line if `lifeDates.lifeStatus === 'unknown'`.
- Use `formatPartialDate` for birth/death dates.
- Use `RU.labels.yearsOld` etc. for ages.

```tsx
import { formatPartialDate } from '../../i18n/format-date'
import { RU } from '../../i18n/ru'
import { calcAge } from '../../model/computed'

// Within label content:
const fioParts = [identity.lastName, identity.firstName, identity.middleName].filter(Boolean)
const fio = fioParts.length
  ? fioParts.join(' ')
  : identity.isUnknown
    ? sex === 'male'
      ? RU.labels.unknownPerson.male
      : RU.labels.unknownPerson.female
    : ''
const fioWithMark = lifeStatus === 'unknown' && fio ? `${fio} ?` : fio

const age =
  lifeDates.birthMode === 'date' ? calcAge(lifeDates.birthDate, meta.createdAt) : undefined
const ageText =
  lifeDates.birthMode === 'approximate' && lifeDates.approximateAge
    ? lifeDates.approximateAge.kind === 'value'
      ? RU.labels.yearsOldApprox(lifeDates.approximateAge.value)
      : RU.labels.yearsOldRange(lifeDates.approximateAge.from, lifeDates.approximateAge.to)
    : age !== undefined
      ? RU.labels.yearsOld(age)
      : ''

const birthText =
  lifeDates.birthMode === 'date' && lifeDates.birthDate
    ? formatPartialDate(lifeDates.birthDate)
    : ''
const deathText =
  lifeStatus === 'deceased' && lifeDates.deathDate
    ? `† ${formatPartialDate(lifeDates.deathDate)}`
    : ''

const lines = [fioWithMark, ageText, birthText, deathText].filter((l) => l && l.length)
```

- [ ] **Step 2: Update positioning logic to use size**

```tsx
const position = size === 'big' ? 'right' : 'bottom'
// existing positioning math should already support these
```

- [ ] **Step 3: Run check-types and existing tests**

```bash
pnpm --filter @repo/genogram check-types
pnpm --filter @repo/genogram test
```

- [ ] **Step 4: Commit**

```bash
git add packages/genogram/src/nodes/primitives/PersonLabel.tsx
git commit -m "feat(genogram): PersonLabel uses formatPartialDate, RU.yearsOld, '?' for unknown lifeStatus"
```

---

### Task 38: PregnancyLossNode — Cyrillic А/В

**Files:**

- Modify: `packages/genogram/src/nodes/PregnancyLossNode.tsx`

- [ ] **Step 1: Replace 'A'/'B' with 'А'/'В'**

Find `'A'` and `'B'` literal strings in PregnancyLossNode (these mark abortion/miscarriage). Replace with cyrillic `'А'` (kind='abortion') and `'В'` (kind='miscarriage').

- [ ] **Step 2: Verify visually + check-types**

```bash
pnpm --filter @repo/genogram check-types
```

- [ ] **Step 3: Commit**

```bash
git add packages/genogram/src/nodes/PregnancyLossNode.tsx
git commit -m "fix(genogram): PregnancyLoss uses Cyrillic А/В (abortion/miscarriage)"
```

---

### Task 39: OwnerCreationDateNode

**Files:**

- Create: `packages/genogram/src/nodes/OwnerCreationDateNode.tsx`
- Modify: `packages/genogram/src/react-flow/domainToFlow.ts`
- Modify: `packages/genogram/src/react-flow/index.ts` (or wherever `nodeTypes` map is)

- [ ] **Step 1: Create the node component**

```tsx
import type { NodeProps } from '@xyflow/react'
import { Typography } from '@mui/material'
import { RU } from '../i18n/ru'

interface NodeData {
  formattedDate: string
}

export function OwnerCreationDateNode({ data }: NodeProps<{ data: NodeData }>) {
  return (
    <Typography variant="caption" color="text.secondary">
      {RU.labels.creationDate}: {data.formattedDate}
    </Typography>
  )
}
```

- [ ] **Step 2: Register node type**

Add to `nodeTypes` map: `genogramCreationDate: OwnerCreationDateNode`.

- [ ] **Step 3: Create the node in domainToFlow**

In `domainToFlow.ts`, after building person nodes, if `meta.createdAt` exists and `meta.ownerId` resolves to a known node — push:

```ts
const ownerPos = positions[meta.ownerId]
if (ownerPos) {
  nodes.push({
    id: '__creation_date__',
    type: 'genogramCreationDate',
    position: { x: ownerPos.x + 280, y: ownerPos.y },
    data: { formattedDate: formatPartialDate(isoToPartial(meta.createdAt)) },
    draggable: false,
    selectable: false,
  })
}
```

`isoToPartial` lives in `model/computed.ts` (export it).

- [ ] **Step 4: Run check-types**

- [ ] **Step 5: Commit**

```bash
git add packages/genogram/src/nodes/OwnerCreationDateNode.tsx packages/genogram/src/react-flow/domainToFlow.ts packages/genogram/src/react-flow/index.ts packages/genogram/src/model/computed.ts
git commit -m "feat(genogram): OwnerCreationDateNode renders creation date right of owner"
```

---

### Task 40: UnionLineEdge — draggable divorce mark

**Files:**

- Modify: `packages/genogram/src/edges/UnionLineEdge.tsx`

- [ ] **Step 1: Add markPosition rendering and drag handlers**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'

// inside UnionLineEdge component:

const divorce = data.union.divorce
if (!divorce) return null // existing branches

const localPosRef = useRef<number>(divorce.markPosition ?? 0.5)
const [pos, setPos] = useState<number>(divorce.markPosition ?? 0.5)
const [dragging, setDragging] = useState(false)
const dragStateRef = useRef<{ posStart: number; mouseStart: { x: number; y: number } } | null>(null)

useEffect(() => {
  setPos(divorce.markPosition ?? 0.5)
  localPosRef.current = divorce.markPosition ?? 0.5
}, [divorce.markPosition])

const onDragStart = useCallback(
  (e: React.MouseEvent) => {
    e.stopPropagation()
    dragStateRef.current = {
      posStart: localPosRef.current,
      mouseStart: { x: e.clientX, y: e.clientY },
    }
    setDragging(true)
    const onMove = (m: MouseEvent) => {
      const ds = dragStateRef.current
      if (!ds) return
      const dx = m.clientX - ds.mouseStart.x
      const dy = m.clientY - ds.mouseStart.y
      const lineDx = x2 - x1,
        lineDy = y2 - y1
      const lineLen = Math.hypot(lineDx, lineDy) || 1
      const ux = lineDx / lineLen,
        uy = lineDy / lineLen
      const deltaScalar = (dx * ux + dy * uy) / lineLen
      const nextPos = Math.min(1, Math.max(0, ds.posStart + deltaScalar))
      localPosRef.current = nextPos
      setPos(nextPos)
    }
    const onUp = () => {
      setDragging(false)
      dragStateRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setUnionDivorce(doc, unionId, { ...divorce, markPosition: localPosRef.current })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  },
  [x1, y1, x2, y2, divorce, doc, unionId],
)

const markX = x1 + (x2 - x1) * pos
const markY = y1 + (y2 - y1) * pos

return (
  <g onMouseDown={onDragStart} style={{ cursor: dragging ? 'grabbing' : 'grab' }}>
    <rect x={markX - 12} y={markY - 12} width={24} height={24} fill="transparent" />
    <line
      x1={markX - 7}
      y1={markY + 7}
      x2={markX + 7}
      y2={markY - 7}
      stroke="currentColor"
      strokeWidth={2}
    />
    <line
      x1={markX - 4}
      y1={markY + 10}
      x2={markX + 10}
      y2={markY - 4}
      stroke="currentColor"
      strokeWidth={2}
    />
  </g>
)
```

- [ ] **Step 2: Wire `doc` and `unionId` into props**

UnionLineEdge already receives data; ensure `unionId` is available. The Y.Doc is reachable via React context provided in `GenogramFlow` — add a `useDoc` hook returning the doc.

```tsx
// packages/genogram/src/react-flow/doc-context.ts
import { createContext, useContext } from 'react'
import type * as Y from 'yjs'

export const DocContext = createContext<Y.Doc | null>(null)
export const useDoc = (): Y.Doc => {
  const d = useContext(DocContext)
  if (!d) throw new Error('useDoc must be inside DocContext.Provider')
  return d
}
```

Add `<DocContext.Provider value={doc}>...</DocContext.Provider>` in `GenogramFlow` around React Flow.

- [ ] **Step 3: Run check-types**

- [ ] **Step 4: Commit**

```bash
git add packages/genogram/src/edges/UnionLineEdge.tsx packages/genogram/src/react-flow/doc-context.ts packages/genogram/src/react-flow/GenogramFlow.tsx
git commit -m "feat(genogram): draggable divorce mark with markPosition persistence"
```

---

## Phase 10 — GenogramFlow Integration

### Task 41: Wire up reducer + DrawerHost + Menus + EmptyState in GenogramFlow

**Files:**

- Modify: `packages/genogram/src/react-flow/GenogramFlow.tsx`

- [ ] **Step 1: Add UI state and wire components**

Replace existing GenogramFlow body to include:

```tsx
import { useReducer, useCallback } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls } from '@xyflow/react'
import { DocContext } from './doc-context'
import { initialUiState, uiReducer } from '../ui/ui-state'
import { DrawerHost } from '../ui/DrawerHost'
import { ElementMenu } from '../ui/ElementMenu'
import { EdgeMenu } from '../ui/EdgeMenu'
import { EmptyState } from '../ui/EmptyState'
import { getMeta } from '../yjs/actions'
import { hasParents } from '../model/computed'
import { useGenogram } from '../hooks'

interface Props {
  doc: Y.Doc
  mode?: 'editor' | 'readonly'
}

export function GenogramFlow({ doc, mode = 'editor' }: Props) {
  const [ui, dispatch] = useReducer(uiReducer, initialUiState)
  const { domain, layout } = useGenogram(doc)
  const meta = getMeta(doc)

  if (!meta) {
    return <EmptyState mode={mode} onCreate={() => dispatch({ type: 'open-create' })} />
  }

  const onNodeClick = (e: React.MouseEvent, node: { id: string }) => {
    if (mode !== 'editor') return
    dispatch({ type: 'select-node', id: node.id, anchorEl: e.currentTarget as HTMLElement })
  }
  const onEdgeClick = (e: React.MouseEvent, edge: { id: string }) => {
    if (mode !== 'editor') return
    dispatch({ type: 'select-edge', id: edge.id, anchorEl: e.currentTarget as HTMLElement })
  }

  // ElementMenu props
  const menuPerson = ui.menu?.kind === 'node' ? domain.entities.people[ui.menu.targetId] : null

  return (
    <DocContext.Provider value={doc}>
      <ReactFlowProvider>
        {(() => {
          const { nodes, edges } = domainToFlow(domain, layout)
          return (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              nodesDraggable={mode === 'editor'}
            >
              <Background />
              <Controls />
            </ReactFlow>
          )
        })()}

        {ui.menu?.kind === 'node' && menuPerson && (
          <ElementMenu
            open={true}
            anchorEl={ui.menu.anchorEl}
            personSize={menuPerson.size}
            personRole={menuPerson.role}
            hasParents={hasParents(menuPerson.id, domain.entities.childGroups)}
            onClose={() => dispatch({ type: 'close-menu' })}
            onAction={(action) => {
              if (action === 'edit-data')
                dispatch({
                  type: 'open-drawer',
                  drawer: { mode: 'edit-data', personId: menuPerson.id },
                })
              if (action === 'edit-owner')
                dispatch({
                  type: 'open-drawer',
                  drawer: { mode: 'edit-owner-data', personId: menuPerson.id },
                })
              if (action === 'add-partner')
                dispatch({
                  type: 'open-drawer',
                  drawer: { mode: 'add-partner', basePersonId: menuPerson.id },
                })
              if (action === 'add-parents') {
                addParents(doc, menuPerson.id)
                dispatch({ type: 'close-menu' })
              }
            }}
          />
        )}

        {ui.menu?.kind === 'edge' && (
          <EdgeMenu
            open={true}
            anchorEl={ui.menu.anchorEl}
            onClose={() => dispatch({ type: 'close-menu' })}
            onAction={(action) => {
              const unionId = ui.menu!.targetId as UnionId
              if (action === 'edit-connection')
                dispatch({ type: 'open-drawer', drawer: { mode: 'edit-connection', unionId } })
              if (action === 'add-children')
                dispatch({ type: 'open-drawer', drawer: { mode: 'add-children', unionId } })
            }}
          />
        )}

        <DrawerHost doc={doc} drawer={ui.drawer} onClose={() => dispatch({ type: 'cancel' })} />
      </ReactFlowProvider>
    </DocContext.Provider>
  )
}
```

- [ ] **Step 2: Run check-types and existing tests**

```bash
pnpm --filter @repo/genogram check-types
pnpm --filter @repo/genogram test
```

- [ ] **Step 3: Manual smoke test**

Start the web app, create GENOGRAM page, verify EmptyState → CTA → Drawer → form submission → owner+parents appear on canvas with creation date.

```bash
pnpm dev
# Open http://localhost:3000, create GENOGRAM page
```

- [ ] **Step 4: Commit**

```bash
git add packages/genogram/src/react-flow/GenogramFlow.tsx
git commit -m "feat(genogram): integrate reducer + DrawerHost + Menus + EmptyState"
```

---

## Phase 11 — E2E Tests

### Task 42: E2E — Create genogram

**Files:**

- Create: `apps/e2e/genogram.spec.ts`

- [ ] **Step 1: Write E2E test**

```ts
import { test, expect } from '@playwright/test'

test.describe('Genogram editor', () => {
  test('Create genogram from empty state', async ({ page }) => {
    // Auth fixture should already log in. Navigate to a workspace, create GENOGRAM page.
    // Use existing helpers from apps/e2e (look for createGenogramPage, etc.).

    await page.goto('http://localhost:3000/app')
    // ... navigate to a workspace and create new page with type GENOGRAM
    // (adapt to existing E2E helpers; if absent, click "+ New page" → select type GENOGRAM)

    // Empty state visible
    await expect(page.getByText('Генограмма пуста')).toBeVisible()
    await page.getByRole('button', { name: 'Создать генограмму' }).click()

    // Drawer opens, fill owner data
    await page.getByLabel('Фамилия').fill('Иванов')
    await page.getByLabel('Имя').fill('Иван')
    await page.getByRole('button', { name: 'Мужской' }).click() // ensure male
    await page.getByRole('button', { name: 'Создать генограмму' }).click()

    // 3 elements appear
    await expect(page.locator('.react-flow__node')).toHaveCount(4) // 3 people + 1 creation date label
    await expect(page.getByText(/Дата создания/)).toBeVisible()
  })
})
```

- [ ] **Step 2: Run dev server**

```bash
pnpm dev
```

- [ ] **Step 3: Run E2E**

```bash
pnpm exec playwright test apps/e2e/genogram.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/e2e/genogram.spec.ts
git commit -m "test(genogram): E2E for create-genogram flow"
```

---

### Task 43: E2E — Add partner + edit connection

**Files:**

- Modify: `apps/e2e/genogram.spec.ts`

- [ ] **Step 1: Append test**

```ts
test('Add partner with marriage, then switch to cohabitation via edit connection', async ({
  page,
}) => {
  // ... navigate to a freshly created genogram page (reuse setup)

  // Click owner element
  await page.locator('.react-flow__node').filter({ hasText: 'Иванов' }).click()
  await page.getByRole('menuitem', { name: 'Добавить партнёра' }).click()

  // Fill partner form
  await page.getByLabel('Имя').fill('Анна')
  await page.getByRole('button', { name: 'Женский' }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()

  // Solid line between owner and partner
  await expect(page.locator('.react-flow__edge[stroke-dasharray=""]')).toBeVisible()

  // Click line, edit connection
  await page.locator('.react-flow__edge').first().click()
  await page.getByRole('menuitem', { name: 'Редактировать связь' }).click()
  await page.getByRole('button', { name: 'Отношения' }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()

  // Line should now be dashed
  await expect(page.locator('.react-flow__edge[stroke-dasharray*="6"]')).toBeVisible()
})
```

- [ ] **Step 2: Run, commit**

```bash
pnpm exec playwright test apps/e2e/genogram.spec.ts
git add apps/e2e/genogram.spec.ts
git commit -m "test(genogram): E2E for add-partner + edit-connection"
```

---

### Task 44: E2E — Add children + tragically marker

**Files:**

- Modify: `apps/e2e/genogram.spec.ts`

- [ ] **Step 1: Append test**

```ts
test('Add 2 children (one person, one miscarriage), edit child to tragically deceased', async ({
  page,
}) => {
  // ... setup with owner + partner already added

  // Click union line
  await page.locator('.react-flow__edge').first().click()
  await page.getByRole('menuitem', { name: 'Добавить детей' }).click()

  // Set count = 2
  await page.getByLabel('Укажите количество детей').fill('2')

  // Row 1: child
  // (default is "Ребёнок"; fill name)
  await page.getByLabel('Имя').first().fill('Лиза')
  await page.getByRole('button', { name: 'Женский' }).click()

  // Row 2: miscarriage
  // Toggle to "Выкидыш" — second row
  await page.getByRole('button', { name: 'Выкидыш' }).click()

  await page.getByRole('button', { name: 'Сохранить' }).click()

  // 2 small elements appear (1 child circle + 1 cross with В)
  await expect(page.locator('text=В')).toBeVisible()

  // Click child, edit data → Умер + Трагически
  await page.locator('.react-flow__node').filter({ hasText: 'Лиза' }).click()
  await page.getByRole('menuitem', { name: 'Редактировать данные' }).click()
  await page.getByRole('button', { name: 'Умер' }).click()
  await page.getByRole('checkbox', { name: 'Трагически' }).check()
  await page.getByRole('button', { name: 'Сохранить' }).click()

  // X marker visible inside child element
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Лиза' }).locator('line'),
  ).toHaveCount(2)
})
```

- [ ] **Step 2: Run, commit**

```bash
pnpm exec playwright test apps/e2e/genogram.spec.ts
git add apps/e2e/genogram.spec.ts
git commit -m "test(genogram): E2E for add-children + tragically marker"
```

---

### Task 45: E2E — Drag divorce mark persistence

**Files:**

- Modify: `apps/e2e/genogram.spec.ts`

- [ ] **Step 1: Append test**

```ts
test('Drag divorce mark, reload, verify persistence', async ({ page }) => {
  // ... setup: owner + partner with marriage divorced=true (set up via UI flow)

  const mark = page.locator('[data-testid="divorce-mark"]')
  await expect(mark).toBeVisible()
  const before = await mark.boundingBox()
  // Drag right
  await mark.dragTo(page.locator('canvas'), {
    targetPosition: { x: (before?.x ?? 0) + 80, y: before?.y ?? 0 },
  })
  await page.waitForTimeout(500)

  // Reload
  await page.reload()
  await expect(mark).toBeVisible()
  const after = await mark.boundingBox()
  expect(after?.x).toBeGreaterThan(before?.x ?? 0)
})
```

(Add `data-testid="divorce-mark"` to the SVG `<g>` in `UnionLineEdge.tsx`.)

- [ ] **Step 2: Run, commit**

```bash
pnpm exec playwright test apps/e2e/genogram.spec.ts
git add apps/e2e/genogram.spec.ts packages/genogram/src/edges/UnionLineEdge.tsx
git commit -m "test(genogram): E2E for divorce mark drag persistence"
```

---

### Task 46: E2E — Multi-partner ordering

**Files:**

- Modify: `apps/e2e/genogram.spec.ts`

- [ ] **Step 1: Append test**

```ts
test('Multi-partner ordinals appear and reorder via edit', async ({ page }) => {
  // ... setup with owner

  // Add partner #1 (count=1) — no number visible
  // (helper: addPartner(owner, name, sex, count))
  await addPartner(page, 'Анна', 'female', 1)
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Анна' }).locator('text'),
  ).not.toContainText('1')

  // Add partner #2 (count=2) — both partners get ordinals
  await addPartner(page, 'Мария', 'female', 2)

  await expect(page.locator('text=1')).toBeVisible()
  await expect(page.locator('text=2')).toBeVisible()

  // Edit partner #1 → set ordinal to 2
  await page.locator('.react-flow__node').filter({ hasText: 'Анна' }).click()
  await page.getByRole('menuitem', { name: 'Редактировать данные' }).click()
  await page.getByLabel('Порядковый номер партнёра').fill('2')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  // Anna now shows "2", Maria shows "1"
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Анна' }).getByText('2', { exact: true }),
  ).toBeVisible()
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Мария' }).getByText('1', { exact: true }),
  ).toBeVisible()
})

async function addPartner(page, name: string, sex: 'male' | 'female', count: number) {
  await page.locator('.react-flow__node[data-role="owner"]').click()
  await page.getByRole('menuitem', { name: 'Добавить партнёра' }).click()
  await page.getByLabel('Имя').fill(name)
  await page.getByRole('button', { name: sex === 'male' ? 'Мужской' : 'Женский' }).click()
  await page.getByLabel('Укажите количество партнёров').fill(String(count))
  await page.getByRole('button', { name: 'Сохранить' }).click()
}
```

- [ ] **Step 2: Run, commit**

```bash
pnpm exec playwright test apps/e2e/genogram.spec.ts
git add apps/e2e/genogram.spec.ts
git commit -m "test(genogram): E2E for multi-partner ordinal numbering and reorder"
```

---

## Final Steps

### Task 47: Update package exports

**Files:**

- Modify: `packages/genogram/src/index.ts`

- [ ] **Step 1: Verify all new public symbols are re-exported**

Ensure `index.ts` exports:

- All actions (`yjs/actions.ts`)
- All form components
- All UI components (DrawerHost, EmptyState, ElementMenu, EdgeMenu)
- `formatPartialDate`, `RU`
- New computed helpers
- New types

```ts
export * from './types'
export * as factories from './model/factories'
export * as transforms from './transforms'
export { computeLayout } from './layout'
export * from './hooks'
export * from './react-flow'
export * as yjs from './yjs'
export * from './forms'
export * as ui from './ui'
export { formatPartialDate } from './i18n/format-date'
export { RU } from './i18n/ru'
export {
  calcAge,
  calcAgeAtDeath,
  shouldShowDeathCross,
  hasParents,
  getChildGroupOf,
  getChildrenOf,
  getBaseOf,
  getPartnersOf,
  countPartnersOf,
  shouldShowPartnerOrder,
} from './model/computed'
```

- [ ] **Step 2: Run final check**

```bash
pnpm --filter @repo/genogram check-types
pnpm --filter @repo/genogram lint
pnpm --filter @repo/genogram test
```

All three must pass.

- [ ] **Step 3: Commit**

```bash
git add packages/genogram/src/index.ts
git commit -m "chore(genogram): re-export new public symbols"
```

---

### Task 48: Repo-wide verification

- [ ] **Step 1: Type-check across whole monorepo**

```bash
pnpm check-types
```

Expected: pass for all packages and apps.

- [ ] **Step 2: Lint**

```bash
pnpm lint
```

Expected: pass.

- [ ] **Step 3: Run all unit tests**

```bash
pnpm test
```

Expected: pass for `@repo/genogram` and other packages.

- [ ] **Step 4: Run E2E**

```bash
pnpm dev &
sleep 15
pnpm exec playwright test apps/e2e/genogram.spec.ts
```

Expected: all 5 E2E scenarios pass.

- [ ] **Step 5: Final smoke test in browser**

Manually create a GENOGRAM page in the running dev server and walk through:

- Empty state → Create
- Add partner → marriage with date
- Add children (1 person + 1 miscarriage)
- Edit child → tragically (X visible)
- Drag divorce mark
- Add second partner → ordinals appear
- Reload → state preserved

If any deviation from spec is observed, file a follow-up task.

- [ ] **Step 6: Final commit (if anything tweaked)**

```bash
# only if changes were made during smoke test
git add -A
git commit -m "fix(genogram): polish from smoke test"
```

---

## Notes for Executor

- **Do not skip TDD**. Every action/computed helper must have its test before the implementation. Tests are the contract.
- **Follow existing patterns**. Inspect neighboring files (`packages/excalidraw/src/board.tsx`, `packages/editor/src/...`) for component conventions, MUI usage, and React Flow integration patterns.
- **Use `pnpm --filter @repo/genogram <script>`** for fast iteration; full repo `pnpm test` only at the end.
- **Avoid breaking existing tests**. The existing `src/yjs/actions.test.ts` must keep passing. If it breaks because of LifeDates shape change — adapt it minimally (no behavioural changes to existing tests).
- **Persist Y.Doc consistency** — when a partner's `partnerOrder` changes, ensure all sibling partners' ordinals are also updated atomically inside `doc.transact()`.
- **Keep forms cancellable** — clicking outside drawer dispatches `cancel`; no confirmations.
- **No prod data migration** is needed (confirmed in spec). Don't write migration code.
