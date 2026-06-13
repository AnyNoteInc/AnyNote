'use client'

import { Button } from '@repo/ui/components'

export function RetryButton() {
  return (
    <Button
      variant="contained"
      data-testid="offline-retry-button"
      onClick={() => globalThis.location.reload()}
    >
      Повторить попытку
    </Button>
  )
}
