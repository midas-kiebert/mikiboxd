/**
 * Movies list feature component: Watchlist Toggle.
 */
import { Box, SegmentGroup } from "@chakra-ui/react";
import { useEffect, useState } from "react";

type WatchlistToggleProps = {
    watchlistOnly: boolean;
    setWatchlistOnly: (value: boolean) => void;
};


export default function WatchlistToggle({
    watchlistOnly,
    setWatchlistOnly,
}: WatchlistToggleProps) {
    // Read flow: prepare derived values/handlers first, then return component JSX.
    const [localValue, setLocalValue] = useState<string>(watchlistOnly ? "Watchlisted" : "All");

    useEffect(() => {
        setLocalValue(watchlistOnly ? "Watchlisted" : "All");
    }, [watchlistOnly])

    const handleToggle = (value: string | null) => {
        if (!value) return;
        setLocalValue(value);


        setTimeout(() => {
            setWatchlistOnly(value === "Watchlisted");
        }, 180); // Delay to let animation finish
    }

    // Render/output using the state and derived values prepared above.
    return (
        <Box>
            <SegmentGroup.Root
                value={localValue}
                onValueChange={(e) => handleToggle(e.value)}
            >
                <SegmentGroup.Indicator/>
                <SegmentGroup.Items items={["All", "Watchlisted"]}/>
            </SegmentGroup.Root>
        </Box>
    );
}
