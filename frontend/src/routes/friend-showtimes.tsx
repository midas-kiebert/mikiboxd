import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/friend-showtimes" as never)({
  component: RedirectFriendShowtimes,
})

function RedirectFriendShowtimes() {
  if (typeof window !== "undefined" && window.location.pathname !== "/friends") {
    window.location.replace("/friends")
  }
  return null
}
