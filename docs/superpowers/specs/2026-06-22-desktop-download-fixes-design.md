# Desktop download fixes — design

Date: 2026-06-22

Three fixes to the desktop-app download experience on the public landing page.

## 1. Move the download section to the end (before the footer)

`HomeDownload` currently renders as the **first** child of `<main>` in
`apps/web/src/app/page.tsx`. Move it to be the **last** section, after
`<HomeFinalCta />` and immediately before `<PublicFooter />`.

Because it becomes the closing section above the footer, drop its
`borderBottom` divider (added when it sat under the hero) so it sits cleanly
above the footer.

## 2. White button text in light theme

The primary download `<Button variant="contained">` in
`apps/web/src/components/public/home/home-download.tsx` renders with **dark**
text in light mode (the contained variant derives its text color from
`getContrastText` against the theme primary, which is light here).

Fix: force `color: 'common.white'` on the contained download button(s) via
`sx`. Scoped to this component only — do not change the global button theme.

## 3. Local downloads instead of GitHub releases

GitHub is private/closed, so the `releases/latest/download` links 404. Serve
the binaries from `apps/web` instead.

- `apps/web/src/lib/download-links.ts`: change `RELEASE_BASE` from the GitHub
  URL to `/downloads`, so `downloadUrl()` returns:
  - `/downloads/AnyNote.dmg`
  - `/downloads/AnyNote-Setup.exe`
  - `/downloads/AnyNote.AppImage`
  These are served statically by `apps/web` from `public/downloads/`.
- Add the `download` attribute on the download links in `home-download.tsx`
  so the browser downloads the file rather than navigating to it.
- Create `apps/web/public/downloads/` with `.gitkeep` + `README.md`
  documenting the three expected filenames. Gitignore the binaries
  themselves (`*.dmg`, `*.exe`, `*.AppImage`) so large artifacts are never
  committed.
- Add a copy script `apps/desktop/scripts/copy-to-web.mjs` and wire it as a
  post-`dist` step in `apps/desktop/package.json`. After `electron-builder`
  runs, it copies the three named installers from `apps/desktop/release/`
  into `apps/web/public/downloads/`. It copies **only** those three files and
  **skips any that are absent**, so a single-platform build (`dist:mac`)
  does not fail on missing Windows/Linux artifacts.

Artifact names already match what `download-links.ts` expects
(`electron-builder.yml`: `${productName}.${ext}` → `AnyNote.dmg` /
`AnyNote.AppImage`, win override → `AnyNote-Setup.exe`), so no rename needed.

## Verification

- `pnpm --filter web check-types` and `pnpm --filter web lint` pass.
- `pnpm --filter web dev`, then curl `/` and confirm the download section
  renders at the bottom (above the footer) and the route shape for
  `/downloads/AnyNote.dmg` is correct (404 until a build populates the
  folder, which is expected).
- Visually confirm the contained download button has white text in light
  mode.
