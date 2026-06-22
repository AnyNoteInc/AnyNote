'use client'

import { useState } from 'react'

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  ContentCopyIcon,
  ExpandMoreIcon,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { homeTokens } from './home-tokens'

// The desktop app is not yet signed with an Apple Developer ID, so macOS
// Gatekeeper blocks it on first launch with a misleading "приложение
// повреждено" ("app is damaged") message — especially on Apple Silicon, which
// refuses unsigned apps downloaded from the internet (Safari tags them with
// com.apple.quarantine). The file is fine; the quarantine flag must be removed.
const QUARANTINE_CMD = 'xattr -dr com.apple.quarantine /Applications/AnyNote.app'

export function MacGatekeeperHelp() {
  const [copied, setCopied] = useState(false)

  async function copyCmd() {
    try {
      await navigator.clipboard.writeText(QUARANTINE_CMD)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked — the command is visible for manual copy anyway
    }
  }

  return (
    <Accordion
      disableGutters
      elevation={0}
      sx={{
        maxWidth: 620,
        width: '100%',
        bgcolor: 'transparent',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        '&::before': { display: 'none' },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="body2" fontWeight={600}>
          macOS пишет, что приложение «повреждено»?
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5} textAlign="left">
          <Typography variant="body2" color="text.secondary">
            Файл не повреждён. Приложение пока не подписано сертификатом Apple Developer ID, поэтому
            на Mac (особенно на Apple Silicon — M1/M2/M3) macOS блокирует первый запуск. Снимите
            «карантин» одной командой в Терминале:
          </Typography>

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              p: 1.25,
              borderRadius: 1.5,
              bgcolor: 'action.hover',
              fontFamily: homeTokens.fonts.mono,
              fontSize: 13,
              wordBreak: 'break-all',
            }}
          >
            <Box component="code" sx={{ flex: 1 }}>
              {QUARANTINE_CMD}
            </Box>
            <Tooltip title={copied ? 'Скопировано' : 'Скопировать'}>
              <IconButton size="small" onClick={copyCmd} aria-label="Скопировать команду">
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          <Typography variant="body2" color="text.secondary">
            После этого приложение откроется обычным двойным щелчком. Команда предполагает, что вы уже
            перетащили AnyNote в папку «Программы» (Applications).
          </Typography>

          <Typography variant="caption" color="text.disabled">
            Альтернатива без Терминала: правый клик по приложению → «Открыть», затем подтвердите
            «Открыть» в диалоге. Если появляется именно «повреждено», надёжнее команда выше.
          </Typography>
        </Stack>
      </AccordionDetails>
    </Accordion>
  )
}
