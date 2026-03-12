/**
 * Shared web layout/presentation component: Page.
 */
import { Box } from "@chakra-ui/react";
import { PAGE_NOTICE_BANNER_OFFSET_CSS_VAR, SIDEBAR_WIDTH } from "@/constants";
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
    const pageNoticeOffset = `var(${PAGE_NOTICE_BANNER_OFFSET_CSS_VAR}, 0px)`

    // Render/output using the state and derived values prepared above.
    return (
        <Box
            ml={ sidebarWidth }
            right="0"
            mt={`calc(${pageNoticeOffset} + ${topbarHeight}px)`}
            p={isMobile ? 0 : 4}
            minH={`calc(100vh - ${pageNoticeOffset} - ${topbarHeight}px - 1rem)`}
            overflowX={"hidden"}
        >
            { children }
        </Box>
    );
}

export default Page;
