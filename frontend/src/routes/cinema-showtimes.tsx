import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/cinema-showtimes" as never)({
  component: RedirectCinemaShowtimes,
})

function RedirectCinemaShowtimes() {
  if (typeof window !== "undefined" && window.location.pathname !== "/movies") {
    window.location.replace("/movies")
  }

  return null
}
