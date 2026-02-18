/**
 * Showtimes feature component: Showtimes.
 */
import type { ShowtimeLoggedIn } from "shared"
import ShowtimeCard from "./ShowtimeCard";
import MoviesContainer from "../Movies/MoviesContainer";

type ShowtimeProps = {
    showtimes: ShowtimeLoggedIn[],
}

export function Showtimes( { showtimes } : ShowtimeProps  ) {
    // Read flow: prepare derived values/handlers first, then return component JSX.
    return (
        <MoviesContainer>
            {
                showtimes.map((showtime) =>
                    <ShowtimeCard
                        showtime={showtime}
                        going_status={showtime.going}
                        key={showtime.id}
                    />
                )
            }
        </MoviesContainer>
    )
}
