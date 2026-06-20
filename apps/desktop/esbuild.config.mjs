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
const entries = [
  { entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js' },
  { entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js' },
  {
    entryPoints: ['src/renderer/selection.ts'],
    outfile: 'dist/renderer/selection.js',
    platform: 'browser',
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
