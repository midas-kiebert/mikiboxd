import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/friend-showtimes/$friendId" as never)({
  component: RedirectFriendShowtimes,
})

function RedirectFriendShowtimes() {
  const friendId = window.location.pathname.replace(/^\/friend-showtimes\//, "")

  const target = friendId
    ? `/${encodeURIComponent(friendId)}/showtimes`
    : "/friends"

  if (window.location.pathname !== target) {
    window.location.replace(target)
  }

  return null
}
