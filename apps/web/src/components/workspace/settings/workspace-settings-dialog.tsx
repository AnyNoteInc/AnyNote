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
  ImportExportIcon,
  PublicIcon,
  SettingsIcon,
  SmartToyIcon,
  Stack,
  StorageIcon,
  TelegramIcon,
  Typography,
  WarningAmberIcon,
  WebhookIcon,
} from '@repo/ui/components'

import { usePlanFeatures } from '@/components/workspace/plan-features-context'
import { trpc } from '@/trpc/client'

import { WorkspaceGeneralSection } from './general-section'
import { WorkspaceMembersSection } from './members-section'
import { WorkspaceAiSection } from './ai-section'
import { WorkspaceMcpSection } from './mcp-section'
import { WorkspaceWebhooksSection } from './webhooks-section'
import { WorkspaceTelegramSection } from './telegram-section'
import { WorkspaceFilesSection } from './files-section'
import { ImportExportSection } from './import-export-section'
import { WorkspacePublicPagesSection } from './public-pages-section'
import { UsageSection } from './usage-section'
import { WorkspaceDangerSection } from './danger-section'

export type SettingsSectionSlug =
  | 'general'
  | 'members'
  | 'ai'
  | 'mcp'
  | 'webhooks'
  | 'telegram'
  | 'files'
  | 'import-export'
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

  const workspace = workspaceQ.data
  // The dialog is reachable by OWNER and ADMIN (sidebar gating). ADMIN gets
  // people management plus the sections whose routers already accept ADMIN
  // (webhooks/telegram canManage, member-gated files/import-export/public);
  // billing/security-adjacent sections (AI providers, MCP, usage, danger
  // zone) stay OWNER-only.
  const isOwner = roleQ.data === 'OWNER'
  const ready = workspace && roleQ.isSuccess
  const failed = workspaceQ.isError || roleQ.isError || (workspaceQ.isSuccess && !workspace)

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
          // The workspace owner's plan gates invites (assertPaidWorkspace) —
          // not the viewer's own subscription.
          locked={!features.isPaid}
          currentUserId={currentUserId}
          isOwner={isOwner}
        />
      ),
    },
    {
      slug: 'ai',
      label: 'AI агент',
      icon: <SmartToyIcon fontSize="small" />,
      show: features.aiSettingsEnabled && isOwner,
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
      show: features.customMcpEnabled && isOwner,
      render: () => (
        <WorkspaceMcpSection
          workspaceId={workspaceId}
          isOwner={isOwner}
          customMcpEnabled={features.customMcpEnabled}
        />
      ),
    },
    {
      slug: 'webhooks',
      label: 'Вебхуки',
      icon: <WebhookIcon fontSize="small" />,
      show: features.developerSpaceEnabled,
      render: () => (
        <WorkspaceWebhooksSection
          workspaceId={workspaceId}
          canManage={roleQ.data === 'OWNER' || roleQ.data === 'ADMIN'}
        />
      ),
    },
    {
      slug: 'telegram',
      label: 'Телеграм',
      icon: <TelegramIcon fontSize="small" />,
      show: features.developerSpaceEnabled,
      render: () => (
        <WorkspaceTelegramSection
          workspaceId={workspaceId}
          canManage={roleQ.data === 'OWNER' || roleQ.data === 'ADMIN'}
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
      slug: 'import-export',
      label: 'Импорт и экспорт',
      icon: <ImportExportIcon fontSize="small" />,
      show: true,
      render: () => <ImportExportSection workspaceId={workspaceId} />,
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
      show: isOwner,
      render: () => <UsageDialogSection workspaceId={workspaceId} />,
    },
    {
      slug: 'danger',
      label: 'Опасная зона',
      icon: <WarningAmberIcon fontSize="small" />,
      show: isOwner,
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
                {/* Resolve from the VISIBLE set only — a stale or externally
                    supplied `initialSection` must never render a plan/role-
                    hidden section; fall back to the first visible one. */}
                {navItems.find((i) => i.slug === section)?.render() ??
                  navItems[0]?.render() ??
                  null}
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
