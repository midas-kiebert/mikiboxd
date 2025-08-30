import { Heading, Box } from "@chakra-ui/react";
import { useIsMobile } from "@/hooks/useIsMobile";

type MovieTitleProps = {
    title: string;
};

export default function MovieTitle({ title }: MovieTitleProps) {
    const isMobile = useIsMobile();
    return (
        <Box
            maxW={isMobile ? "100%" : "50%"}
        >
            <Heading
                as="h3"
                size={isMobile ? "sm" : "xl"}
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
