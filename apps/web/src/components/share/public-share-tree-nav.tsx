'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'

import {
  ArticleIcon,
  Box,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@repo/ui/components'

import { PageIcon } from '@/components/page/page-icon'

export type ShareTreeNode = {
  id: string
  title: string | null
  icon: string | null
  parentId: string | null
}

type Props = {
  shareId: string
  rootId: string
  rootTitle: string | null
  rootIcon: string | null
  nodes: ShareTreeNode[]
}

type Rendered = ShareTreeNode & { depth: number }

// Flatten the parent/child node list into a depth-ordered list for rendering.
// Stable, cycle-safe: each node is emitted once, children follow their parent.
function flatten(rootId: string, nodes: ShareTreeNode[]): Rendered[] {
  const byParent = new Map<string, ShareTreeNode[]>()
  for (const node of nodes) {
    const key = node.parentId ?? '__root__'
    const list = byParent.get(key) ?? []
    list.push(node)
    byParent.set(key, list)
  }
  const out: Rendered[] = []
  const seen = new Set<string>()
  const walk = (parentId: string, depth: number) => {
    for (const child of byParent.get(parentId) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push({ ...child, depth })
      walk(child.id, depth + 1)
    }
  }
  walk(rootId, 1)
  return out
}

/**
 * Public site navigation sidebar (SITE mode only). Renders the share root plus
 * its published subtree as links to `/s/[shareId]` and
 * `/s/[shareId]/[childPageId]`. We use `next/link` directly (this is a client
 * component, so passing a function-backed component is fine — the RSC→client
 * function-prop rule does not apply here).
 */
export function PublicShareTreeNav({ shareId, rootId, rootTitle, rootIcon, nodes }: Props) {
  const pathname = usePathname()
  const items = flatten(rootId, nodes)

  const rootHref = `/s/${shareId}`
  const isActive = (href: string) => pathname === href

  return (
    <Box
      component="nav"
      sx={{
        width: 260,
        flexShrink: 0,
        borderRight: 1,
        borderColor: 'divider',
        overflowY: 'auto',
        py: 1,
        display: { xs: 'none', md: 'block' },
      }}
    >
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ px: 2, display: 'block', mb: 0.5 }}
      >
        Содержание
      </Typography>
      <List dense disablePadding>
        <ListItemButton
          component={Link}
          href={rootHref}
          selected={isActive(rootHref)}
          sx={{ pl: 2, borderRadius: 1, mx: 0.5 }}
        >
          <Box
            component="span"
            sx={{ mr: 1, width: 18, display: 'inline-flex', justifyContent: 'center' }}
          >
            {rootIcon ? (
              <PageIcon icon={rootIcon} size={16} />
            ) : (
              <ArticleIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            )}
          </Box>
          <ListItemText
            primary={rootTitle || 'Без названия'}
            slotProps={{ primary: { noWrap: true, variant: 'body2' } }}
          />
        </ListItemButton>
        {items.map((node) => {
          const href = `/s/${shareId}/${node.id}`
          return (
            <ListItemButton
              key={node.id}
              component={Link}
              href={href}
              selected={isActive(href)}
              sx={{ pl: 2 + node.depth * 1.5, borderRadius: 1, mx: 0.5 }}
            >
              <Box
                component="span"
                sx={{ mr: 1, width: 18, display: 'inline-flex', justifyContent: 'center' }}
              >
                {node.icon ? (
                  <PageIcon icon={node.icon} size={16} />
                ) : (
                  <ArticleIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                )}
              </Box>
              <ListItemText
                primary={node.title || 'Без названия'}
                slotProps={{ primary: { noWrap: true, variant: 'body2' } }}
              />
            </ListItemButton>
          )
        })}
      </List>
    </Box>
  )
}
