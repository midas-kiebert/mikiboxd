/**
 * Movies list feature component: Fetch Watchlist Button.
 */
import { Button } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { FaSync } from "react-icons/fa"
import { MeService } from "shared"

const FetchWatchlistButton = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const queryClient = useQueryClient()

  // Data hooks keep this module synced with backend data and shared cache state.
  const { mutate: fetchWatchlist, isPending } = useMutation({
    mutationFn: () => MeService.syncWatchlist(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["movies"] })
    },
  })

  useEffect(() => fetchWatchlist(), [])

  // Render/output using the state and derived values prepared above.
  return (
    <Button
      loading={isPending}
      loadingText="Syncing watchlist..."
      onClick={() => fetchWatchlist()}
      minW={"180px"}
    >
      <FaSync style={{ marginRight: "8px" }} />
      Sync Watchlist
    </Button>
  )
}

export default FetchWatchlistButton
