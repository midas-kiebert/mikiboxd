import { Heading, Box } from "@chakra-ui/react";

type MovieTitleProps = {
    title: string;
};

export default function MovieTitle({ title }: MovieTitleProps) {
    return (
        <Box
        maxW={"50%"}
        >
            <Heading
                as="h3"
                size="xl"
                whiteSpace={"nowrap"}
                overflow={"hidden"}
                textOverflow={"ellipsis"}
                // bg={"green.200"}
            >
                {title}
            </Heading>
        </Box>
    );
}
