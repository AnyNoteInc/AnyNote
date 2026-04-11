"use client"

import { useRouter } from "next/navigation"

import { RegisterForm, type RegisterSubmitPayload } from "@repo/ui/widgets"
import { signUp } from "@/lib/auth-client"

export type SignUpFormProps = {
  titleLabel?: string
}

export function SignUpForm({ titleLabel }: SignUpFormProps) {
  const router = useRouter()

  const handleSubmit = async (values: RegisterSubmitPayload): Promise<void> => {
    await signUp.email({
      name: `${values.lastName} ${values.firstName}`,
      ...values,
      callbackURL: "/app",
    })
    router.push("/app")
    router.refresh()
  }
  return <RegisterForm titleLabel={titleLabel} onSubmit={handleSubmit} />
}
