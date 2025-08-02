import type { ShowtimeLoggedIn } from "@/client"
import ShowtimeCard from "./ShowtimeCard";
import MoviesContainer from "../Movies/MoviesContainer";

type ShowtimeProps = {
    showtimes: ShowtimeLoggedIn[]
}

export function Showtimes( { showtimes } : ShowtimeProps  ) {
    return (
        <MoviesContainer>
            {
                showtimes.map((showtime) =>
                    <ShowtimeCard
                        showtime={showtime}
                        key={showtime.id}
                    />
                )
            }
        </MoviesContainer>
    )
}
