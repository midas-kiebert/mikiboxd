/**
 * Single-movie detail feature component: Directors.
 */
import { Text } from "@chakra-ui/react";

interface DirectorsProps {
  directors: string[] | null;
}

export default function Directors({ directors }: DirectorsProps) {
    // Read flow: prepare derived values/handlers first, then return component JSX.
    if (!directors || directors.length === 0) {
        return null;
    }
    // Render/output using the state and derived values prepared above.
    return (
        <Text
            as="h3"
            mb={4}
        >
        Directed by: {directors.join(", ")}
        </Text>
    );
}
