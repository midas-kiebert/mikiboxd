import { Box, Text, Link } from "@chakra-ui/react";


interface BadgeProps {
    text: string;
    bgColor: string;
    hoverColor?: string;
    textColor: string;
    textSize?: string;
    url?: string;
}

const Badge = ({ text, bgColor, textColor, textSize, url, hoverColor } : BadgeProps) => {
    return (
        <>
            <Link
                href={url || "#"}
                _hover={{ textDecoration: "none" }}
                _focus={{ boxShadow: "none", outline: "none"}}
                _active={{ boxShadow: "none", outline: "none"}}
                textDecoration="none"
                width={"fit-content"}
                mx={0.5}
                my={0.5}
            >
                <Box
                    px={2}
                    py={0.5}
                    bg={bgColor}
                    width={"fit-content"}
                    display={"inline-flex"}
                    borderRadius={"2px"}
                    alignItems="center"
                    justifyContent="center"
                    _hover={{ bg: hoverColor || bgColor}}
                >
                    <Text
                        fontSize={textSize || "12px"}
                        fontWeight={"bold"}
                        color={textColor}
                        textTransform="uppercase"
                        whiteSpace="nowrap"
                    >
                        {text}
                    </Text>
                </Box>
            </Link>
        </>
    );
};

export default Badge;
