/**
 * Single-movie detail feature component: Showtimes.
 */
import dayjs from "dayjs"
import Day from "@/components/Movie/Day"

import type { ShowtimeInMovieLoggedIn } from "shared"

type GroupedShowtimes = Record<string, { showtimesForDate: ShowtimeInMovieLoggedIn[] }>

export function groupShowtimesByDate(showtimes: ShowtimeInMovieLoggedIn[]): GroupedShowtimes {
    return showtimes.reduce((acc, showtime) => {
        // Read flow: prepare derived values/handlers first, then return component JSX.
        const dateKey = dayjs(showtime.datetime).format("YYYY-MM-DD")
        if (!acc[dateKey]) {
            acc[dateKey] = { showtimesForDate: [] }
        }
        acc[dateKey].showtimesForDate.push(showtime)
        // Render/output using the state and derived values prepared above.
        return acc
    }, {} as GroupedShowtimes)
}

type ShowtimeProps = {
    showtimes: ShowtimeInMovieLoggedIn[]
    setSelectedShowtime: (showtime: ShowtimeInMovieLoggedIn) => void;
}

export function Showtimes({ showtimes, setSelectedShowtime }: ShowtimeProps) {
    const grouped = groupShowtimesByDate(showtimes)

    return (
        <>
            {Object.entries(grouped).map(([date, { showtimesForDate }]) => (
                <Day
                    key={date}
                    date={date}
                    showtimes={showtimesForDate}
                    onOpenShowtime={(showtime) => setSelectedShowtime(showtime)}
                />
            ))}
        </>
    )
}
