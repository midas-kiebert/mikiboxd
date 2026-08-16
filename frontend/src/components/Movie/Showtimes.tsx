import Day from "@/components/Movie/Day"
/**
 * Single-movie detail feature component: Showtimes.
 */
import dayjs from "dayjs"

import type { ShowtimeInMoviePublic } from "shared"

type GroupedShowtimes = Record<
  string,
  { showtimesForDate: ShowtimeInMoviePublic[] }
>

export function groupShowtimesByDate(
  showtimes: ShowtimeInMoviePublic[],
): GroupedShowtimes {
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
  showtimes: ShowtimeInMoviePublic[]
  setSelectedShowtime: (showtime: ShowtimeInMoviePublic) => void
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
