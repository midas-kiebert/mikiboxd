import { Heading, Box } from "@chakra-ui/react";

type MovieTitleProps = {
    title: string;
};

export default function MovieTitle({ title }: MovieTitleProps) {
    return (
        <Box
            minW="fit-content"
        >
            <Heading
                as="h3"
                size="xl"
                // bg={"green.200"}
            >
                {title}
            </Heading>
        </Box>
    );
}
