/**
 * Single-movie detail feature component: Day.
 */
import { VStack, Text } from "@chakra-ui/react";
import ShowtimeRow from "./ShowtimeRow"; // adjust path as needed

import type { ShowtimeInMovieLoggedIn } from "shared";

type DayProps = {
  date: string;
  showtimes: ShowtimeInMovieLoggedIn[];
  onOpenShowtime: (showtime: ShowtimeInMovieLoggedIn) => void;
};

export default function Day({ date, showtimes, onOpenShowtime }: DayProps) {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const formattedDate = new Date(date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // Render/output using the state and derived values prepared above.
  return (
    <VStack align="stretch" gap={0} my={4}>
      <Text fontSize="lg" fontWeight="bold">
        {formattedDate}
      </Text>
      {showtimes.map((showtime) => (
        <ShowtimeRow
          key={showtime.id}
          showtime={showtime}
          onOpen={onOpenShowtime}
        />
      ))}
    </VStack>
  );
}
