"use client"

import { useRouter } from "next/navigation"

import { Button } from "@repo/ui/components"

import { signOut } from "@/lib/auth-client"

export function SignOutButton() {
  const router = useRouter()
  return (
    <Button
      variant="contained"
      color="error"
      onClick={async () => {
        await signOut()
        router.push("/sign-in")
      }}
    >
      Выйти из системы
    </Button>
  )
}
