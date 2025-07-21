// MoviesContainer.tsx
import { Box, Heading } from "@chakra-ui/react";
import { ReactNode } from "react";

type MoviesContainerProps = {
  children: ReactNode;
};

export default function MoviesContainer({ children }: MoviesContainerProps) {
  return (
    <Box
      maxW={{ base: "100%", md: "80%", lg: "60%" }}
      mx="auto"
      px={4}
      py={6}
    >
      <Heading as="h1" mb={6} fontSize="2xl" textAlign="center">
        Movies
      </Heading>
      {children}
    </Box>
  );
}
