# AnyNote

AnyNote is a Turborepo monorepo for a knowledge management SaaS: the product app, landing page, shared UI, auth, database access and typed API packages live in one workspace.

## Workspace layout

- `apps/web`: product application on Next.js 16. Landing page, authentication, dashboard shell and future editor surface live here.
- `packages/ui`: shared MUI-based design system, widgets and theme providers.
- `packages/auth`: Better Auth configuration and server auth helpers.
- `packages/db`: Prisma client, schema and migrations for PostgreSQL.
- `packages/trpc`: shared typed API utilities.
- `packages/eslint-config` and `packages/typescript-config`: monorepo config packages.

## Current foundation

- Turborepo with `pnpm` workspaces
- Next.js 16 + React 19 apps
- PostgreSQL + Prisma ORM
- Better Auth with email/password and plugin foundation
- S3-compatible local storage via MinIO in `compose.yml`
- Redis and Weaviate for future async and semantic features
- Shared MUI UI package with light/dark mode support

## Local development

Install dependencies:

```bash
pnpm install
```

Start infrastructure:

```bash
docker compose up -d
```

Run all apps/packages in dev mode:

```bash
pnpm dev
```

Run only the product app:

```bash
pnpm exec turbo run dev --filter=web
```

## Useful commands

```bash
pnpm build
pnpm lint
pnpm check-types
```

## Environment

At minimum, local development expects values for:

```bash
DATABASE_URL=
BETTER_AUTH_URL=
BETTER_AUTH_SECRET=
NEXT_PUBLIC_BASE_URL=
S3_ENDPOINT=
S3_REGION=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_BUCKET=
S3_FORCE_PATH_STYLE=
```
