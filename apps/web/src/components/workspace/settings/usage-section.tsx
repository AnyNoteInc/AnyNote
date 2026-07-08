'use client'

import { Alert, Button, LinearProgress, Stack, Typography } from '@repo/ui/components'

import { formatBytes } from '@/lib/format-bytes'

import { SettingsCard } from './settings-card'

type Props = {
  limits: {
    maxMembers: number
    maxFileBytes: string
    sourcePlanSlug: string | null
  }
  usage: {
    memberCount: number
    fileBytesUsed: string
  }
  ownerPlanSlug: string
}

function clampPercent(used: number, max: number): number {
  if (max <= 0) return 100
  return Math.min(100, Math.max(0, (used / max) * 100))
}

function progressColor(percent: number): 'primary' | 'warning' | 'error' {
  if (percent >= 100) return 'error'
  if (percent >= 80) return 'warning'
  return 'primary'
}

export function UsageSection({ limits, usage, ownerPlanSlug }: Props) {
  const maxBytes = BigInt(limits.maxFileBytes)
  const usedBytes = BigInt(usage.fileBytesUsed)
  const bytesPercent = clampPercent(Number(usedBytes), Number(maxBytes))
  const memberPercent = clampPercent(usage.memberCount, limits.maxMembers)
  const remainingMembers = Math.max(0, limits.maxMembers - usage.memberCount)
  const overMembers = usage.memberCount >= limits.maxMembers
  const overBytes = usedBytes >= maxBytes
  const showOverLimit = overMembers || overBytes
  const canUpgrade = ownerPlanSlug !== 'max'
  const invitesWord = remainingMembers === 1 ? 'приглашение' : 'приглашений'

  return (
    <Stack spacing={3}>
      {showOverLimit ? (
        <Alert
          severity="error"
          action={
            canUpgrade ? (
              <Button color="inherit" size="small" href="/pricing">
                Повысить тариф
              </Button>
            ) : (
              <Button color="inherit" size="small" href="mailto:anynote@yandex.ru">
                Связаться
              </Button>
            )
          }
        >
          Достигнут лимит. Удалите ненужные файлы или участников
          {canUpgrade ? ' либо перейдите на старший тариф.' : ' либо свяжитесь с администрацией.'}
        </Alert>
      ) : null}

      <SettingsCard title="Участники" description="Сколько участников в этом пространстве.">
        <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Typography variant="body2" color="text.secondary">
            {usage.memberCount} из {limits.maxMembers}
          </Typography>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={memberPercent}
          color={progressColor(memberPercent)}
          sx={{ height: 8, borderRadius: 4 }}
        />
        <Typography variant="caption" color="text.secondary">
          {overMembers
            ? 'Лимит исчерпан. Новые приглашения заблокированы.'
            : `Доступно ещё ${remainingMembers} ${invitesWord}.`}
        </Typography>
      </SettingsCard>

      <SettingsCard
        title="Хранилище файлов"
        description="Объём активных файлов в этом пространстве."
      >
        <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Typography variant="body2" color="text.secondary">
            {formatBytes(usedBytes)} из {formatBytes(maxBytes)}
          </Typography>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={bytesPercent}
          color={progressColor(bytesPercent)}
          sx={{ height: 8, borderRadius: 4 }}
        />
        <Typography variant="caption" color="text.secondary">
          {overBytes
            ? 'Лимит хранилища исчерпан. Новые загрузки заблокированы.'
            : `Использовано ${bytesPercent.toFixed(0)}% доступного объёма.`}
        </Typography>
      </SettingsCard>
    </Stack>
  )
}
