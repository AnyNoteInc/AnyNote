import type { Metadata } from 'next'

import { SignUpForm } from './sign-up-form'

export const metadata: Metadata = {
  title: 'Регистрация',
}

export default function SignUpPage() {
  return <SignUpForm />
}
