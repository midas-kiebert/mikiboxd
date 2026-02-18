/**
 * Single-movie detail feature component: Movie Title.
 */
import { Heading } from "@chakra-ui/react";

interface MovieTitleProps {
  title: string;
}

export default function MovieTitle({ title }: MovieTitleProps) {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  return (
    <Heading
        as="h1"
        size="5xl"
        mb={4}
    >
      {title}
    </Heading>
  );
}
