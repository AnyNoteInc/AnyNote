# @repo/yjs-server

Hocuspocus WebSocket server that powers real-time collaboration for AnyNote text and Excalidraw pages.

- Validates inbound JWTs against better-auth's JWKS endpoint.
- Verifies the user is a member of the page's workspace.
- Loads/saves `Y.Doc` state from `Page.contentYjs` (Bytes).
- For TEXT pages, also writes a denormalized Tiptap snapshot to `Page.content`.

## Scripts

- `pnpm dev` — watch mode
- `pnpm build` — compile to `dist/`
- `pnpm start` — run compiled server
- `pnpm lint`, `pnpm check-types`

## Env vars

- `YJS_PORT` — defaults to 1234
- `BETTER_AUTH_URL` — base URL of better-auth (used to fetch JWKS at startup)
- `BETTER_AUTH_JWT_AUDIENCE` — optional, validates `aud` claim
- `DATABASE_URL` — Postgres connection string (consumed via `@repo/db`)
