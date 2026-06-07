import { redirect } from 'next/navigation'

export default async function TemplateRedirect({
  params,
}: {
  params: Promise<{ templateId: string }>
}) {
  const { templateId } = await params
  redirect(`/marketplace/templates/${templateId}`)
}
