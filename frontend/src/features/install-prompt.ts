/**
 * What the install prompt can say about a shared link before anyone signs in:
 * who sent it and which film or screening it is about. Read from small public
 * endpoints, because the prompt is shown to people with no account yet.
 *
 * A failed or slow read leaves the prompt on its generic wording rather than
 * holding it back; the copy is written to work either way.
 */
import { useQuery } from "@tanstack/react-query"
import { OpenAPI } from "shared"

import { detectMobilePlatform } from "@/app-install"

export type ShowtimeInviteContext = {
  sender_name: string | null
  movie_title: string
  movie_poster_link: string | null
  cinema_name: string
  datetime: string
}

type FriendInviteContext = { display_name: string | null }

type MovieContext = { title: string; poster_link: string | null }

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${OpenAPI.BASE}/api/v1${path}`)
  if (!response.ok) throw new Error(`${response.status}`)
  return response.json() as Promise<T>
}

// Only phones see the prompt, so only phones pay for the read.
const isPhone = () => detectMobilePlatform() !== null

export function useShowtimeInviteContext(showtimeId: string, token: string) {
  return useQuery({
    queryKey: ["install-prompt", "showtime", showtimeId, token],
    queryFn: () =>
      getJson<ShowtimeInviteContext>(
        `/showtimes/${encodeURIComponent(showtimeId)}/invite-context/${encodeURIComponent(token)}`,
      ),
    enabled: isPhone() && Boolean(showtimeId),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  }).data
}

export function useFriendInviteContext(userId: string) {
  return useQuery({
    queryKey: ["install-prompt", "friend", userId],
    queryFn: () =>
      getJson<FriendInviteContext>(
        `/friends/invite-context/${encodeURIComponent(userId)}`,
      ),
    enabled: isPhone() && Boolean(userId),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  }).data
}

export function useMovieContext(movieId: string) {
  return useQuery({
    queryKey: ["install-prompt", "movie", movieId],
    queryFn: () =>
      getJson<MovieContext>(
        `/movies/${encodeURIComponent(movieId)}?showtime_limit=0`,
      ),
    enabled: isPhone() && Boolean(movieId),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  }).data
}

/** "Thu 25 Sep, 21:15", in the visitor's own clock. */
export function formatScreeningTime(isoDatetime: string): string {
  const date = new Date(isoDatetime)
  const day = date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })
  return `${day}, ${time}`
}
