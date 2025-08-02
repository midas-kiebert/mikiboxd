// MoviesContainer.tsx
import { Box } from "@chakra-ui/react";
import { ReactNode } from "react";

type MoviesContainerProps = {
  children: ReactNode;
};

export default function MoviesContainer({ children }: MoviesContainerProps) {
  return (
    <Box
      maxW={{ base: "100%", md: "80%", lg: "60%" }}
      mx="auto"
      py={6}
    >
      {children}
    </Box>
  );
}
