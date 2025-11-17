import React, { ReactNode } from "react";
import { Box } from "@chakra-ui/react";

interface LayoutProps {
  topBar: ReactNode;
  children: ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ topBar, children }) => {
  return (
    <Box
      display="grid"
      gridTemplateRows="auto 1fr"
      height="100vh"
      overflow="hidden" // Prevent body scrolling
    >
      {/* Fixed/sticky top bar */}
      <Box
        position="sticky"
        top={0}
        zIndex={100}
      >
        {topBar}
      </Box>

      {/* Scrollable content region */}
      <Box overflowY="auto">
        {children}
      </Box>
    </Box>
  );
};
