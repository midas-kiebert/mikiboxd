import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/friend-groups")({
  beforeLoad: () => {
    throw redirect({ to: "/friends" })
  },
})
