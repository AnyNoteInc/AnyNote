import type { Metadata } from 'next'

import {
  Box,
  Paper,
  Stack,
  Step,
  StepContent,
  StepLabel,
  Stepper,
  Typography,
} from '@repo/ui/components'

import { PublicPageShell } from '@/components/public/public-page-shell'
import { roadmapItems } from '@/components/public/content'

export const metadata: Metadata = {
  title: 'Наши планы',
}

export default function RoadmapPage() {
  return (
    <PublicPageShell
      eyebrow="Roadmap"
      title="Продуктовый план ближайших релизов"
      description="Роудмап показывает последовательность вертикальных срезов, которые превращают foundation монорепы в рабочий knowledge workspace."
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '320px minmax(0, 1fr)' },
          gap: 3,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: 3,
            borderRadius: 2,
            border: '1px solid rgba(148,163,184,0.16)',
            alignSelf: 'start',
          }}
        >
          <Stack spacing={1.5}>
            <Typography variant="overline" color="text.secondary">
              Фокус 2026
            </Typography>
            <Typography variant="h5">От редактора к ИИ knowledge-платформе</Typography>
            <Typography color="text.secondary">
              Приоритет у пользовательского сценария, затем у поиска по знаниям и интеграций с
              российскими CRM и телефонией.
            </Typography>
          </Stack>
        </Paper>

        <Paper
          elevation={0}
          sx={{
            p: 3,
            borderRadius: 2,
            border: '1px solid rgba(148,163,184,0.16)',
          }}
        >
          <Stepper orientation="vertical" activeStep={0} nonLinear>
            {roadmapItems.map((item, index) => (
              <Step key={item}>
                <StepLabel>
                  <Typography fontWeight={700}>{item}</Typography>
                </StepLabel>
                <StepContent>
                  <Typography color="text.secondary">
                    Этап {index + 1}. Этот блок запланирован как отдельный продуктовый инкремент
                    внутри текущей монорепы.
                  </Typography>
                </StepContent>
              </Step>
            ))}
          </Stepper>
        </Paper>
      </Box>
    </PublicPageShell>
  )
}
