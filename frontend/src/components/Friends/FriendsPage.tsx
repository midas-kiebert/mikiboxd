/**
 * Friends: the app's Friends tab, on the web (`mobile/app/(tabs)/friends.tsx`).
 *
 * Two modes, not a wall of lists. The page used to be two columns — every
 * user on the site on the left, requests and friends stacked on the right —
 * which put the thing almost every visit is for (your friends) beside a list
 * of strangers, and a request waiting on you under a heading you had to spot.
 * As in the app:
 *
 *   - **Friends** is one list: requests waiting on you first, set apart in
 *     the "needs you" colour, then the ones you sent, then your friends —
 *     always there, even empty, since it is the section the page is for.
 *   - **Find people** is a search of everyone else, run only once something
 *     is typed.
 *
 * The search box narrows whatever is on screen: your own lists locally, on
 * every keystroke, and everyone else on the server once typing settles. A
 * name that matches none of your friends offers the search you probably
 * meant. Switching modes clears the box, since a query means something
 * different on each side.
 *
 * Your invite link sits in a side column beside the list (under it on a
 * narrower window), where the app puts its QR card at the foot of both pages: adding
 * people is the natural next thing after looking at who you already have.
 */
import { Box, Center, Flex, Input, InputGroup, Spinner } from "@chakra-ui/react"
import { useNavigate } from "@tanstack/react-router"
import { useMemo, useRef, useState } from "react"
import { FaSearch } from "react-icons/fa"
import { MdPersonSearch } from "react-icons/md"
import type { UserWithFriendStatus } from "shared"
import { useFetchFriends } from "shared/hooks/useFetchFriends"
import { useFetchReceivedRequests } from "shared/hooks/useFetchReceivedRequests"
import { useFetchSentRequests } from "shared/hooks/useFetchSentRequests"
import { useFetchUsers } from "shared/hooks/useFetchUsers"
import { useDebounce } from "use-debounce"

import FriendRow from "@/components/Friends/FriendRow"
import InviteCard from "@/components/Friends/InviteCard"
import useInfiniteScroll from "@/hooks/useInfiniteScroll"
import { Route } from "@/routes/_layout/friends"

import {
  DEFAULT_FRIENDS_MODE,
  FRIENDS_MODES,
  type FriendsMode,
} from "./friends-modes"

import "./friends.css"

const LIST_MAX_WIDTH = 760
const COLUMN_GAP = 32
const SIDE_WIDTH = 320
const CONTENT_MAX_WIDTH = LIST_MAX_WIDTH + COLUMN_GAP + SIDE_WIDTH

/** Matches the app's search screens. */
const SEARCH_DEBOUNCE_MS = 280
const SEARCH_PAGE_SIZE = 20

type FriendsSection = {
  key: "received" | "sent" | "friends"
  title: string
  /** Sets a section apart when it needs answering rather than just reading. */
  isCallToAction?: boolean
  users: UserWithFriendStatus[]
}

