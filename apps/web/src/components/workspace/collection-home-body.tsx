'use client'

import { useMemo, useState } from 'react'
import NextLink from 'next/link'

import { Box, Button, Stack, Tab, Tabs, Typography } from '@repo/ui/components'

type CollectionPage = {
  id: string
  title: string | null
  icon: string | null
  createdById: string | null
}

type Collection = {
  id: string
  title: string | null
  icon: string | null
  homePageId: string | null
}

type Props = {
  collection: Collection
  pages: CollectionPage[]
  currentUserId: string
}

function PageList({ pages, emptyHint }: { pages: CollectionPage[]; emptyHint: string }) {
  if (pages.length === 0) {
    return <Typography color="text.secondary">{emptyHint}</Typography>
  }
  return (
    <Stack spacing={0.25}>
      {pages.map((page) => (
        <Box
          key={page.id}
          component={NextLink}
          href={`/pages/${page.id}`}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 1.5,
            py: 0.75,
            borderRadius: 1,
            color: 'text.primary',
            textDecoration: 'none',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <span style={{ fontSize: 16 }}>{page.icon ?? '📄'}</span>
          <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
            {page.title ?? 'Без названия'}
          </Typography>
        </Box>
      ))}
    </Stack>
  )
}

export function CollectionHomeBody({ collection, pages, currentUserId }: Props) {
  const [tab, setTab] = useState(0)

  const myPages = useMemo(
    () => pages.filter((p) => p.createdById === currentUserId),
    [pages, currentUserId],
  )

  return (
    <Box sx={{ p: 4, maxWidth: 760, mx: 'auto', width: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <span style={{ fontSize: 28 }}>{collection.icon ?? '📁'}</span>
        <Typography variant="h5" sx={{ minWidth: 0 }} noWrap>
          {collection.title ?? 'Коллекция'}
        </Typography>
      </Box>

      <Tabs
        value={tab}
        onChange={(_, next: number) => setTab(next)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
      >
        <Tab label="Home" sx={{ minHeight: 40, textTransform: 'none' }} />
        <Tab label="Все страницы" sx={{ minHeight: 40, textTransform: 'none' }} />
        <Tab label="Мои страницы" sx={{ minHeight: 40, textTransform: 'none' }} />
      </Tabs>

      {tab === 0 &&
        (collection.homePageId ? (
          <Button component={NextLink} href={`/pages/${collection.homePageId}`} variant="outlined">
            Открыть главную страницу
          </Button>
        ) : (
          <Typography color="text.secondary">Главная страница не задана</Typography>
        ))}

      {tab === 1 && <PageList pages={pages} emptyHint="Нет страниц" />}

      {tab === 2 && <PageList pages={myPages} emptyHint="Вы не создавали страниц здесь" />}
    </Box>
  )
}
