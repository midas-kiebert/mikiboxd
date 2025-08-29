import type { ShowtimeLoggedIn } from "@/client"
import ShowtimeCard from "./ShowtimeCard";
import MoviesContainer from "../Movies/MoviesContainer";

type ShowtimeProps = {
    showtimes: ShowtimeLoggedIn[],
    highlight?: boolean,
}

export function Showtimes( { showtimes, highlight } : ShowtimeProps  ) {
    return (
        <MoviesContainer>
            {
                showtimes.map((showtime) =>
                    <ShowtimeCard
                        showtime={showtime}
                        highlight={highlight && showtime.going}
                        key={showtime.id}
                    />
                )
            }
        </MoviesContainer>
    )
}
