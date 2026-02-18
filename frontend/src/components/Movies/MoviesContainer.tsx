/**
 * Movies list feature component: Movies Container.
 */
import { Box } from "@chakra-ui/react";
import { ReactNode } from "react";

type MoviesContainerProps = {
  children: ReactNode;
};

export default function MoviesContainer({ children }: MoviesContainerProps) {
  // Read flow: prepare derived values/handlers first, then return component JSX.
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
