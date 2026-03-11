import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/friend-groups" as never)({
  component: RedirectFriendGroups,
})

function RedirectFriendGroups() {
  if (typeof window !== "undefined" && window.location.pathname !== "/friends") {
    window.location.replace("/friends")
  }
  return null
}
