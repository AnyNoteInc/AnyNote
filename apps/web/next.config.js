/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg', '@prisma/client'],
  transpilePackages: [
    '@repo/ui',
    '@repo/trpc',
    '@repo/auth',
    '@repo/storage',
    '@repo/editor',
    '@repo/excalidraw',
  ],
  experimental: {
    optimizePackageImports: ['emoji-picker-react'],
  },
}

export default nextConfig
