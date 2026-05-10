import { Container } from '@repo/ui/components'

import { NotificationsList } from '@/components/notifications/notifications-list'

export const metadata = { title: 'Уведомления' }

export default function NotificationsPage() {
  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 5 } }}>
      <NotificationsList />
    </Container>
  )
}
