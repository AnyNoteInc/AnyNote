'use client'

import { useEffect, useState, type ReactNode } from 'react'

import {
  BarChartIcon,
  Box,
  CloseIcon,
  CircularProgress,
  Dialog,
  GroupIcon,
  HubIcon,
  IconButton,
  PublicIcon,
  SettingsIcon,
  SmartToyIcon,
  Stack,
  StorageIcon,
  Typography,
  WarningAmberIcon,
} from '@repo/ui/components'

import { usePlanFeatures } from '@/components/workspace/plan-features-context'
import { trpc } from '@/trpc/client'

import { WorkspaceGeneralSection } from './general-section'
import { WorkspaceMembersSection } from './members-section'
import { WorkspaceAiSection } from './ai-section'
import { WorkspaceMcpSection } from './mcp-section'
import { WorkspaceFilesSection } from './files-section'
import { WorkspacePublicPagesSection } from './public-pages-section'
import { UsageSection } from './usage-section'
import { WorkspaceDangerSection } from './danger-section'

export type SettingsSectionSlug =
  | 'general'
  | 'members'
  | 'ai'
  | 'mcp'
  | 'files'
  | 'public'
  | 'usage'
  | 'danger'

type SettingsItem = {
  slug: SettingsSectionSlug
  label: string
  icon: ReactNode
  show: boolean
  render: () => ReactNode
}

type Props = {
  open: boolean
  onClose: () => void
  workspaceId: string
  currentUserId: string
  initialSection?: SettingsSectionSlug
}

export function WorkspaceSettingsDialog({
  open,
  onClose,
  workspaceId,
  currentUserId,
  initialSection = 'general',
}: Props) {
  const features = usePlanFeatures()
  const [section, setSection] = useState<SettingsSectionSlug>(initialSection)
  useEffect(() => {
    if (open) setSection(initialSection)
  }, [open, initialSection])
  const titleId = 'workspace-settings-dialog-title'

  const workspaceQ = trpc.workspace.getById.useQuery({ id: workspaceId }, { enabled: open })
  const roleQ = trpc.workspace.getMyRole.useQuery({ workspaceId }, { enabled: open })
  const planQ = trpc.subscription.getCurrent.useQuery(undefined, { enabled: open })

  const workspace = workspaceQ.data
  const isOwner = roleQ.data === 'OWNER'
  const planSlug = planQ.data?.plan.slug ?? null
  const ready = workspace && roleQ.isSuccess && planQ.isSuccess
  const failed =
    workspaceQ.isError || roleQ.isError || planQ.isError || (workspaceQ.isSuccess && !workspace)

  const items: SettingsItem[] = [
    {
      slug: 'general',
      label: 'Общее',
      icon: <SettingsIcon fontSize="small" />,
      show: true,
      render: () =>
        workspace ? (
          <WorkspaceGeneralSection
            workspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon }}
            isOwner={isOwner}
          />
        ) : null,
    },
    {
      slug: 'members',
      label: 'Участники',
      icon: <GroupIcon fontSize="small" />,
      show: features.membersSettingsEnabled,
      render: () => (
        <WorkspaceMembersSection
          workspaceId={workspaceId}
          locked={planSlug === 'personal'}
          currentUserId={currentUserId}
        />
      ),
    },
    {
      slug: 'ai',
      label: 'AI агент',
      icon: <SmartToyIcon fontSize="small" />,
      show: features.aiSettingsEnabled,
      render: () => (
        <WorkspaceAiSection
          workspaceId={workspaceId}
          isOwner={isOwner}
          customProvidersEnabled={features.customAiProvidersEnabled}
        />
      ),
    },
    {
      slug: 'mcp',
      label: 'MCP серверы',
      icon: <HubIcon fontSize="small" />,
      show: features.customMcpEnabled,
      render: () => (
        <WorkspaceMcpSection
          workspaceId={workspaceId}
          isOwner={isOwner}
          customMcpEnabled={features.customMcpEnabled}
        />
      ),
    },
    {
      slug: 'files',
      label: 'Библиотека',
      icon: <StorageIcon fontSize="small" />,
      show: true,
      render: () => (
        <WorkspaceFilesSection workspaceId={workspaceId} currentUserId={currentUserId} />
      ),
    },
    {
      slug: 'public',
      label: 'Публичные страницы',
      icon: <PublicIcon fontSize="small" />,
      show: true,
      render: () => <WorkspacePublicPagesSection workspaceId={workspaceId} />,
    },
    {
      slug: 'usage',
      label: 'Использование',
      icon: <BarChartIcon fontSize="small" />,
      show: true,
      render: () => <UsageDialogSection workspaceId={workspaceId} />,
    },
    {
      slug: 'danger',
      label: 'Опасная зона',
      icon: <WarningAmberIcon fontSize="small" />,
      show: true,
      render: () =>
        workspace ? (
          <WorkspaceDangerSection
            workspace={{ id: workspace.id, name: workspace.name }}
            isOwner={isOwner}
          />
        ) : null,
    },
  ] satisfies SettingsItem[]
  const navItems = items.filter((i) => i.show)

  return (
    <Dialog open={open} onClose={onClose} fullScreen aria-labelledby={titleId}>
      <Stack direction="row" sx={{ height: '100%', minHeight: 0 }}>
        <Box
          sx={{
            width: 248,
            flexShrink: 0,
            borderRight: '1px solid',
            borderColor: 'divider',
            p: 2,
            overflowY: 'auto',
          }}
        >
          <Typography variant="subtitle2" sx={{ mb: 1.5, px: 1 }}>
            Настройки
          </Typography>
          <Stack spacing={0.5} component="nav">
            {navItems.map((item) => {
              const active = item.slug === section
              return (
                <Box
                  key={item.slug}
                  component="button"
                  type="button"
                  onClick={() => setSection(item.slug)}
                  aria-current={active ? 'page' : undefined}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    p: '6px 10px',
                    borderRadius: 0.75,
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                    font: 'inherit',
                    fontSize: 14,
                    color: active ? 'text.primary' : 'text.secondary',
                    fontWeight: active ? 600 : 400,
                    bgcolor: active ? 'action.selected' : 'transparent',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Box>
              )
            })}
          </Stack>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            <Typography variant="h6" id={titleId}>
              {workspace?.name ?? 'Настройки'}
            </Typography>
            <IconButton onClick={onClose} aria-label="Закрыть">
              <CloseIcon />
            </IconButton>
          </Stack>

          <Box sx={{ flex: 1, minWidth: 0, overflowY: 'auto', p: { xs: 2, md: 4 } }}>
            {failed ? (
              <Box sx={{ p: 4 }}>
                <Typography color="error">Не удалось загрузить настройки.</Typography>
              </Box>
            ) : !ready ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Box sx={{ maxWidth: 880, mx: 'auto' }}>
                {items.find((i) => i.slug === section)?.render() ?? null}
              </Box>
            )}
          </Box>
        </Box>
      </Stack>
    </Dialog>
  )
}

// Usage needs its own query (workspace.getUsage). Kept inline so the dialog
// stays a single coordination point.
function UsageDialogSection({ workspaceId }: { workspaceId: string }) {
  const usageQ = trpc.workspace.getUsage.useQuery({ workspaceId })
  if (!usageQ.data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    )
  }
  return <UsageSection {...usageQ.data} />
}
