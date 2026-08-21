import InstallAppGate from "@/components/Common/InstallAppGate"
import MoviePage from "@/components/Movie/MoviePage"
/**
 * TanStack Router route module for movie.$movieId. It connects URL state to the matching page component.
 */
import { createFileRoute } from "@tanstack/react-router"

//@ts-ignore
export const Route = createFileRoute("/movie/$movieId")({
  component: SharedMoviePage,
})

function SharedMoviePage() {
  return (
    <InstallAppGate
      headline="Someone shared a film with you"
      body="MiKiNO shows you where and when it is playing, and which of your friends are going."
    >
      <MoviePage />
    </InstallAppGate>
  )
}
