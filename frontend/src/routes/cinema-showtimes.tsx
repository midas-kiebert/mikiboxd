import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/cinema-showtimes")({
  beforeLoad: () => {
    throw redirect({ to: "/movies" })
  },
})
