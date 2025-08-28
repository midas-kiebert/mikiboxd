import { Text } from "@chakra-ui/react";

interface DirectorsProps {
  directors: string[] | null;
}

export default function Directors({ directors }: DirectorsProps) {
    if (!directors || directors.length === 0) {
        return null;
    }
    return (
        <Text
            as="h3"
            mb={4}
        >
        Directed by: {directors.join(", ")}
        </Text>
    );
}
