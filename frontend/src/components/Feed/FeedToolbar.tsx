/**
 * The bar above the feed, for the cases where the navigation cannot carry the
 * search field.
 *
 * Normally it does — see `Common/TopNavBar` and `feed-search-slot` — and this
 * bar is not rendered at all, which gives the list back a full band of the
 * page. Two cases keep it:
 *
 *   - A phone, where the nav is a brand and an account chip and has no room
 *     for a field. The tabs are already gone to the bottom bar for the same
 *     reason.
 *   - The deep-link routes outside `_layout` — a cinema's programme, a shared
 *     screening — which carry none of the site's chrome and so have no nav to
 *     put it in.
 *
 * "Clear filters" comes with it only where the filter rail is not on screen to
 * hold it, which is the same phone case: a reset belongs beside the filters it
 * resets, and on a desktop that is the rail.
 *
 * Purely presentational — every value and setter comes from `useShowtimesFeed`,
 * so this file can be rearranged freely without touching state or queries.
 */
import { Box, Button, Flex, Grid } from "@chakra-ui/react"

import FeedSearchBar from "@/components/Feed/FeedSearchBar"
import type { FeedParams } from "@/features/showtimes/feed-params"
import type { SearchField } from "shared/client"

type FeedToolbarProps = {
  params: FeedParams
  onChange: (patch: Partial<FeedParams>) => void
  /** Overrides the search scope's own placeholder, for a page that searches one thing. */
  searchPlaceholder?: string
  /** Omitted when the filter rail is on screen and holds the reset instead. */
  onReset?: () => void
  activeFilterCount?: number
}

const FeedToolbar = ({
  params,
  onChange,
  searchPlaceholder,
  onReset,
  activeFilterCount = 0,
}: FeedToolbarProps) => {
  const canReset =
    Boolean(onReset) && (activeFilterCount > 0 || Boolean(params.q))

  // Three columns rather than a centred flex row, so the field is centred on the
  // *bar* and not on whatever happens to be beside it: a flex row would shove it
  // left the moment "Clear filters" appeared, which is exactly when the user is
  // typing into it. The reset sits in the right column and moves nothing.
  return (
    <Grid
      templateColumns={{ base: "1fr auto", md: "1fr minmax(260px, 720px) 1fr" }}
      alignItems="center"
      gap={3}
    >
      <Box display={{ base: "none", md: "block" }} />

      <FeedSearchBar
        query={params.q}
        onQueryChange={(q) => onChange({ q })}
        field={params.field}
        onFieldChange={(field: SearchField) => onChange({ field })}
        placeholder={searchPlaceholder}
      />

      {/* Only offered when there is something to undo — a permanently visible
          "clear" implies there is always something set. */}
      <Flex justify="flex-start" minW={0}>
        {canReset ? (
          <Button size="sm" variant="surface" flexShrink={0} onClick={onReset}>
            Clear filters
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Button>
        ) : null}
      </Flex>
    </Grid>
  )
}

export default FeedToolbar
