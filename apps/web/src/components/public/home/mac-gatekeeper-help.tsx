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

// The desktop app is ad-hoc signed but not notarized with an Apple Developer ID,
// so macOS Gatekeeper blocks the first launch with the standard "от
// неустановленного разработчика" ("unidentified developer") prompt. The simple
// fix is right-click → «Открыть». The Terminal command below is a fallback (e.g.
// if macOS still shows «повреждено» on an older cached download).
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
          macOS не даёт открыть приложение?
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5} textAlign="left">
          <Typography variant="body2" color="text.secondary">
            Приложение подписано, но ещё не нотаризовано в Apple, поэтому при первом запуске macOS
            показывает предупреждение «от неустановленного разработчика». Самый простой способ:{' '}
            <Box component="strong" sx={{ color: 'text.primary' }}>
              правый клик по AnyNote → «Открыть»
            </Box>{' '}
            и подтвердите «Открыть» в диалоге. Это нужно один раз.
          </Typography>

          <Typography variant="body2" color="text.secondary">
            Если macOS всё равно пишет «повреждено» (например, для раньше скачанного файла), снимите
            «карантин» командой в Терминале:
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

          <Typography variant="caption" color="text.disabled">
            После этого приложение откроется обычным двойным щелчком. Команда предполагает, что вы уже
            перетащили AnyNote в папку «Программы» (Applications).
          </Typography>
        </Stack>
      </AccordionDetails>
    </Accordion>
  )
}
