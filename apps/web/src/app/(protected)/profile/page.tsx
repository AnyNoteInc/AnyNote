import Link from "next/link"

import { Box, Button, Container, Paper, Stack, Typography } from "@repo/ui/components"

import ProfileAvatarUploader from "@/components/profile/profile-avatar-uploader"
import { requireSession } from "@/lib/get-session"
import { getServerTRPC } from "@/trpc/server"

export const metadata = { title: "Мой профиль" }

export default async function ProfilePage() {
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const workspaces = await trpc.workspace.listMine()

  const initials =
    `${session.user.firstName.charAt(0)}${session.user.lastName.charAt(0)}`.toUpperCase()

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 8 } }}>
      <Stack alignItems="center" spacing={3}>
        <ProfileAvatarUploader currentImage={session.user.image ?? null} initials={initials} />
        <Stack alignItems="center" spacing={0.5}>
          <Typography variant="h4">
            {session.user.firstName} {session.user.lastName}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {session.user.email}
          </Typography>
        </Stack>

        <Box sx={{ width: "100%", pt: 2 }}>
          <Typography variant="overline" color="text.secondary">
            Рабочие пространства
          </Typography>
          {workspaces.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 3, textAlign: "center", mt: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                У вас пока нет рабочих пространств
              </Typography>
              <Link href="/workspaces/new" style={{ textDecoration: "none" }}>
                <Button>Создать пространство</Button>
              </Link>
            </Paper>
          ) : (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              {workspaces.map((workspace) => (
                <Paper
                  key={workspace.id}
                  variant="outlined"
                  sx={{
                    p: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                  }}
                >
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 20,
                      bgcolor: "action.hover",
                    }}
                  >
                    {workspace.icon ?? "📒"}
                  </Box>
                  <Stack spacing={0} sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body1" noWrap>
                      {workspace.name}
                    </Typography>
                  </Stack>
                  <Link href={`/workspaces/${workspace.id}`} style={{ textDecoration: "none" }}>
                    <Button size="small" variant="outlined">
                      Перейти
                    </Button>
                  </Link>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>
      </Stack>
    </Container>
  )
}
