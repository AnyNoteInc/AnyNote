'use client'

import { useEffect } from 'react'

import { registerServiceWorker } from '@/lib/push/register-sw'

export function ServiceWorkerMount() {
  useEffect(() => {
    registerServiceWorker().catch(() => undefined)
  }, [])
  return null
}
