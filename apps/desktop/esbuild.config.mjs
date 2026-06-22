import { build, context } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'

const watch = process.argv.includes('--watch')
const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
}
// The root package.json is "type": "module", but esbuild emits CommonJS for the
// Electron main/preload (Electron's `require('electron')` only works in CJS).
// Emitting .cjs files makes Node treat them as CommonJS regardless of the root
// "type", avoiding a dist-local package.json shim that confused Electron's app
// entry resolution. The renderer is a browser IIFE loaded by a <script> tag, so
// its extension is irrelevant — kept .js for the existing selection.html ref.
const entries = [
  { entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs' },
  { entryPoints: ['src/preload/main.ts'], outfile: 'dist/preload/main.cjs' },
  { entryPoints: ['src/preload/setup.ts'], outfile: 'dist/preload/setup.cjs' },
  {
    entryPoints: ['src/renderer/selection.ts'],
    outfile: 'dist/renderer/selection.js',
    platform: 'browser',
    format: 'iife',
  },
]

async function copyStatic() {
  await mkdir('dist/renderer', { recursive: true })
  await copyFile('src/renderer/selection.html', 'dist/renderer/selection.html')
}

if (watch) {
  for (const e of entries) {
    const ctx = await context({ ...common, ...e })
    await ctx.watch()
  }
  await copyStatic()
  console.log('[esbuild] watching')
} else {
  await Promise.all(entries.map((e) => build({ ...common, ...e })))
  await copyStatic()
  console.log('[esbuild] built')
}
