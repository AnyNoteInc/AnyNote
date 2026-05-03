/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pg', '@prisma/client'],
  transpilePackages: [
    '@repo/ui',
    '@repo/trpc',
    '@repo/auth',
    '@repo/db',
    '@repo/mail',
    '@repo/storage',
    '@repo/editor',
    '@repo/excalidraw',
    '@repo/genogram',
    '@repo/yookassa',
  ],
  experimental: {
    optimizePackageImports: ['emoji-picker-react'],
  },
  // Production build runs with `next build --webpack` (see package.json).
  // Workspace packages exported from src/ (e.g. @repo/mail, @repo/storage,
  // @repo/db, @repo/yookassa) use TypeScript's NodeNext convention:
  // `import './foo.js'` where the actual file is `./foo.ts`. Webpack doesn't
  // rewrite `.js`→`.ts` for transpilePackages by default; this teaches it to.
  // Dev still runs on Turbopack (`next dev --turbo`), which has its own
  // resolver that handles this case natively.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    }
    return config
  },
}

export default nextConfig
