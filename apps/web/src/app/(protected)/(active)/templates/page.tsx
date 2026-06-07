import { redirect } from 'next/navigation'

// Templates are now Page rows surfaced through the marketplace; the standalone
// "Шаблоны" management page (with its "create empty template" flow) is gone.
export default function TemplatesRoute() {
  redirect('/marketplace')
}
