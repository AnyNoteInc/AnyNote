# Desktop installers

The public landing page (`/`, via `home-download.tsx` → `download-links.ts`)
links the desktop app installers from this folder. They are served statically
at:

- `/downloads/AnyNote.dmg` — macOS
- `/downloads/AnyNote-Setup.exe` — Windows
- `/downloads/AnyNote.AppImage` — Linux

These three files are **build artifacts** and are gitignored (see
`.gitignore`). They are produced by `electron-builder` in
`apps/desktop/release/` and copied here automatically by the desktop `dist`
build:

```bash
pnpm --filter desktop dist          # all platforms available on this host
pnpm --filter desktop dist:mac      # macOS only — copies just AnyNote.dmg
```

The copy step (`apps/desktop/scripts/copy-to-web.mjs`) only copies the three
named installers and silently skips any that the current build did not
produce, so single-platform builds don't fail.

Until a build has run, these files are absent and the download links 404 —
that is expected in a fresh checkout / dev environment.
