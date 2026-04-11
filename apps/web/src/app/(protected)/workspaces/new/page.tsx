import { Container } from "@repo/ui/components"

import { NewWorkspaceForm } from "@/components/workspace/new-workspace-form"

export const metadata = { title: "Новое пространство" }

export default function NewWorkspacePage() {
  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <NewWorkspaceForm />
    </Container>
  )
}
