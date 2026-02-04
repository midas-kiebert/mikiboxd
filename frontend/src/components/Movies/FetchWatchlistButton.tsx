import { Button } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MeService } from "shared";
import { FaSync } from "react-icons/fa";
import { useEffect } from "react";

const FetchWatchlistButton = () => {

    const queryClient = useQueryClient();

    const { mutate: fetchWatchlist, isPending } = useMutation({
        mutationFn: () => MeService.syncWatchlist(),
        onSuccess: () => {
            queryClient.invalidateQueries({queryKey: ['movies']});
        },
    });

    useEffect(() => (fetchWatchlist()), [])

    return (
        <Button
            loading={isPending}
            loadingText="Syncing watchlist..."
            onClick={() => fetchWatchlist()}
            minW={"180px"}
        >
            <FaSync style={{ marginRight: "8px" }}  />
            Sync Watchlist
        </Button>
    );
}

export default FetchWatchlistButton;
