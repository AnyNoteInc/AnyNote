// Copies the desktop installers produced by electron-builder into apps/web so
// the public landing page can serve them statically from /downloads/.
//
// Runs after `pnpm --filter desktop dist` (see package.json). Only the three
// installers the website links are copied; any not produced by the current
// build (e.g. Windows/Linux artifacts on a `dist:mac` run) are silently
// skipped so single-platform builds don't fail.
import { access, copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const releaseDir = join(here, '..', 'release')
const destDir = join(here, '..', '..', 'web', 'public', 'downloads')

// Filenames must match electron-builder.yml artifactName and download-links.ts.
const ASSETS = ['AnyNote.dmg', 'AnyNote-Setup.exe', 'AnyNote.AppImage']

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

await mkdir(destDir, { recursive: true })

let copied = 0
for (const name of ASSETS) {
  const src = join(releaseDir, name)
  if (!(await exists(src))) {
    console.log(`[copy-to-web] skip (not built): ${name}`)
    continue
  }
  await copyFile(src, join(destDir, name))
  console.log(`[copy-to-web] copied: ${name}`)
  copied += 1
}

if (copied === 0) {
  console.warn(`[copy-to-web] no installers found in ${releaseDir} — nothing copied`)
} else {
  console.log(`[copy-to-web] ${copied} installer(s) → apps/web/public/downloads/`)
}
