import { Box } from "@chakra-ui/react";
import { SIDEBAR_WIDTH } from "@/constants";
import { ReactNode } from "react";
import { TOPBAR_HEIGHT } from "@/constants";
import { useIsMobile } from "@/hooks/useIsMobile";

interface Props {
    children: ReactNode;
    sidebarWidth?: number;
    topbarHeight?: number;
}

const Page = ({ children, sidebarWidth = SIDEBAR_WIDTH, topbarHeight = TOPBAR_HEIGHT } : Props) => {

    const isMobile = useIsMobile();


    if (isMobile) {
        sidebarWidth = 0;
        topbarHeight = 50;
    }

    return (
        <Box
            ml={ sidebarWidth }
            right="0"
            mt={ `${topbarHeight}px` }
            p={isMobile ? 0 : 4}
            minH={"calc(100vh - " + (topbarHeight ?? TOPBAR_HEIGHT) + "px - 1rem)" }
        >
            { children }
        </Box>
    );
}

export default Page;
