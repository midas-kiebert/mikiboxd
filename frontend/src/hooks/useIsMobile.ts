/**
 * Custom web hook for Use Is Mobile. It encapsulates reusable stateful behavior.
 */
import { useBreakpointValue } from "@chakra-ui/react";

export const useIsMobile = () => {
    return useBreakpointValue({ base: true, md: false });
}
