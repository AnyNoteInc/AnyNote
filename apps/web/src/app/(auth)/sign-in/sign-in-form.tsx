"use client"

import { useRouter } from "next/navigation"

import { LoginForm, type LoginFormValues } from "@repo/ui/widgets"
import { signIn } from "@/lib/auth-client"

export function SignInForm() {
  const router = useRouter()

  const handleSubmit = async (values: LoginFormValues) => {
    await signIn.email({
      ...values,
      callbackURL: "/app",
    })
    router.push("/app")
    router.refresh()
  }

  return <LoginForm onSubmit={handleSubmit} />
}
