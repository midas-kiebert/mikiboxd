import { Heading } from "@chakra-ui/react";

interface ReleaseYearProps {
  releaseYear: number | null;
}

export default function ReleaseYear({ releaseYear }: ReleaseYearProps) {
    if (!releaseYear) {
        return null;
    }
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
