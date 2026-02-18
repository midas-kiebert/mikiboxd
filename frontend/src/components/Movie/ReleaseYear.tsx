/**
 * Single-movie detail feature component: Release Year.
 */
import { Heading } from "@chakra-ui/react";

interface ReleaseYearProps {
  releaseYear: number | null;
}

export default function ReleaseYear({ releaseYear }: ReleaseYearProps) {
    // Read flow: prepare derived values/handlers first, then return component JSX.
    if (!releaseYear) {
        return null;
    }
    // Render/output using the state and derived values prepared above.
    return (
        <Heading
            as="h1"
            size="5xl"
            mb={4}
        >
        ({releaseYear})
        </Heading>
    );
}
