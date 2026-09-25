/**
 * The status buttons, plus the one question the app asks before them.
 *
 * Marking a screening going or interested for the first time can leave friends
 * who are already attending unable to see it — your visibility mode, or a
 * per-friend opt-out, hides it from them. The app asks "Let these friends
 * know?" at that moment rather than letting them silently miss it, and so does
 * this (`InviteBeforePrivateDialog`, with the app's wording). Switching between
 * going and interested changes nothing about who sees you, so only the step
 * from no status asks.
 *
 * The list is fetched as the panel opens, so a press that needs to ask asks
 * at once instead of after a round trip. After "Invite & continue" the button
 * paints straight away, but the status write waits for the invites: each of
 * them and the status write rebuild this showtime's visibility rows, and two of
 * those at once deadlock Postgres.
 *
 * Marking a screening going for the first time also looks, in the background,
 * for other screenings of the same film you'd marked interested, and offers to
 * clear them (`RemoveInterestedElsewhereDialog`, as the app does). Not when
 * another screening of it is already going: going twice is deliberate. The
 * Settings page can switch this question off.
 *
 * Rendered inside the panel's per-screening keyed body, so an answer given
 * here always lands on the screening it was asked about.
 */
import { Box, Text } from "@chakra-ui/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import type {
  GoingStatus,
  ShowtimeInMoviePublic,
  ShowtimePublic,
  UserPublic,
} from "shared"
import { MoviesService, ShowtimesService } from "shared/client"

import { PanelPressable } from "@/components/Showtimes/detail/PanelChrome"

import { useIsSignedIn, useRequireAccount } from "@/auth/useSession"
import InviteBeforePrivateDialog from "@/components/Showtimes/detail/InviteBeforePrivateDialog"
import { personName } from "@/components/Showtimes/detail/PersonAvatar"
import RemoveInterestedElsewhereDialog from "@/components/Showtimes/detail/RemoveInterestedElsewhereDialog"
import ShowtimeStatusControl from "@/components/Showtimes/detail/ShowtimeStatusControl"
import {
  hiddenAttendingFriendsQueryKey,
  useShowtimeInvites,
} from "@/features/showtimes/useShowtimeInvites"
import { isRemoveInterestedReminderEnabled } from "@/features/showtimes/interested-elsewhere-reminder"
import {
  putShowtimeInFeeds,
  refetchStatusScopedFeeds,
} from "@/features/showtimes/showtime-cache"
import { useShowtimeSelection } from "@/features/showtimes/useShowtimeSelection"

/** Stable, so the dialog's props don't change identity on every render. */
const NO_FRIENDS: readonly UserPublic[] = []
const NO_SHOWTIMES: readonly ShowtimeInMoviePublic[] = []

/** Enough to cover every screening of one film a viewer could have marked. */
const OTHER_SHOWTIMES_LIMIT = 50

const isAttending = (status: GoingStatus) =>
  status === "GOING" || status === "INTERESTED"

type ShowtimeStatusSectionProps = {
  showtime: ShowtimePublic
}

