import { Box, SegmentGroup } from "@chakra-ui/react";




type WatchlistToggleProps = {
    watchlistOnly: boolean;
    setWatchlistOnly: (value: boolean) => void;
};


export default function WatchlistToggle({
    watchlistOnly,
    setWatchlistOnly,
}: WatchlistToggleProps) {

    const handleToggle = (value: string | null) => {
        if (!value) return;
        setWatchlistOnly(value === "Watchlisted");
    }

    return (
        <Box>
            <SegmentGroup.Root
                defaultValue={watchlistOnly ? "Watchlisted" : "All"}
                onValueChange={(e) => handleToggle(e.value)}
            >
                <SegmentGroup.Indicator />
                <SegmentGroup.Items items={["All", "Watchlisted"]}/>
            </SegmentGroup.Root>
        </Box>
    );
}
