'use client'

import { Switch } from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import { subscribePush, unsubscribePush } from '@/lib/push/register-sw'

type Props = Readonly<{
  category: 'SECURITY' | 'COLLABORATION' | 'MARKETING'
  enabled: boolean
  locked: boolean
  onAfterChange: () => void
  hasAnySubscription: boolean
}>

export function PushToggle({
  category,
  enabled,
  locked,
  onAfterChange,
  hasAnySubscription,
}: Props) {
  const setPref = trpc.notification.setPreference.useMutation({ onSuccess: onAfterChange })
  const register = trpc.notification.registerPushSubscription.useMutation({
    onSuccess: onAfterChange,
  })

  return (
    <Switch
      checked={enabled}
      disabled={locked}
      onChange={async (_e, checked) => {
        if (checked && !hasAnySubscription) {
          const sub = await subscribePush()
          if (!sub) return
          await register.mutateAsync({
            endpoint: sub.endpoint,
            keys: sub.keys,
            userAgent: navigator.userAgent,
          })
        }
        if (!checked && hasAnySubscription) {
          await unsubscribePush().catch(() => undefined)
        }
        await setPref
          .mutateAsync({ category, channel: 'WEB_PUSH', enabled: checked })
          .catch(() => undefined)
      }}
    />
  )
}