const ShowtimeStatusSection = ({ showtime }: ShowtimeStatusSectionProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const showtimeId = showtime.id
  const isSignedIn = useIsSignedIn()
  const requireAccount = useRequireAccount()
  const queryClient = useQueryClient()
  const { status, setStatus } = useShowtimeSelection(showtime)
  const { sendInvitesAndWait } = useShowtimeInvites(showtimeId)

  const hiddenQuery = {
    queryKey: hiddenAttendingFriendsQueryKey(showtimeId),
    queryFn: () =>
      ShowtimesService.getHiddenAttendingFriendsForShowtime({ showtimeId }),
    staleTime: 30_000,
  }
  // Only worth fetching while there is a first status still to set.
  useQuery({ ...hiddenQuery, enabled: isSignedIn && !isAttending(status) })

  // The status the dialog is asking about, and who about. Outlives the open
  // flag, so the dialog's words and list hold still on its way out.
  const [question, setQuestion] = useState<{
    status: GoingStatus
    friends: readonly UserPublic[]
  }>({ status: "GOING", friends: NO_FRIENDS })
  const [isAsking, setIsAsking] = useState(false)
  // Set on the first answer, so a second one (a double click, or the dialog's
  // own close event after a button already answered) can't set the status
  // twice or race the invites it is waiting on.
  const hasAnsweredRef = useRef(true)

  // Other screenings of this film still marked interested. Outlives the open
  // flag, like `question`, so the list holds still on the way out.
  const [staleInterested, setStaleInterested] =
    useState<readonly ShowtimeInMoviePublic[]>(NO_SHOWTIMES)
  const [isOfferingClear, setIsOfferingClear] = useState(false)
  const hasAnsweredClearRef = useRef(true)

  // Unawaited: the going press never waits on this; the dialog, if any,
  // arrives after the status has already changed.
  const checkInterestedElsewhere = async () => {
    if (!isRemoveInterestedReminderEnabled()) return
    try {
      const movieId = showtime.movie.id
      const others = (
        await queryClient.fetchQuery({
          queryKey: ["movies", movieId, "showtimes", "attendingStatuses"],
          queryFn: () =>
            MoviesService.readMovieShowtimes({
              id: movieId,
              selectedStatuses: ["GOING", "INTERESTED"],
              // The viewer's own marks at any cinema, not just the ones the
              // feed is showing.
              allCinemas: true,
              limit: OTHER_SHOWTIMES_LIMIT,
            }),
          staleTime: 0,
        })
      ).filter((other) => other.id !== showtimeId)
      if (others.some((other) => other.viewer?.going === "GOING")) return
      const interested = others.filter(
        (other) => other.viewer?.going === "INTERESTED",
      )
      if (interested.length === 0) return
      hasAnsweredClearRef.current = false
      setStaleInterested(interested)
      setIsOfferingClear(true)
    } catch {
      // Best-effort: nothing to fall back to.
    }
  }

  const answerClear = async (selectedIds: readonly number[]) => {
    if (hasAnsweredClearRef.current) return
    hasAnsweredClearRef.current = true
    setIsOfferingClear(false)
    // One at a time: concurrent status writes can deadlock on visibility rows.
    for (const id of selectedIds) {
      try {
        const updated = await ShowtimesService.updateShowtimeSelection({
          showtimeId: id,
          requestBody: { going_status: "NOT_GOING" },
        })
        putShowtimeInFeeds(queryClient, updated)
      } catch {
        // Best-effort, like the invites.
      }
    }
    if (selectedIds.length > 0) {
      refetchStatusScopedFeeds(queryClient)
      queryClient.invalidateQueries({ queryKey: ["movie"] })
      queryClient.invalidateQueries({ queryKey: ["movies"] })
    }
  }

  const handleChange = async (pressed: GoingStatus) => {
    if (!requireAccount()) return
    // What the press will set: pressing the status you hold clears it.
    const next = pressed === status ? "NOT_GOING" : pressed

    if (next === "GOING") void checkInterestedElsewhere()

    if (isAttending(next) && !isAttending(status)) {
      try {
        const { friends } = await queryClient.fetchQuery(hiddenQuery)
        if (friends.length > 0) {
          hasAnsweredRef.current = false
          setQuestion({ status: next, friends })
          setIsAsking(true)
          return
        }
      } catch {
        // A failed lookup shouldn't block the status it was only advising on.
      }
    }

    setStatus(pressed)
  }

  const answer = (toInvite: readonly UserPublic[]) => {
    if (hasAnsweredRef.current) return
    hasAnsweredRef.current = true
    setIsAsking(false)
    const invites =
      toInvite.length > 0
        ? sendInvitesAndWait(
            toInvite.map((friend) => ({
              friendId: friend.id,
              name: personName(friend),
            })),
          )
        : undefined
    setStatus(question.status, invites)
  }

  // Render/output using the state and derived values prepared above.
  return (
    <Box px={3} pb={3}>
      <ShowtimeStatusControl
        status={status}
        onChange={handleChange}
        hasOpenInvite={Boolean(showtime.viewer?.invited_by?.length)}
        locked={!isSignedIn}
      />
      {isSignedIn ? null : (
        <PanelPressable
          type="button"
          onClick={() => requireAccount()}
          display="block"
          w="100%"
          mt="6px"
          cursor="pointer"
          color="fg.muted"
          _hover={{ color: "fg" }}
        >
          <Text fontSize="12px" fontWeight="600" textAlign="center">
            Log in to set your status
          </Text>
        </PanelPressable>
      )}

      <InviteBeforePrivateDialog
        open={isAsking}
        friends={question.friends}
        onConfirm={answer}
        onSkip={() => answer(NO_FRIENDS)}
        title="Let these friends know?"
        message={`These friends are already going or interested, but won't be able to see that you're ${
          question.status === "GOING" ? "going" : "interested"
        } unless you invite them.`}
      />

      <RemoveInterestedElsewhereDialog
        open={isOfferingClear}
        showtimes={staleInterested}
        onConfirm={(ids) => void answerClear(ids)}
        onSkip={() => void answerClear([])}
      />
    </Box>
  )
}

export default ShowtimeStatusSection
