import InstallAppGate from "@/components/Common/InstallAppGate"
import MoviePage from "@/components/Movie/MoviePage"
import { useMovieContext } from "@/features/install-prompt"
/**
 * TanStack Router route module for movie.$movieId. It connects URL state to the matching page component.
 */
import { createFileRoute, useParams } from "@tanstack/react-router"

import {
  type FeedSearchInput,
  parseFeedParams,
} from "@/features/showtimes/feed-params"

//@ts-ignore
export const Route = createFileRoute("/movie/$movieId")({
  component: SharedMoviePage,
  // The feed's own filters, narrowing the film's run (see `MoviePage`), plus
  // the screening a notification linked to.
  validateSearch: (search: FeedSearchInput & { showtime?: number }) => ({
    ...parseFeedParams(search),
    showtime: search.showtime ? Number(search.showtime) : undefined,
  }),
})

function SharedMoviePage() {
  const { movieId } = useParams({ strict: false }) as { movieId: string }
  const movie = useMovieContext(movieId)

  return (
    <InstallAppGate
      headline={movie ? movie.title : "Someone shared a film with you"}
      card={
        movie?.poster_link
          ? {
              posterUrl: movie.poster_link,
              title: movie.title,
              subtitle: "Now in cinemas",
            }
          : null
      }
      body="MiKiNO puts every screening at your selected cinemas in one place, so you can see where and when a film is playing. Add friends to see who else wants to go."
      iosReopenHint="After installing, open the link again to go straight to this film."
    >
      <MoviePage />
    </InstallAppGate>
  )
}
