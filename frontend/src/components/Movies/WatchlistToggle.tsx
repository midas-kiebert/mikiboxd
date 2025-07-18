type WatchlistToggleProps = {
    watchlistOnly: boolean;
    setWatchlistOnly: (value: boolean) => void;
};

export default function WatchlistToggle({
    watchlistOnly,
    setWatchlistOnly,
}: WatchlistToggleProps) {
    return (
        <label>
            <input
                type="checkbox"
                checked={watchlistOnly}
                onChange={(e) => setWatchlistOnly(e.target.checked)}
            />
            Show Watchlist Only
        </label>
    );
}
