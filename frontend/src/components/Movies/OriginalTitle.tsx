import { Heading, Box } from "@chakra-ui/react";

type OriginalTitleProps = {
    originalTitle: string | null;
};

export default function OriginalTitle({ originalTitle }: OriginalTitleProps) {
    if (!originalTitle) {
        return null;
    }
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
