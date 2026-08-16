/**
 * Showtimes feature component: Showtimes.
 */
import type { ShowtimePublic } from "shared"
import MoviesContainer from "../Movies/MoviesContainer"
import ShowtimeCard from "./ShowtimeCard"

type ShowtimeProps = {
  showtimes: ShowtimePublic[]
}

export function Showtimes({ showtimes }: ShowtimeProps) {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  return (
    <MoviesContainer>
      {showtimes.map((showtime) => (
        <ShowtimeCard
          showtime={showtime}
          going_status={showtime.viewer?.going}
          key={showtime.id}
        />
      ))}
    </MoviesContainer>
  )
}
