import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  Box,
  Container,
  EmailIcon,
  GitHubIcon,
  LocalPhoneIcon,
  Stack,
  TelegramIcon,
  Typography,
} from '@repo/ui/components'

import { publicContact, publicFooterSections, publicRepo } from './content'
import { Origami } from './home/origami'
import { homeTokens } from './home/home-tokens'

const t = homeTokens.palette

export function PublicFooter() {
  return (
    <Box component="footer" sx={{ bgcolor: t.ink, color: t.paperDeep, mt: { xs: 8, md: 12 } }}>
      <Container maxWidth="xl" sx={{ position: 'relative', py: { xs: 6, md: 8 } }}>
        <Box
          sx={{
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: '1.2fr 1fr 1.6fr 1fr' },
            gap: { xs: 4, md: 6 },
            pb: { xs: 4, md: 5 },
            borderBottom: '1px solid rgba(240,238,230,0.12)',
          }}
        >
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
              <Box sx={{ position: 'relative', width: 28, height: 28 }}>
                <Origami
                  variant="rhombus"
                  size={28}
                  gradient="warm"
                  style={{ position: 'static' }}
                />
              </Box>
              <Typography
                sx={{
                  fontFamily: homeTokens.fonts.serif,
                  fontSize: 22,
                  fontWeight: 500,
                  letterSpacing: '-0.01em',
                }}
              >
                Любые заметки
              </Typography>
            </Stack>
            <Typography
              sx={{ color: 'rgba(240,238,230,0.6)', fontSize: 14, lineHeight: 1.6, maxWidth: 320 }}
            >
              Рабочая память команды с ИИ-поиском. Документы, схемы, заметки и файлы — в одном
              пространстве.
            </Typography>
            <Stack direction="row" spacing={1}>
              <FooterBadge>RU · 2026</FooterBadge>
              <FooterBadge>ИИ-поиск</FooterBadge>
            </Stack>
          </Stack>

          {publicFooterSections.map((section) => (
            <Stack key={section.title} spacing={2}>
              <Typography
                sx={{
                  fontFamily: homeTokens.fonts.mono,
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: 'rgba(240,238,230,0.55)',
                }}
              >
                {section.title}
              </Typography>
              <Stack spacing={1.25}>
                {section.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    style={{ color: t.paperDeep, textDecoration: 'none', fontSize: 14 }}
                  >
                    {link.label}
                  </Link>
                ))}
              </Stack>
            </Stack>
          ))}

          <Stack spacing={2}>
            <Typography
              sx={{
                fontFamily: homeTokens.fonts.mono,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: 'rgba(240,238,230,0.55)',
              }}
            >
              Контакты
            </Typography>
            <Stack spacing={1.25}>
              <Typography sx={{ color: t.paperDeep, fontSize: 14 }}>Луферова Е.А.</Typography>
              <Typography sx={{ color: t.paperDeep, fontSize: 14 }}>ИНН: 673205843311</Typography>
              <FooterContact
                icon={<EmailIcon fontSize="small" />}
                href={`mailto:${publicContact.email}`}
              >
                {publicContact.email}
              </FooterContact>
              <FooterContact
                icon={<LocalPhoneIcon fontSize="small" />}
                href={`tel:${publicContact.phone.replaceAll(/\s|\(|\)|-/g, '')}`}
              >
                {publicContact.phone}
              </FooterContact>
              {publicContact.telegram ? (
                <FooterContact
                  icon={<TelegramIcon fontSize="small" />}
                  href={`https://t.me/${publicContact.telegram.replace(/^@/, '')}`}
                >
                  {publicContact.telegram}
                </FooterContact>
              ) : null}
            </Stack>
          </Stack>
        </Box>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}

          spacing={2}
          sx={{
            pt: 3,
            fontSize: 12,
            color: 'rgba(240,238,230,0.45)',
            alignItems: { xs: 'flex-start', sm: 'center' },
            justifyContent: 'space-between',
          }}
        >
          <span>© {new Date().getFullYear()} «Любые заметки». Все права защищены.</span>
          <Stack
            direction="row"
            spacing={2.25}
            useFlexGap
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <GitHubIcon sx={{ fontSize: 15, opacity: 0.8 }} />
              <a
                href={publicRepo.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                {publicRepo.label}
              </a>
            </Stack>
            {[
              { label: 'Политика конфиденциальности', href: '/terms/privacy-policy' },
              { label: 'Оферта', href: '/terms/public-offer' },
            ].map((l) => (
              <Link key={l.href} href={l.href} style={{ color: 'inherit', textDecoration: 'none' }}>
                {l.label}
              </Link>
            ))}
          </Stack>
        </Stack>
      </Container>
    </Box>
  )
}

function FooterBadge({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        fontFamily: homeTokens.fonts.mono,
        fontSize: 10,
        px: 1.125,
        py: 0.5,
        borderRadius: 999,
        border: '1px solid rgba(240,238,230,0.18)',
        color: 'rgba(240,238,230,0.7)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}
    >
      {children}
    </Box>
  )
}

function FooterContact({
  icon,
  href,
  children,
}: Readonly<{
  icon: ReactNode
  href: string
  children: ReactNode
}>) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Box sx={{ display: 'inline-flex', opacity: 0.7, color: homeTokens.palette.paperDeep }}>
        {icon}
      </Box>
      <Link
        href={href}
        style={{ color: homeTokens.palette.paperDeep, textDecoration: 'none', fontSize: 14 }}
      >
        {children}
      </Link>
    </Stack>
  )
}
