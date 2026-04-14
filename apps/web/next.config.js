/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg', '@prisma/client'],
  transpilePackages: ['@repo/ui', '@repo/trpc', '@repo/auth', '@repo/storage'],
}

export default nextConfig
