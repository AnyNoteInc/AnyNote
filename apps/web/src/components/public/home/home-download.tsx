'use client'

import { useEffect, useState } from 'react'

import { Box, Button, Container, Stack, Typography } from '@repo/ui/components'

import { DESKTOP_PLATFORMS, type DesktopOS, detectOS, downloadUrl } from '@/lib/download-links'

import { homeBaseSx } from './home-tokens'
import { MacGatekeeperHelp } from './mac-gatekeeper-help'

const LABEL: Record<DesktopOS, string> = { mac: 'macOS', win: 'Windows', linux: 'Linux' }

export function HomeDownload() {
  const [primary, setPrimary] = useState<DesktopOS | null>(null)
  useEffect(() => {
    setPrimary(detectOS(navigator.userAgent))
  }, [])
  const others = DESKTOP_PLATFORMS.filter((p) => p.id !== primary)
  return (
    <Box
      component="section"
      sx={{
        ...homeBaseSx,
        borderTop: '1px solid',
        borderColor: 'divider',
        py: { xs: 5, md: 7 },
      }}
    >
      <Container maxWidth="xl">
        <Stack spacing={2} alignItems="center" textAlign="center">
          <Typography variant="h4" component="h2" fontWeight={700}>
            Десктоп-приложение AnyNote
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 560 }}>
            Нативное приложение для macOS, Windows и Linux. Работает с облаком anynote.ru или с вашим
            self-hosted сервером.
          </Typography>
          {primary ? (
            <Button
              component="a"
              href={downloadUrl(primary)}
              download
              variant="contained"
              size="large"
              // Inline style: unlayered, beats the global `a { color: inherit }`.
              // (MUI's sx color lands in @layer mui and loses to that reset.)
              style={{ color: '#fff' }}
            >
              Скачать для {LABEL[primary]}
            </Button>
          ) : (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              {DESKTOP_PLATFORMS.map((p) => (
                <Button
                  key={p.id}
                  component="a"
                  href={downloadUrl(p.id)}
                  download
                  variant="contained"
                  // Inline style: unlayered, beats the global `a { color: inherit }`.
                  style={{ color: '#fff' }}
                >
                  Скачать для {p.label}
                </Button>
              ))}
            </Stack>
          )}
          {primary && (
            <Stack direction="row" spacing={2}>
              {others.map((p) => (
                <Typography
                  key={p.id}
                  component="a"
                  href={downloadUrl(p.id)}
                  download
                  variant="body2"
                  sx={{ color: 'text.secondary', textDecoration: 'underline' }}
                >
                  Скачать для {p.label}
                </Typography>
              ))}
            </Stack>
          )}
          {/* Unsigned app: macOS Gatekeeper blocks first launch. Show the
              workaround to Mac users (and when the OS is still unknown). */}
          {(primary === 'mac' || primary === null) && (
            <Box sx={{ pt: 1, width: '100%', display: 'flex', justifyContent: 'center' }}>
              <MacGatekeeperHelp />
            </Box>
          )}
        </Stack>
      </Container>
    </Box>
  )
}
