import { VStack, Text } from "@chakra-ui/react";
import ShowtimeRow from "./ShowtimeRow"; // adjust path as needed

import type { ShowtimeInMovieLoggedIn } from "@/client";
import { UseMutateFunction } from "@tanstack/react-query";

type DayProps = {
  date: string;
  showtimes: ShowtimeInMovieLoggedIn[];
  handleToggle: UseMutateFunction<ShowtimeInMovieLoggedIn, Error, number, unknown>;
};

export default function Day({ date, showtimes, handleToggle }: DayProps) {
  const formattedDate = new Date(date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <VStack align="stretch" gap={0} my={4}>
      <Text fontSize="lg" fontWeight="bold">
        {formattedDate}
      </Text>
      {showtimes.map((showtime) => (
        <ShowtimeRow
          key={showtime.id}
          showtime={showtime}
          onToggle={() => handleToggle(showtime.id)}
        />
      ))}
    </VStack>
  );
}
