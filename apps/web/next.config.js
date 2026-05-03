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
}

export default nextConfig
