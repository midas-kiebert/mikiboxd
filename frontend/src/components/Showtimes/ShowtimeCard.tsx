import { useIsMobile } from "@/hooks/useIsMobile"
import { Flex } from "@chakra-ui/react"
/**
 * One row in the showtimes feed.
 *
 * Presentational and selectable: it reports clicks upward and takes its
 * selected/status styling from props, so the feed owns which row is open and
 * this file stays free to be restyled. It used to be inert — the web had no way
 * at all to act on a showtime from a list.
 */
import type { GoingStatus, ShowtimePublic } from "shared"
import MoviePoster from "../Movies/MoviePoster"
import DatetimeCard from "./DatetimeCard"
import ShowtimeInfoBox from "./ShowtimeInfoBox"

type ShowtimeCardProps = {
  showtime: ShowtimePublic
  going_status: GoingStatus | undefined
  isSelected?: boolean
  onSelect?: (showtime: ShowtimePublic) => void
}

/** The row's ground colour, which is how the viewer's own status reads at a glance. */
const statusBackground = (status: GoingStatus | undefined): string => {
  if (status === "GOING") return "green.200"
  if (status === "INTERESTED") return "orange.200"
  return "gray.50"
}

const ShowtimeCard = ({
  showtime,
  going_status,
  isSelected = false,
  onSelect,
}: ShowtimeCardProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isMobile = useIsMobile()
  const HEIGHT = isMobile ? 115 : 150
  const isInteractive = Boolean(onSelect)

  const handleSelect = () => onSelect?.(showtime)

  // Render/output using the state and derived values prepared above.
  return (
    <Flex
      as={isInteractive ? "button" : "div"}
      {...(isInteractive ? { type: "button" } : {})}
      onClick={isInteractive ? handleSelect : undefined}
      textAlign="left"
      width="100%"
      cursor={isInteractive ? "pointer" : "default"}
      bg={statusBackground(going_status)}
      borderBottom="1px solid"
      borderColor="gray.200"
      borderLeftWidth="3px"
      borderLeftColor={isSelected ? "green.600" : "transparent"}
      _hover={isInteractive ? { filter: "brightness(0.97)" } : undefined}
      py={3}
      px={2}
      height={`${HEIGHT}px`}
      gap={isMobile ? 1 : 2}
      align="stretch"
    >
      <DatetimeCard showtime={showtime} />
      <MoviePoster
        movie={showtime.movie}
        size={{
          base: `calc(${HEIGHT}px * 0.85)`,
          md: `calc(${HEIGHT}px * 0.85)`,
        }}
      />
      <ShowtimeInfoBox showtime={showtime} />
    </Flex>
  )
}

export default ShowtimeCard
