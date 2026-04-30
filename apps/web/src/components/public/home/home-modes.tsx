import { Box, Container, Stack, Typography } from '@repo/ui/components'
import { eyebrowSx, sectionTitleSx, homeTokens } from './home-tokens'

const t = homeTokens.palette

type Mode = { icon: string; title: string; body: string; mini: 'doc' | 'canvas' | 'chat' | 'share' }
const modes: Mode[] = [
  { icon: '📄', title: 'Документы', body: 'Заметки, договоры, брифы и регламенты живут в структуре, которую понимает вся команда.', mini: 'doc' },
  { icon: '🎨', title: 'Схемы и холсты', body: 'Сложные процессы можно объяснять визуально рядом с текстом — без отдельной Miro.', mini: 'canvas' },
  { icon: '💬', title: 'ИИ-чаты', body: 'Помощник отвечает по материалам пространства и сохраняет контекст для следующего шага.', mini: 'chat' },
  { icon: '🔗', title: 'Публичные ссылки', body: 'Клиент видит чистую страницу с нужными материалами — без пересылки десятков вложений.', mini: 'share' },
]

export function HomeModes() {
  return (
    <Box component="section" id="modes" sx={{ bgcolor: '#fff', borderBlock: `1px solid ${t.line}`, py: { xs: 7, md: 11 } }}>
      <Container maxWidth="xl">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.8fr 1.2fr' }, gap: { xs: 4, lg: 7 }, alignItems: 'start' }}>
          <Stack spacing={2} sx={{ position: { lg: 'sticky' }, top: { lg: 96 } }}>
            <Typography sx={eyebrowSx}>РАБОЧЕЕ ПРОСТРАНСТВО</Typography>
            <Typography component="h2" sx={sectionTitleSx}>
              Один продукт — <em>четыре режима работы</em>
            </Typography>
            <Typography sx={{ color: t.inkSoft, fontSize: 16, lineHeight: 1.6, maxWidth: 460 }}>
              Текст, схемы, ИИ-чаты и публичные ссылки в одном дереве страниц. Не нужно переключаться между четырьмя инструментами.
            </Typography>
          </Stack>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, borderTop: `1px solid ${t.line}`, borderLeft: { sm: `1px solid ${t.line}` } }}>
            {modes.map((m) => (
              <Box
                key={m.title}
                sx={{
                  p: 3.25, borderRight: { sm: `1px solid ${t.line}` }, borderBottom: `1px solid ${t.line}`,
                  bgcolor: '#fff', transition: 'background .2s ease',
                  '&:hover': { bgcolor: t.paper },
                }}
              >
                <Box sx={{ width: 38, height: 38, bgcolor: 'rgba(201,100,66,0.12)', borderRadius: 1, display: 'grid', placeItems: 'center', fontSize: 18, color: t.orange, mb: 2.25 }}>
                  {m.icon}
                </Box>
                <Typography sx={{ fontFamily: homeTokens.fonts.serif, fontSize: 22, fontWeight: 500, mb: 1, letterSpacing: '-0.01em' }}>
                  {m.title}
                </Typography>
                <Typography sx={{ color: t.inkSoft, fontSize: 14, lineHeight: 1.6, mb: 2.25 }}>{m.body}</Typography>
                <ModeMini variant={m.mini} />
              </Box>
            ))}
          </Box>
        </Box>
      </Container>
    </Box>
  )
}

function ModeMini({ variant }: { variant: Mode['mini'] }) {
  const wrapper = { bgcolor: homeTokens.palette.paper, border: `1px solid ${homeTokens.palette.line}`, borderRadius: 1, p: 1.5, minHeight: 100, position: 'relative' as const, overflow: 'hidden' }
  if (variant === 'doc') {
    const lines = [{ h: 10, w: '50%', dark: true }, { h: 7, w: '88%', dark: false }, { h: 7, w: '72%', dark: false }, { h: 7, w: '80%', dark: false }, { h: 7, w: '88%', dark: false }] as const
    return (
      <Box sx={wrapper}>
        {lines.map((l, i) => (
          <Box key={i} sx={{ height: l.h, width: l.w, borderRadius: 0.25, bgcolor: l.dark ? homeTokens.palette.ink : 'rgba(0,0,0,0.1)', mb: 0.75 }} />
        ))}
      </Box>
    )
  }
  if (variant === 'canvas') {
    return (
      <Box sx={{ ...wrapper, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.25 }}>
        <Box aria-hidden sx={{ position: 'absolute', top: '50%', left: '12%', right: '12%', height: '1px', bgcolor: 'rgba(0,0,0,0.15)' }} />
        <Box sx={{ width: 36, height: 36, borderRadius: '50%', bgcolor: homeTokens.palette.ink, boxShadow: '2px 2px 6px rgba(0,0,0,0.1)', position: 'relative' }} />
        <Box sx={{ width: 40, height: 40, bgcolor: homeTokens.palette.orange, clipPath: 'polygon(50% 0, 100% 100%, 0 100%)', boxShadow: '2px 2px 6px rgba(0,0,0,0.1)', position: 'relative' }} />
        <Box sx={{ width: 36, height: 36, borderRadius: 0.75, bgcolor: homeTokens.palette.orangeWarm, transform: 'rotate(15deg)', boxShadow: '2px 2px 6px rgba(0,0,0,0.1)', position: 'relative' }} />
      </Box>
    )
  }
  if (variant === 'chat') {
    return (
      <Stack spacing={0.75} sx={wrapper}>
        <Box sx={{ alignSelf: 'flex-end', bgcolor: homeTokens.palette.ink, color: homeTokens.palette.paperDeep, borderRadius: 1.25, px: 1.25, py: 0.75, fontSize: 11, maxWidth: '80%' }}>Что мы обещали клиенту?</Box>
        <Box sx={{ alignSelf: 'flex-start', bgcolor: 'rgba(201,100,66,0.12)', color: homeTokens.palette.ink, border: '1px solid rgba(201,100,66,0.22)', borderRadius: 1.25, px: 1.25, py: 0.75, fontSize: 11, maxWidth: '80%' }}>
          <Box component="span" sx={{ color: homeTokens.palette.orange, mr: 0.5 }}>✦</Box>
          Редизайн сайта и отчёт. Срок — 25 апреля.
        </Box>
      </Stack>
    )
  }
  return (
    <Stack spacing={1} sx={wrapper}>
      <Box sx={{ fontFamily: homeTokens.fonts.mono, fontSize: 10, bgcolor: '#fff', border: '1px dashed rgba(0,0,0,0.2)', p: '6px 9px', borderRadius: 0.75, color: 'rgba(0,0,0,0.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        любые-заметки.app/<Box component="span" sx={{ color: homeTokens.palette.orange }}>share/abc123</Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: '30px 1fr', gap: 1, bgcolor: '#fff', border: `1px solid ${homeTokens.palette.line}`, borderRadius: 0.75, p: 0.875 }}>
        <Box sx={{ bgcolor: homeTokens.palette.ink, borderRadius: 0.5 }} />
        <Stack spacing={0.5} justifyContent="center">
          <Box sx={{ height: 5, width: '80%', borderRadius: 0.25, bgcolor: 'rgba(0,0,0,0.18)' }} />
          <Box sx={{ height: 5, width: '60%', borderRadius: 0.25, bgcolor: 'rgba(0,0,0,0.1)' }} />
        </Stack>
      </Box>
    </Stack>
  )
}
