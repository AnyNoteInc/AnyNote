'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
    console.error(error)
  }, [error])

  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b151a',
          color: '#f8fafc',
          padding: '2rem',
        }}
      >
        <div
          style={{
            maxWidth: 520,
            width: '100%',
            padding: '2rem',
            border: '1px solid rgba(148,163,184,0.2)',
            borderRadius: 16,
            backgroundColor: 'rgba(16,28,33,0.8)',
            textAlign: 'center',
          }}
        >
          <p
            style={{
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              fontSize: 12,
              color: '#f87171',
              margin: 0,
            }}
          >
            Critical error
          </p>
          <h1 style={{ fontSize: 24, marginTop: 12, marginBottom: 12 }}>Приложение остановилось</h1>
          <p style={{ color: 'rgba(226,232,240,0.7)', marginBottom: 24 }}>
            Произошёл сбой на верхнем уровне. Попробуйте перезагрузить страницу.
          </p>
          {error.digest ? (
            <p style={{ fontSize: 12, color: 'rgba(226,232,240,0.5)', marginBottom: 16 }}>
              ID: {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              padding: '10px 22px',
              borderRadius: 8,
              border: 'none',
              background: '#0f766e',
              color: '#f8fafc',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Перезапустить
          </button>
        </div>
      </body>
    </html>
  )
}
