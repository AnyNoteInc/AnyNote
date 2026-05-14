import Link from 'next/link'

import { Box, Stack, Typography } from '@repo/ui/components'

import { PublicPageShell } from '@/components/public/public-page-shell'
import { legalDocuments } from '@/lib/legal-documents'
import { buildMetadata } from '@/lib/seo/build-metadata'

export const metadata = buildMetadata({
  title: 'Юридические документы',
  path: '/terms',
  description:
    'Пользовательское соглашение, политика обработки персональных данных и публичная оферта AnyNote.',
})

export default function TermsIndexPage() {
  return (
    <PublicPageShell
      eyebrow="ДОКУМЕНТЫ"
      title="Юридические документы"
      description="Полный перечень соглашений, политик и публичных оферт сервиса «Любые заметки»."
    >
      <Stack spacing={2}>
        {legalDocuments.map((doc) => (
          <Link key={doc.slug} href={doc.href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <Box
              sx={{
                display: 'block',
                p: 2.5,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                transition: 'border-color .15s, background-color .15s',
                '&:hover': { borderColor: 'primary.main', backgroundColor: 'action.hover' },
              }}
            >
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ display: 'block', mb: 0.5 }}
              >
                {doc.eyebrow}
              </Typography>
              <Typography variant="h6" sx={{ mb: 0.5 }}>
                {doc.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {doc.summary}
              </Typography>
            </Box>
          </Link>
        ))}
      </Stack>
    </PublicPageShell>
  )
}
