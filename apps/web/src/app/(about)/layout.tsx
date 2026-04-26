import { Box } from "@repo/ui/components"

import { PublicFooter } from "@/components/public/public-footer"
import { PublicHeader } from "@/components/public/public-header"
import { getSession } from "@/lib/get-session"
import { TRPCReactProvider } from "@/trpc/client"

export default async function AboutLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const session = await getSession()

  return (
    <Box
      sx={{
        minHeight: "100vh",
        color: "text.primary",
        background:
          "radial-gradient(circle at 14% 16%, rgba(15, 118, 110, 0.12), transparent 18%), linear-gradient(180deg, rgba(7, 18, 24, 0.05) 0%, transparent 44%, rgba(255,255,255,0.02) 100%)",
      }}
    >
      <Box
        sx={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.14,
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.12) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage:
            "linear-gradient(180deg, rgba(0,0,0,0.92), rgba(0,0,0,0.56) 42%, transparent 100%)",
        }}
      />

      <TRPCReactProvider>
        <Box sx={{ position: "relative" }}>
          <PublicHeader session={session} />
          <main>{children}</main>
          <PublicFooter />
        </Box>
      </TRPCReactProvider>
    </Box>
  )
}
