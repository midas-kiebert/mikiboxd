/**
 * Shared web layout/presentation component: Page.
 */
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

    // Read flow: prepare derived values/handlers first, then return component JSX.
    const isMobile = useIsMobile();


    if (isMobile) {
        sidebarWidth = 0;
        topbarHeight = 50;
    }

    // Render/output using the state and derived values prepared above.
    return (
        <Box
            ml={ sidebarWidth }
            right="0"
            mt={ `${topbarHeight}px` }
            p={isMobile ? 0 : 4}
            minH={"calc(100vh - " + (topbarHeight ?? TOPBAR_HEIGHT) + "px - 1rem)" }
            overflowX={"hidden"}
        >
            { children }
        </Box>
    );
}

export default Page;
