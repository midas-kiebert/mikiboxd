/**
 * What sits above the feed: search, the field it searches, the viewer's own
 * status filter, group-by-movie, and a way out of whatever is currently
 * narrowing the list.
 *
 * Purely presentational — every value and setter comes from `useShowtimesFeed`,
 * so this file can be rearranged freely without touching state or queries.
 * Controls for the remaining filter dimensions belong in the rail beside the
 * list rather than here; `feed-params.ts` already carries them.
 */
import {
  Button,
  Flex,
  HStack,
  Input,
  NativeSelect,
  Text,
} from "@chakra-ui/react"

import { Checkbox } from "@/components/ui/checkbox"
import type { FeedParams } from "@/features/showtimes/feed-params"
import type { SearchField } from "shared/client"
import type { SharedTabShowtimeFilter } from "shared/filters/shared-tab-filters"

const SEARCH_FIELD_OPTIONS: { value: SearchField; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "director", label: "Director" },
  { value: "actor", label: "Actor" },
  { value: "cinema", label: "Cinema" },
  { value: "friend", label: "Friend" },
]

const STATUS_OPTIONS: { value: SharedTabShowtimeFilter; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "interested", label: "Going + interested" },
  { value: "going", label: "Going" },
]

type FeedToolbarProps = {
  params: FeedParams
  onChange: (patch: Partial<FeedParams>) => void
  onReset: () => void
  activeFilterCount: number
  resultCount: number
  searchPlaceholder?: string
  /** What `resultCount` counts, for the line under the search box. */
  resultNoun?: string
  /**
   * Off on the films feed, which is already one row per film — the control
   * would be a no-op that implies otherwise.
   */
  showGroupToggle?: boolean
}

const FeedToolbar = ({
  params,
  onChange,
  onReset,
  activeFilterCount,
  resultCount,
  searchPlaceholder = "Search showtimes…",
  resultNoun = "showing",
  showGroupToggle = true,
}: FeedToolbarProps) => {
  return (
    <Flex direction="column" gap={2}>
      <Flex gap={2} align="center" wrap="wrap">
        <Input
          flex="1"
          minW="200px"
          value={params.q}
          placeholder={searchPlaceholder}
          onChange={(event) => onChange({ q: event.target.value })}
          aria-label={searchPlaceholder}
        />

        <NativeSelect.Root size="sm" width="130px">
          <NativeSelect.Field
            aria-label="Search by"
            value={params.field}
            onChange={(event) =>
              onChange({ field: event.target.value as SearchField })
            }
          >
            {SEARCH_FIELD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>

        <NativeSelect.Root size="sm" width="180px">
          <NativeSelect.Field
            aria-label="Show"
            value={params.status}
            onChange={(event) =>
              onChange({
                status: event.target.value as SharedTabShowtimeFilter,
              })
            }
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Flex>

      <HStack gap={4} wrap="wrap">
        {showGroupToggle ? (
          <Checkbox
            checked={params.group}
            onCheckedChange={(details) =>
              onChange({ group: !!details.checked })
            }
          >
            <Text fontSize="sm">One row per film</Text>
          </Checkbox>
        ) : null}

        <Text fontSize="sm" color="fg.muted">
          {resultCount} {resultNoun}
        </Text>

        {activeFilterCount > 0 || params.q ? (
          <Button size="xs" variant="surface" onClick={onReset}>
            Clear filters
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Button>
        ) : null}
      </HStack>
    </Flex>
  )
}

export default FeedToolbar
