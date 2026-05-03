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
  // Workspace packages exported from src/ (e.g. @repo/mail, @repo/storage)
  // use TypeScript's NodeNext convention: `import './foo.js'` where the
  // actual file is `./foo.ts`. Webpack doesn't rewrite `.js`→`.ts` for
  // transpilePackages by default; this teaches it to.
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
