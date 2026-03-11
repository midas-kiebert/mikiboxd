import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/friend-showtimes/$friendId")({
  beforeLoad: async ({ params }) => {
    throw redirect({
      to: "/$userId/showtimes",
      params: { userId: params.friendId },
    })
  },
})
