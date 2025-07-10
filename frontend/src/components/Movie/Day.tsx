import { VStack, Text } from "@chakra-ui/react";
import ShowtimeRow from "./ShowtimeRow"; // adjust path as needed

import type { ShowtimeInMoviePublic } from "@/client";

type DayProps = {
  date: string;
  showtimes: ShowtimeInMoviePublic[];
};

export default function Day({ date, showtimes }: DayProps) {
  const formattedDate = new Date(date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <VStack align="stretch" gap={0}>
      <Text fontSize="lg" fontWeight="bold">
        {formattedDate}
      </Text>
      {showtimes.map((showtime) => (
        <ShowtimeRow key={showtime.id} showtime={showtime} />
      ))}
    </VStack>
  );
}
