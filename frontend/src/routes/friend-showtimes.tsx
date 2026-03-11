import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/friend-showtimes")({
  beforeLoad: () => {
    throw redirect({ to: "/friends" })
  },
})
