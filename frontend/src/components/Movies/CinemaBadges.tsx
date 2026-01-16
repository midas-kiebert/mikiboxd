import { Box, Flex } from "@chakra-ui/react";
import CinemaBadge from "@/components/Common/CinemaBadge";
import type { CinemaPublic } from "shared";
import { useRef, useState, useLayoutEffect } from "react";
import MoreCinemas from "./MoreCinemas";

type CinemaBadgesProps = {
    cinemas: CinemaPublic[];
};

const CinemaBadges = ({ cinemas }: CinemaBadgesProps) => {

    // sort cinemas by length of name, so that the shortest names are shown first
    cinemas.sort((a, b) => a.name.length - b.name.length);

    const containerRef = useRef<HTMLDivElement>(null);
    const badgeRefs = useRef<(HTMLDivElement)[]>([]);
    const moreRef = useRef<HTMLDivElement>(null);
    const [visibleCount, setVisibleCount] = useState(cinemas.length);
    const [morePos, setMorePos] = useState(0);

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const calcVisible = () => {
            const containerRect = container.getBoundingClientRect();
            const moreEl = moreRef.current;
            const moreRect = moreEl?.getBoundingClientRect();
            if (!moreEl || !moreRect) {
                return;
            }
            let count = cinemas.length;
            for (let i = cinemas.length - 1; i >= 0; i--) {
                const badgeEl = badgeRefs.current[i];
                if (!badgeEl) continue;

                const badgeRect = badgeEl.getBoundingClientRect();
                if (badgeRect.right > containerRect.right
                    || (
                        count < cinemas.length
                        && badgeRect.right + moreRect.width + 2 > containerRect.right
                        )) {
                    count = i; // Remove this badge from the visible count
                    setMorePos(badgeRect.left - containerRect.left)
                } else {
                    break;
                }
            }
            setVisibleCount(count);
        }

        calcVisible();

        const resizeObserver = new ResizeObserver(calcVisible);
        resizeObserver.observe(container);
        return () => {
            resizeObserver.disconnect();
        }
    }, [cinemas]);

    return (
        <Box overflowX="hidden" flex={"1"} position="relative">
        <Flex
            wrap={"nowrap"}
            align="center"
            minW={0}
            ref={containerRef}
            flex={"1"} // Needed for resize observer
        >
            {cinemas.map((cinema, i) => (
                <Box
                    key={cinema.id}
                    ref={(el: any) => (badgeRefs.current[i] = el!)}
                    visibility={visibleCount > i ? "visible" : "hidden"}
                >
                    <CinemaBadge
                        cinema={cinema}
                    />
                </Box>
            ))}
            <MoreCinemas
                cinemas={cinemas}
                visibleCount={visibleCount}
                morePos={morePos}
                moreRef={moreRef}
            />
        </Flex>
        </Box>
    );
};

export default CinemaBadges;
