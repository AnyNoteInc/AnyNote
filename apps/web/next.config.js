import path from 'node:path'
import { fileURLToPath } from 'node:url'
import createMDX from '@next/mdx'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const docsDir = path.resolve(__dirname, '../../docs')

const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: ['remark-gfm'],
  },
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pg', '@prisma/client'],
  transpilePackages: [
    '@repo/ui',
    '@repo/trpc',
    '@repo/auth',
    '@repo/db',
    '@repo/notifications',
    '@repo/storage',
    '@repo/editor',
    '@repo/likec4',
    '@repo/drawio',
    '@repo/excalidraw',
    '@repo/genogram',
    '@repo/diagram-board',
    '@repo/mermaid',
    '@repo/plantuml',
    '@repo/yookassa',
  ],
  experimental: {
    optimizePackageImports: ['emoji-picker-react'],
  },
  turbopack: {
    resolveAlias: {
      '@docs': docsDir,
    },
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    }
    config.resolve.alias = {
      ...config.resolve.alias,
      '@docs': docsDir,
      // @likec4/language-services/browser transitively imports @likec4/config's
      // node entry, which top-level-imports esbuild + bundle-require (node-only
      // build tools). Neither is executed for fromSource(string) parsing, but
      // webpack can't bundle esbuild's native binary / .d.ts. Stub them to empty
      // modules. (Turbopack/dev tolerates them, so only the webpack build needs this.)
      esbuild: false,
      'bundle-require': false,
    }
    return config
  },
}

export default withMDX(nextConfig)