const FriendsPage = () => {
  // Read flow: route state and data hooks first, then derived lists, then JSX.
  const navigate = useNavigate()
  const search = Route.useSearch() as { mode?: FriendsMode }
  const mode = search.mode ?? DEFAULT_FRIENDS_MODE
  const current =
    FRIENDS_MODES.find((option) => option.value === mode) ?? FRIENDS_MODES[0]
  const isDiscovering = mode === "discover"

  const [query, setQuery] = useState("")
  const trimmedQuery = query.trim()
  const [debouncedQuery] = useDebounce(trimmedQuery, SEARCH_DEBOUNCE_MS)

  const setMode = (next: FriendsMode, { keepQuery = false } = {}) => {
    if (!keepQuery) setQuery("")
    void navigate({
      to: "/friends",
      search: next === DEFAULT_FRIENDS_MODE ? {} : { mode: next },
      replace: true,
    } as never)
  }

  // Render/output using the state and derived values prepared above.
  return (
    <Box
      px={{ base: 3, md: 8, xl: 12, "2xl": 16 }}
      pt={{ base: 4, md: 8 }}
      pb={16}
    >
      <Flex
        maxW={`${CONTENT_MAX_WIDTH}px`}
        mx="auto"
        align="flex-start"
        justify="center"
        gap={`${COLUMN_GAP}px`}
      >
        <Box flex="1 1 auto" minW={0} maxW={`${LIST_MAX_WIDTH}px`}>
          <header className="fr-head">
            <div className="fr-head__titles">
              <h1 className="fr-head__title">Friends</h1>
              <p className="fr-head__description">{current.description}</p>
            </div>
            <div
              className="fr-modes"
              role="tablist"
              aria-label="Friends or find people"
            >
              {FRIENDS_MODES.map((option) => {
                const Icon = option.icon
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={option.value === mode}
                    className="fr-modes__option"
                    onClick={() => setMode(option.value)}
                  >
                    <Icon className="fr-modes__icon" aria-hidden />
                    <span className="fr-modes__label">{option.label}</span>
                  </button>
                )
              })}
            </div>
          </header>

          <InputGroup
            mb={5}
            startElement={<FaSearch />}
            startElementProps={{ color: "fg.muted" }}
          >
            <Input
              // Remounted per mode, so the box never carries focus or a
              // stale value across the switch.
              key={mode}
              type="search"
              placeholder={current.placeholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              bg="bg.panel"
              borderRadius="12px"
              size="lg"
              autoFocus={isDiscovering}
            />
          </InputGroup>

          {isDiscovering ? (
            <DiscoverList
              query={debouncedQuery}
              isTyping={trimmedQuery !== debouncedQuery}
            />
          ) : (
            <FriendsList
              query={trimmedQuery}
              onSearchEveryone={() => setMode("discover", { keepQuery: true })}
              onFindPeople={() => setMode("discover")}
            />
          )}

          {/* Under the list until there is room for both side by side:
              beside it, the column would squeeze the rows into two lines. */}
          <Box mt={8} hideFrom="lg">
            <InviteCard />
          </Box>
        </Box>

        <Box
          as="aside"
          hideBelow="lg"
          w={`${SIDE_WIDTH}px`}
          flexShrink={0}
          position="sticky"
          top="20px"
        >
          <InviteCard />
        </Box>
      </Flex>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Friends: requests, sent requests and friends, in one list.
// ---------------------------------------------------------------------------

const FriendsList = ({
  query,
  onSearchEveryone,
  onFindPeople,
}: {
  query: string
  onSearchEveryone: () => void
  onFindPeople: () => void
}) => {
  const { data: friends, isLoading: isLoadingFriends } = useFetchFriends()
  const { data: received, isLoading: isLoadingReceived } =
    useFetchReceivedRequests()
  const { data: sent } = useFetchSentRequests()

  const sections = useMemo((): FriendsSection[] => {
    const needle = query.toLowerCase()
    const matches = (user: UserWithFriendStatus) =>
      !needle || (user.display_name ?? "").toLowerCase().includes(needle)
    const built: FriendsSection[] = []
    const shownReceived = (received ?? []).filter(matches)
    const shownSent = (sent ?? []).filter(matches)
    if (shownReceived.length > 0) {
      built.push({
        key: "received",
        title: "Wants to be friends",
        isCallToAction: true,
        users: shownReceived,
      })
    }
    if (shownSent.length > 0) {
      built.push({ key: "sent", title: "Requests you sent", users: shownSent })
    }
    built.push({
      key: "friends",
      title: "Your friends",
      users: (friends ?? []).filter(matches),
    })
    return built
  }, [friends, received, sent, query])

  if (isLoadingFriends || isLoadingReceived) {
    return (
      <Center py={24}>
        <Spinner size="lg" color="app.tint" />
      </Center>
    )
  }

  const hasQuery = query.length > 0
  const hasNoMatches =
    hasQuery && sections.every((section) => section.users.length === 0)

  return (
    <div className="fr-sections">
      {sections.map((section) => (
        <section
          key={section.key}
          className="fr-section"
          aria-label={section.title}
        >
          <h2
            className={`fr-section__head${
              section.isCallToAction ? " fr-section__head--call" : ""
            }`}
          >
            <span className="fr-section__title">{section.title}</span>
            <span className="fr-section__count">{section.users.length}</span>
          </h2>
          {section.users.length > 0 ? (
            <div className="fr-rows">
              {section.users.map((user) => (
                <FriendRow key={user.id} user={user} />
              ))}
            </div>
          ) : (
            <div className="fr-empty">
              <p className="fr-empty__title">
                {hasQuery ? "No matches" : "No friends yet"}
              </p>
              <p className="fr-empty__body">
                {!hasQuery
                  ? "Find people by username, or send them your invite link."
                  : hasNoMatches
                    ? "This box only searches people you are already friends with."
                    : "Nobody in your friends matches that name."}
              </p>
              {!hasQuery || hasNoMatches ? (
                <button
                  type="button"
                  className="fr-empty__action"
                  onClick={hasQuery ? onSearchEveryone : onFindPeople}
                >
                  <MdPersonSearch aria-hidden />
                  <span className="fr-empty__action-label">
                    {hasQuery ? "Find people instead" : "Find people"}
                  </span>
                </button>
              ) : null}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Find people: everyone else, by username.
// ---------------------------------------------------------------------------

const DiscoverList = ({
  query,
  isTyping,
}: { query: string; isTyping: boolean }) => {
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const hasQuery = query.length > 0
  const filters = useMemo(() => ({ query }), [query])
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useFetchUsers({
      limit: SEARCH_PAGE_SIZE,
      filters,
      // The one list here that costs a request per query, and with nothing
      // typed it would just be everyone on the site.
      enabled: hasQuery,
      // The last results stay up while the next query is out, rather than the
      // list collapsing to a spinner on every pause in typing.
      keepPreviousResults: true,
    })
  const users = hasQuery ? (data?.pages.flat() ?? []) : []

  useInfiniteScroll({
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    loadMoreRef,
    rootMargin: "200px",
  })

  if (!hasQuery) {
    return (
      <div className="fr-empty">
        <p className="fr-empty__title">Search by username</p>
        <p className="fr-empty__body">
          Type a name to find someone, or send them your invite link instead.
        </p>
      </div>
    )
  }

  if (isLoading && users.length === 0) {
    return (
      <Center py={24}>
        <Spinner size="lg" color="app.tint" />
      </Center>
    )
  }

  if (users.length === 0 && !isTyping) {
    return (
      <div className="fr-empty">
        <p className="fr-empty__title">No one found</p>
        <p className="fr-empty__body">
          Try a different name, or send them your invite link.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="fr-rows">
        {users.map((user) => (
          <FriendRow key={user.id} user={user} showStatus />
        ))}
      </div>
      <div ref={loadMoreRef} aria-hidden />
      {isFetchingNextPage ? (
        <Center py={6}>
          <Spinner size="md" color="app.tint" />
        </Center>
      ) : null}
    </>
  )
}

export default FriendsPage
