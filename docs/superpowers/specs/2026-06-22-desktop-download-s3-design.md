# Serve desktop installers from S3 — design

Date: 2026-06-22

## Problem

Downloading a desktop installer from anynote.ru saves a 404 HTML page, not
the binary. `GET https://anynote.ru/downloads/AnyNote.dmg` → `HTTP 404`,
`content-type: text/html` (Next.js fallback).

### Root cause (evidence-backed)

The built installers and the site's download URL never connect:

- `desktop.yml` builds the 3 installers (electron-builder) and publishes them
  to **GitHub Releases** — but the repo is **PRIVATE** (`gh repo view` →
  `isPrivate: true`), so anonymous visitors can't download release assets.
- `desktop.yml` triggers on `on: push: tags: ['v*']`, but semantic-release
  pushes the tag using `GITHUB_TOKEN`, and **token-driven pushes do not fire
  downstream workflows**. Deploy works around this with an explicit
  `gh workflow run Deploy --ref <tag>` in `release.yml`; Desktop has no such
  dispatch — so **Desktop never runs on release** (v1.28.0 release has zero
  assets, no Desktop run exists for it).
- The prior fix pointed the site at `/downloads/` served from
  `apps/web/public/downloads/`, which ships **empty** in the web image
  (only `.gitkeep`).

So: binaries (when built) land on a private GitHub Release; the site looks in
an empty folder in its own image. Neither path serves anonymous visitors.

## Decision

Serve installers from the existing **S3/MinIO** storage, proxied through the
web app (the same pattern as `/api/files/[id]`, which already serves public
covers/icons). This works regardless of bucket ACL, needs no web redeploy to
update installers, and keeps binaries out of the Docker image.

## Changes

### 1. Desktop CI uploads installers to S3 (`desktop.yml`)

After each platform's `electron-builder` build, upload the produced installer
to the storage bucket under a stable `desktop/` prefix:

- `desktop/AnyNote.dmg` (mac)
- `desktop/AnyNote-Setup.exe` (win)
- `desktop/AnyNote.AppImage` (linux)

Use `aws s3 cp --endpoint-url "$S3_ENDPOINT"` with the S3 credentials added to
the workflow env (from the same secrets Deploy uses: `S3_ENDPOINT`,
`S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`). Drop
`--publish always` / GitHub release publishing (private, useless to visitors).

electron-builder writes to `apps/desktop/release/`; the upload step picks the
known artifact name per platform.

### 2. Make Desktop fire on release (`release.yml`)

Add a step mirroring the Deploy dispatch:

```yaml
- name: Trigger Desktop build on new tag
  if: steps.post.outputs.tag != '' && steps.post.outputs.tag != steps.pre.outputs.tag
  env: { GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
  run: gh workflow run Desktop --ref "${{ steps.post.outputs.tag }}"
```

### 3. Web serves binaries via a proxy route

New route `apps/web/src/app/api/download/[os]/route.ts` (`runtime = "nodejs"`),
modeled on `/api/files/[id]`:

- Map `os` ∈ {mac, win, linux} → S3 key `desktop/<asset>` + filename +
  content-type; 404 for anything else.
- Stream the object from `@repo/storage` (`storage.get(key)`), return it with
  `Content-Disposition: attachment; filename="..."` so the browser saves it,
  and a sensible `Content-Type`. 404 if the object is missing.
- No auth — public download.

`download-links.ts`: point `downloadUrl()` at `/api/download/<os>` instead of
`/downloads/<asset>`.

### 4. Revert the dead local-folder plumbing

- Delete `apps/web/public/downloads/` (`.gitkeep`, `.gitignore`, `README.md`).
- Delete `apps/desktop/scripts/copy-to-web.mjs` and revert the `dist*` /
  `copy-to-web` script changes in `apps/desktop/package.json`.

## Verification

- `pnpm --filter web check-types` + `lint`.
- Unit: `download-links.test.ts` asserts `/api/download/<os>` paths.
- Local: with MinIO up, `aws s3 cp` a dummy file to `desktop/AnyNote.dmg`, run
  web dev, `curl -I /api/download/mac` → 200, `content-type` binary,
  `content-disposition: attachment`. Without the object → 404 (not HTML).
- After deploy: real tag → Release dispatches Desktop → installers land in S3
  → `curl -I https://anynote.ru/api/download/mac` → 200 binary.

## Notes / follow-ups

- The S3 upload step needs the bucket to exist (it does — `storage`) and the
  `desktop/` prefix is created implicitly by the first upload.
- If MinIO later exposes the bucket over public HTTP, the route could be
  simplified to a redirect; the proxy route works either way today.
