import dayjs from "dayjs"
import Day from "@/components/Movie/Day"

import type { ShowtimeInMoviePublic } from "@/client"

type GroupedShowtimes = Record<string, { showtimesForDate: ShowtimeInMoviePublic[] }>

export function groupShowtimesByDate(showtimes: ShowtimeInMoviePublic[]): GroupedShowtimes {
    return showtimes.reduce((acc, showtime) => {
        const dateKey = dayjs(showtime.datetime).format("YYYY-MM-DD")
        if (!acc[dateKey]) {
            acc[dateKey] = { showtimesForDate: [] }
        }
        acc[dateKey].showtimesForDate.push(showtime)
        return acc
    }, {} as GroupedShowtimes)
}

type ShowtimeProps = {
    showtimes: ShowtimeInMoviePublic[]
}

export function Showtimes( { showtimes } : ShowtimeProps  ) {
    const grouped = groupShowtimesByDate(showtimes)

    return (
        <>
            {Object.entries(grouped).map(([date, { showtimesForDate}]) => (
                <Day
                    key={date}
                    date={date}
                    showtimes={showtimesForDate}
                />
            ))}
        </>
    )
}