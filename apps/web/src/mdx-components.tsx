import type { MDXComponents } from 'mdx/types'
import type { ReactNode } from 'react'

import {
  Box,
  Divider,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@repo/ui/components'

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    h1: ({ children }) => (
      <Typography variant="h3" component="h1" sx={{ mt: 0, mb: 2.5 }}>
        {children}
      </Typography>
    ),
    h2: ({ children }) => (
      <Typography variant="h4" component="h2" sx={{ mt: 4, mb: 2 }}>
        {children}
      </Typography>
    ),
    h3: ({ children }) => (
      <Typography variant="h5" component="h3" sx={{ mt: 3, mb: 1.5 }}>
        {children}
      </Typography>
    ),
    h4: ({ children }) => (
      <Typography variant="h6" component="h4" sx={{ mt: 2.5, mb: 1.25 }}>
        {children}
      </Typography>
    ),
    p: ({ children }) => (
      <Typography variant="body1" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.7 }}>
        {children}
      </Typography>
    ),
    ul: ({ children }) => (
      <Box component="ul" sx={{ pl: 3, mb: 2, color: 'text.secondary', '& li': { mb: 0.75 } }}>
        {children}
      </Box>
    ),
    ol: ({ children }) => (
      <Box component="ol" sx={{ pl: 3, mb: 2, color: 'text.secondary', '& li': { mb: 0.75 } }}>
        {children}
      </Box>
    ),
    li: ({ children }) => (
      <Typography component="li" variant="body1" color="text.secondary" sx={{ lineHeight: 1.7 }}>
        {children}
      </Typography>
    ),
    a: ({ children, href }) => (
      <Box
        component="a"
        href={href}
        sx={{ color: 'primary.main', textDecoration: 'underline' }}
        target={href?.startsWith('http') ? '_blank' : undefined}
        rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
      >
        {children}
      </Box>
    ),
    hr: () => <Divider sx={{ my: 3 }} />,
    blockquote: ({ children }) => (
      <Box
        component="blockquote"
        sx={{
          m: 0,
          mb: 2,
          pl: 2,
          py: 0.5,
          borderLeft: '3px solid',
          borderColor: 'divider',
          color: 'text.secondary',
          fontStyle: 'italic',
        }}
      >
        {children}
      </Box>
    ),
    code: ({ children }) => (
      <Box
        component="code"
        sx={{
          fontFamily: 'monospace',
          bgcolor: 'action.hover',
          px: 0.75,
          py: 0.25,
          borderRadius: 0.5,
          fontSize: '0.92em',
        }}
      >
        {children}
      </Box>
    ),
    pre: ({ children }) => (
      <Paper
        component="pre"
        variant="outlined"
        sx={{ p: 2, mb: 2, overflow: 'auto', fontFamily: 'monospace' }}
      >
        {children}
      </Paper>
    ),
    table: ({ children }: { children?: ReactNode }) => (
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
        <Table size="small">{children}</Table>
      </TableContainer>
    ),
    thead: ({ children }: { children?: ReactNode }) => <TableHead>{children}</TableHead>,
    tbody: ({ children }: { children?: ReactNode }) => <TableBody>{children}</TableBody>,
    tr: ({ children }: { children?: ReactNode }) => <TableRow>{children}</TableRow>,
    th: ({ children }: { children?: ReactNode }) => (
      <TableCell sx={{ fontWeight: 600 }}>{children}</TableCell>
    ),
    td: ({ children }: { children?: ReactNode }) => <TableCell>{children}</TableCell>,
    wrapper: ({ children }: { children?: ReactNode }) => <Stack spacing={0}>{children}</Stack>,
  }
}
