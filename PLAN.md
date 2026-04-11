# Project Plan: AnyNote

## Project Overview

Создание knowledge management SaaS с block-based редактором, AI-функциями, семантическим поиском и multi-tenant архитектурой.

## Architecture: Monorepo (Turborepo)

- `apps/web`: Core application (Next.js, Editor, Dashboard, Auth).
- `packages/ui`: Shared UI library (MUI/Radix).
- `packages/auth`: Authentication layer on Better Auth.
- `packages/db`: Prisma schema, client and migrations.
- `packages/trpc`: Typed API primitives.
- `packages/eslint-config` / `packages/typescript-config`: Shared configurations.

## Development Phases

### Phase 1: Infrastructure & Foundation

- [x] Initialize Turborepo monorepo.
- [x] Setup PostgreSQL with Prisma ORM.
- [x] Configure local S3-compatible storage foundation via MinIO.
- [x] Implement authentication foundation with Better Auth and Email/Password.
- [ ] Add OAuth providers, including Yandex.
- [ ] Setup CI/CD pipelines.

### Phase 2: Core UI & User Experience

- [x] Develop initial shared UI component library in `packages/ui`.
- [x] Create Authentication flows (Sign-in, Sign-up, Sign-out).
- [x] Implement Dark/Light mode support.
- [x] Keep landing page and product entrypoint in a single `apps/web` app for the current stage.
- [ ] Implement full dashboard layout with persistent sidebar and document tree state.

### Phase 3: The Editor Engine (Block-based)

- [ ] Integrate block-based editor engine (TipTap or Slate.js).
- [ ] Implement Markdown support and slash commands (`/` menu).
- [ ] Build block types: Text, Headers, Checklists, Lists.
- [ ] Implement media embedding (Images, PDFs, Audio) via drag-and-drop.

### Phase 4: Data & Document Management

- [ ] Implement CRUD operations for pages and folders.
- [ ] Implement hierarchical document structure (nested pages).
- [ ] Implement auto-save mechanism with optimistic UI.
- [ ] Implement public sharing feature for external audiences.

### Phase 5: AI & RAG Implementation

- [ ] Integrate LLM (OpenAI/Anthropic) for text processing.
- [ ] Decide vector strategy: pgvector in PostgreSQL or external vector DB.
- [ ] Implement embeddings pipeline for document indexing.
- [ ] Create AI prompt features (Summarize, Rewrite, etc.) on top of documents.
- [ ] Implement semantic search functionality (RAG).

### Phase 6: Marketing & Production Readiness

- [ ] Refine landing page and pricing flow inside `apps/web`.
- [ ] Implement pricing tiers (Free, Personal, Enterprise) end-to-end.
- [ ] Setup SaaS/On-Prem deployment strategies.
- [ ] Implement error monitoring (Sentry) and analytics (PostHog).

## Immediate Next Slice

- [ ] Add Prisma models for workspaces, pages, folders and media assets.
- [ ] Build `apps/web` dashboard data layer around real document entities.
- [ ] Introduce CRUD API for pages/folders.
- [ ] Replace static dashboard shell with live document navigation.
