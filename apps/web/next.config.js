/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg', '@prisma/client'],
  transpilePackages: ['@repo/ui', '@repo/trpc', '@repo/auth', '@repo/storage', '@repo/editor'],
}

export default nextConfig
