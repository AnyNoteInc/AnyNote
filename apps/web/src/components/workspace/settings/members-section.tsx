"use client"

import { useState } from "react"

import {
  Alert,
  Button,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = {
  workspaceId: string
  locked: boolean
  currentUserId: string
}

export function WorkspaceMembersSection({ workspaceId, locked, currentUserId }: Props) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"ADMIN" | "EDITOR" | "COMMENTER" | "VIEWER">("EDITOR")
  const utils = trpc.useUtils()
  const members = trpc.workspace.listMembers.useQuery({ workspaceId })
  const invite = trpc.workspace.inviteMember.useMutation({
    onSuccess: async () => {
      setEmail("")
      await utils.workspace.listMembers.invalidate({ workspaceId })
    },
  })
  const remove = trpc.workspace.removeMember.useMutation({
    onSuccess: async () => utils.workspace.listMembers.invalidate({ workspaceId }),
  })

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Участники</Typography>
        {locked ? (
          <Alert severity="info">
            Приглашения доступны на платных тарифах. <a href="/settings/billing">Апгрейд</a>
          </Alert>
        ) : null}
        {invite.error ? <Alert severity="error">{invite.error.message}</Alert> : null}
        {remove.error ? <Alert severity="error">{remove.error.message}</Alert> : null}

        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField
            label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={locked || invite.isPending}
            size="small"
            sx={{ flex: 1 }}
          />
          <Select
            value={role}
            onChange={(event) => setRole(event.target.value as typeof role)}
            disabled={locked || invite.isPending}
            size="small"
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="ADMIN">Admin</MenuItem>
            <MenuItem value="EDITOR">Editor</MenuItem>
            <MenuItem value="COMMENTER">Commenter</MenuItem>
            <MenuItem value="VIEWER">Viewer</MenuItem>
          </Select>
          <Button
            onClick={() => invite.mutate({ workspaceId, email, role })}
            disabled={locked || invite.isPending || !email}
          >
            Пригласить
          </Button>
        </Stack>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Участник</TableCell>
              <TableCell>Роль</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {members.data?.map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  {member.user.firstName} {member.user.lastName}
                  <Typography component="span" color="text.secondary" sx={{ ml: 1 }}>
                    {member.user.email}
                  </Typography>
                </TableCell>
                <TableCell>{member.role}</TableCell>
                <TableCell align="right">
                  {member.userId !== currentUserId ? (
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      disabled={locked}
                      onClick={() => remove.mutate({ workspaceId, userId: member.userId })}
                    >
                      Удалить
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Stack>
    </Paper>
  )
}
