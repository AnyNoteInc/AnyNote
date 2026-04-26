import { redirect } from 'next/navigation'

export default function SettingsIndexRedirect(): never {
  redirect('/settings/general')
}
