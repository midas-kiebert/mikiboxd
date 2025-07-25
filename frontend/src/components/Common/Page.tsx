import { Box } from "@chakra-ui/react";
import { SIDEBAR_WIDTH } from "@/constants";
import { ReactNode } from "react";
import { TOPBAR_HEIGHT } from "@/constants";

interface Props {
    children: ReactNode;
    sidebarWidth?: number;
    topbarHeight?: number;
}

const Page = ({ children, sidebarWidth, topbarHeight } : Props) => {
    return (
        <Box
            ml={ sidebarWidth ?? SIDEBAR_WIDTH }
            right="0"
            mt={ topbarHeight ?? TOPBAR_HEIGHT }
            p={4}
        >
            { children }
        </Box>
    );
}

export default Page;
