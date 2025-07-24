import { Box } from "@chakra-ui/react";
import { SIDEBAR_WIDTH } from "@/constants";
import { ReactNode } from "react";
import { TOPBAR_HEIGHT } from "@/constants";

interface Props {
    children?: ReactNode | null;
}



const TopBar = ({ children } : Props) => {
    return (
        <Box
            position="fixed"
            height={TOPBAR_HEIGHT}
            top="0"
            flex={"1"}
            left={SIDEBAR_WIDTH}
            right="0"
            zIndex="sticky"
            bg="gray.50"
            px={4}
            py={2}
            display="flex"
            gap={4}
        >
            { children }
        </Box>
    );
}

export default TopBar;
