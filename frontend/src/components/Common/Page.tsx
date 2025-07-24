import { Box } from "@chakra-ui/react";
import { SIDEBAR_WIDTH } from "@/constants";
import { ReactNode } from "react";
import { TOPBAR_HEIGHT } from "@/constants";

interface Props {
    children: ReactNode;
}

const Page = ({ children } : Props) => {
    return (
        <Box
            ml={SIDEBAR_WIDTH}
            right="0"
            mt={TOPBAR_HEIGHT}
            p={4}
        >
            { children }
        </Box>
    );
}

export default Page;
