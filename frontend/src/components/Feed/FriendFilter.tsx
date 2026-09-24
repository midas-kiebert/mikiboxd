/**
 * "Only these friends", under the rail's More filters: the feed narrowed to
 * what a few chosen friends are going to or interested in.
 *
 * One friend picked is that friend's agenda — what used to be a page of its
 * own, now a filter (`FeedParams.friends`, with the header from
 * `FeedSubjectHeader`). Several is "what are these people up to", which no
 * page could do.
 *
 * Picked friends stand as removable rows with their picture; below them a
 * search box finds more. Nothing is listed until something is typed, because
 * a friends list runs to dozens and the rail is a narrow column.
 */
import { Box, Flex, Text, chakra } from "@chakra-ui/react"
import { type ChangeEvent, useMemo, useState } from "react"
import { FiX } from "react-icons/fi"
import { useFetchFriends } from "shared/hooks/useFetchFriends"

import {
  RAIL_INK,
  RAIL_INK_MUTED,
  RailFacetHeading,
  RailNote,
  RailTextButton,
} from "@/components/Feed/FilterRailControls"
import {
  PersonAvatar,
  personName,
} from "@/components/Showtimes/detail/PersonAvatar"

const Row = chakra("button")
const SearchInput = chakra("input")

/** Search results shown at once; the rail is too narrow for a long list. */
const MAX_RESULTS = 6

type FriendFilterProps = {
  selected: readonly string[]
  onChange: (friendIds: string[]) => void
}

export const FriendFilter = ({ selected, onChange }: FriendFilterProps) => {
  const { data: friends = [] } = useFetchFriends()
  const [query, setQuery] = useState("")

  const picked = useMemo(
    () =>
      selected
        .map((id) => friends.find((friend) => friend.id === id))
        .filter((friend) => friend !== undefined),
    [selected, friends],
  )

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    return friends
      .filter((friend) => !selected.includes(friend.id))
      .filter((friend) => personName(friend).toLowerCase().includes(needle))
      .slice(0, MAX_RESULTS)
  }, [friends, query, selected])

  if (friends.length === 0) return null

  return (
    <Box>
      <RailFacetHeading
        action={
          selected.length ? (
            <RailTextButton onClick={() => onChange([])}>Clear</RailTextButton>
          ) : undefined
        }
      >
        Only these friends
      </RailFacetHeading>

      {picked.map((friend) => (
        <Flex key={friend.id} align="center" gap="8px" px="4px" py="3px">
          <PersonAvatar user={friend} size={22} />
          <Text
            flex="1"
            minW={0}
            fontSize="13px"
            fontWeight="600"
            color={RAIL_INK}
            truncate
          >
            {personName(friend)}
          </Text>
          <Row
            type="button"
            aria-label={`Remove ${personName(friend)}`}
            display="flex"
            p="3px"
            borderRadius="4px"
            color={RAIL_INK_MUTED}
            cursor="pointer"
            _hover={{ bg: "bg.muted", color: RAIL_INK }}
            onClick={() => onChange(selected.filter((id) => id !== friend.id))}
          >
            <FiX />
          </Row>
        </Flex>
      ))}

      <SearchInput
        type="search"
        value={query}
        placeholder={selected.length ? "Add another friend…" : "Find a friend…"}
        aria-label="Find a friend to filter by"
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          setQuery(event.target.value)
        }
        w="100%"
        mt={picked.length ? "6px" : 0}
        px="8px"
        py="5px"
        borderRadius="6px"
        borderWidth="1px"
        borderColor="border"
        bg="bg.panel"
        color={RAIL_INK}
        fontSize="13px"
        _focusVisible={{
          outline: "2px solid",
          outlineColor: "app.tint",
          outlineOffset: "1px",
        }}
      />

      {results.map((friend) => (
        <Row
          key={friend.id}
          type="button"
          display="flex"
          alignItems="center"
          gap="8px"
          w="100%"
          mt="2px"
          px="4px"
          py="4px"
          borderRadius="6px"
          bg="transparent"
          color={RAIL_INK}
          textAlign="left"
          cursor="pointer"
          _hover={{ bg: "bg.muted" }}
          onClick={() => {
            onChange([...selected, friend.id])
            setQuery("")
          }}
        >
          <PersonAvatar user={friend} size={22} />
          <Text as="span" flex="1" minW={0} fontSize="13px" truncate>
            {personName(friend)}
          </Text>
        </Row>
      ))}
      {query.trim() && results.length === 0 ? (
        <Box mt="6px">
          <RailNote>No friend by that name.</RailNote>
        </Box>
      ) : null}
    </Box>
  )
}
