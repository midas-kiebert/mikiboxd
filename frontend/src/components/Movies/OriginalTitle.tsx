/**
 * Movies list feature component: Original Title.
 */
import { Heading, Box } from "@chakra-ui/react";

type OriginalTitleProps = {
    originalTitle: string | null;
};

export default function OriginalTitle({ originalTitle }: OriginalTitleProps) {
    // Read flow: prepare derived values/handlers first, then return component JSX.
    if (!originalTitle) {
        return null;
    }
    // Render/output using the state and derived values prepared above.
    return (
        <Box
        maxW={"40%"}
        >
            <Heading
                as="h4"
                size="xs"
                whiteSpace={"nowrap"}
                overflow={"hidden"}
                textOverflow={"ellipsis"}
                fontStyle={"italic"}
                color={"gray.600"}
                fontFamily={
                    "serif"
                }
                opacity={0.75}
            >
                {originalTitle}
            </Heading>
        </Box>
    );
}
