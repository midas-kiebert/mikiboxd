/**
 * Movies list feature component: Movie Title.
 */
import { Heading, Box } from "@chakra-ui/react";

type MovieTitleProps = {
    title: string;
};

export default function MovieTitle({ title }: MovieTitleProps) {
    // Read flow: prepare derived values/handlers first, then return component JSX.
    return (
        <Box
            maxW={{base: "100%", md: "50%"}}
        >
            <Heading
                as="h3"
                size={{base: "xs", md: "xl"}}
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
