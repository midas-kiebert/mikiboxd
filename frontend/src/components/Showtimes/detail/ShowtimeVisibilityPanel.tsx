/**
 * Who can see that you picked this screening.
 *
 * Drawn as the app draws it: a row reading "Status visible to" with the mode as
 * a coloured pill on the right. The mode is usually something you *check*, not
 * something you change, so the pill answers it without opening anything; the
 * three options open in a popup over the panel rather than unfolding into it,
 * so changing the mode never makes the panel longer or shoves the seat card
 * down out from under the pointer.
 *
 * Sits directly under the status buttons, above the seats, because it is a
 * setting *on* the status those buttons set. Shown whatever the status —
 * including none — because the whole use of it is to narrow who sees you
 * *before* you mark going or interested; a control that only appeared after
 * would announce the status to everyone first. The backend stores a mode set
 * ahead of a status and applies it once one is picked.
 *
 * The labels, descriptions, icon and palette all come from
 * `shared/showtimes/visibility-mode`, which the app reads too: a privacy setting
 * described one way on a phone and another way on the web is how people share
 * more than they meant to.
 *
 * It paints from the showtime payload the feed already carried
 * (`viewer.visibility_mode`) and revalidates behind that, so switching between
 * screenings never shows an empty control that fills in a moment later.
 */
import { Box, Flex, Popover, Portal, Text } from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link as RouterLink } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import type { ShowtimePublic, UserPublic, VisibilityMode } from "shared"
import { ShowtimesService } from "shared/client"
import {
  showtimeVisibilityQueryKey,
  useShowtimeVisibility,
} from "shared/hooks/useShowtimeVisibility"
import {
  VISIBILITY_MODE_ORDER,
  getVisibilityModeCopy,
  getVisibilityModePresentation,
} from "shared/showtimes/visibility-mode"

import { useIsSignedIn } from "@/auth/useSession"
import InviteBeforePrivateDialog from "@/components/Showtimes/detail/InviteBeforePrivateDialog"
import {
  PANEL_ROW_LABEL_SIZE,
  PANEL_ROW_VALUE_SIZE,
  PanelPressable,
} from "@/components/Showtimes/detail/PanelChrome"
import { personName } from "@/components/Showtimes/detail/PersonAvatar"
import { PanelIcon } from "@/components/Showtimes/detail/panel-icons"
import {
  hiddenAttendingFriendsQueryKey,
  uninvitedSelectedFriendsQueryKey,
  useShowtimeInvites,
} from "@/features/showtimes/useShowtimeInvites"
import useCustomToast from "@/hooks/useCustomToast"

/** The glyphs `shared/showtimes/visibility-mode` names, resolved for the web. */
const MODE_ICON = {
  hub: PanelIcon.hub,
  groups: PanelIcon.groups,
  mail: PanelIcon.mail,
} as const

/** Stable, so the dialog's props don't change identity on every render. */
const NO_FRIENDS: readonly UserPublic[] = []

type ShowtimeVisibilityPanelProps = {
  showtime: ShowtimePublic
}

const ShowtimeVisibilityPanel = ({
  showtime,
}: ShowtimeVisibilityPanelProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const showtimeId = showtime.id
  const isSignedIn = useIsSignedIn()
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()

  const [isOpen, setIsOpen] = useState(false)
  const { sendInvitesAndWait } = useShowtimeInvites(showtimeId)

  // Friends who would lose sight of you on a switch to "Invited only", while
  // the dialog asking about them is up. The list outlives the open flag so the
  // dialog has something to draw on its way out.
  const [keepInLoop, setKeepInLoop] =
    useState<readonly UserPublic[]>(NO_FRIENDS)
  const [isAskingToInvite, setIsAskingToInvite] = useState(false)
  // Set on the first answer, so a second one (a double click, or the dialog's
  // own close event after a button already answered) can't apply the switch
  // twice or race the invites it is waiting on.
  const hasAnsweredRef = useRef(true)

  // An open popup belongs to the screening it was opened on.
  useEffect(() => {
    setIsOpen(false)
  }, [showtimeId])

  const { data: visibility } = useShowtimeVisibility({
    showtimeId,
    enabled: isSignedIn,
  })

  /**
   * Friends who are going to this screening but were never invited to it.
   *
   * They are exactly who "invited only" would hide you from, and the app asks
   * before that happens rather than after — the whole point of narrowing
   * visibility is usually not to disappear from the people you are going with.
   * Fetched ahead, so picking "Invited only" can ask at once.
   */
  const uninvitedQuery = {
    queryKey: uninvitedSelectedFriendsQueryKey(showtimeId),
    queryFn: () =>
      ShowtimesService.getUninvitedSelectedFriendsForShowtime({ showtimeId }),
    staleTime: 30_000,
  }
  useQuery({ ...uninvitedQuery, enabled: isSignedIn })

  const { mutate: setMode } = useMutation({
    mutationFn: (mode: VisibilityMode) =>
      ShowtimesService.updateShowtimeVisibility({
        showtimeId,
        requestBody: { mode },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(showtimeVisibilityQueryKey(showtimeId), updated)
      // The mode is what decides which attending friends can't see you.
      queryClient.invalidateQueries({
        queryKey: hiddenAttendingFriendsQueryKey(showtimeId),
      })
    },
    onError: () => {
      queryClient.invalidateQueries({
        queryKey: showtimeVisibilityQueryKey(showtimeId),
      })
      showErrorToast("Could not change who can see this.")
    },
  })

  if (!isSignedIn) return null

  // The payload the feed already carried gets the control on screen at once;
  // the query is the authority once it lands.
  const current = visibility?.mode ?? showtime.viewer?.visibility_mode
  if (!current) return null

  const currentCopy = getVisibilityModeCopy(current)
  const currentPresentation = getVisibilityModePresentation(current)

  /** The pill shows the new mode at once; the write follows. */
  const paintMode = (mode: VisibilityMode) =>
    queryClient.setQueryData(showtimeVisibilityQueryKey(showtimeId), {
      showtime_id: showtimeId,
      movie_id: showtime.movie.id,
      mode,
    })

  const handleChange = async (mode: VisibilityMode) => {
    setIsOpen(false)
    if (mode === current) return

    if (mode === "INVITED_ONLY") {
      try {
        const { friends } = await queryClient.fetchQuery(uninvitedQuery)
        if (friends.length > 0) {
          hasAnsweredRef.current = false
          setKeepInLoop(friends)
          setIsAskingToInvite(true)
          return
        }
      } catch {
        // A failed lookup shouldn't block the switch it was only advising on.
      }
    }

    paintMode(mode)
    setMode(mode)
  }

  const answerInviteQuestion = async (toInvite: readonly UserPublic[]) => {
    if (hasAnsweredRef.current) return
    hasAnsweredRef.current = true
    setIsAskingToInvite(false)
    paintMode("INVITED_ONLY")
    // Invites first and awaited, the switch only after: each rebuilds this
    // showtime's visibility rows, and two rebuilds at once deadlock Postgres.
    if (toInvite.length > 0) {
      await sendInvitesAndWait(
        toInvite.map((friend) => ({
          friendId: friend.id,
          name: personName(friend),
        })),
      )
    }
    setMode("INVITED_ONLY")
  }

  // Render/output using the state and derived values prepared above.
  return (
    <Box px={3} pb={3}>
      <Popover.Root
        open={isOpen}
        onOpenChange={(details) => setIsOpen(details.open)}
        lazyMount
        unmountOnExit
        // Fixed and portalled: floats over the panel instead of adding to its
        // scroll height, and as wide as the row it opened from.
        positioning={{
          placement: "bottom",
          gutter: 6,
          sameWidth: true,
          strategy: "fixed",
        }}
      >
        <Popover.Trigger asChild>
          <PanelPressable
            type="button"
            display="flex"
            alignItems="center"
            gap="8px"
            w="100%"
            px="10px"
            py="6px"
            borderWidth="1px"
            borderColor="border"
            borderRadius="10px"
            bg="transparent"
            cursor="pointer"
            textAlign="left"
            transition="background-color 120ms ease"
            _hover={{ bg: "bg.subtle" }}
            _focusVisible={{
              outline: "2px solid",
              outlineColor: "app.tint",
              outlineOffset: "1px",
            }}
          >
            <Text
              fontSize={PANEL_ROW_LABEL_SIZE}
              fontWeight="700"
              color="fg.muted"
              flex="1"
              minW={0}
            >
              Status visible to
            </Text>

            <Flex
              align="center"
              gap="4px"
              flexShrink={0}
              minH="26px"
              px="9px"
              borderRadius="full"
              bg={`app.${currentPresentation.palette}.primary`}
              color={`app.${currentPresentation.palette}.secondary`}
              fontSize={PANEL_ROW_VALUE_SIZE}
              fontWeight="700"
              lineHeight="1.3"
            >
              <Box
                as={MODE_ICON[currentPresentation.icon]}
                boxSize="15px"
                aria-hidden
              />
              <Box as="span" position="relative" top="1px">
                {currentCopy.label}
              </Box>
            </Flex>

            <Box
              as={PanelIcon.expandMore}
              boxSize="20px"
              flexShrink={0}
              color="fg.subtle"
              transition="transform 160ms ease"
              transform={isOpen ? "rotate(180deg)" : "rotate(0deg)"}
              aria-hidden
            />
          </PanelPressable>
        </Popover.Trigger>

        <Portal>
          <Popover.Positioner>
            <Popover.Content
              w="var(--reference-width)"
              maxW="calc(100vw - 16px)"
              p="6px"
              borderRadius="12px"
              borderWidth="1px"
              borderColor="border"
              bg="bg.panel"
              boxShadow="0 6px 20px rgb(0 0 0 / 0.14)"
            >
              <Flex
                direction="column"
                gap="4px"
                role="radiogroup"
                aria-label="Status visible to"
              >
                {VISIBILITY_MODE_ORDER.map((mode) => {
                  const copy = getVisibilityModeCopy(mode)
                  const presentation = getVisibilityModePresentation(mode)
                  const isOn = mode === current

                  return (
                    <PanelPressable
                      type="button"
                      key={mode}
                      role="radio"
                      aria-checked={isOn}
                      onClick={() => handleChange(mode)}
                      display="flex"
                      alignItems="center"
                      gap="8px"
                      w="100%"
                      px="8px"
                      py="7px"
                      borderRadius="10px"
                      borderWidth="1px"
                      borderColor={
                        isOn
                          ? `app.${presentation.palette}.secondary`
                          : "border"
                      }
                      bg={isOn ? "app.surfaceMuted" : "bg.panel"}
                      cursor="pointer"
                      textAlign="left"
                      transition="background-color 120ms ease, border-color 120ms ease"
                      _hover={isOn ? undefined : { bg: "bg.subtle" }}
                      _focusVisible={{
                        outline: "2px solid",
                        outlineColor: "app.tint",
                        outlineOffset: "1px",
                      }}
                    >
                      {/* A filled tile rather than a bare glyph, which is what makes
                          the three modes tell each other apart at a glance. */}
                      <Flex
                        as="span"
                        align="center"
                        justify="center"
                        flexShrink={0}
                        boxSize="24px"
                        borderRadius="7px"
                        bg={`app.${presentation.palette}.secondary`}
                        color="app.pillActiveText"
                      >
                        <Box
                          as={MODE_ICON[presentation.icon]}
                          boxSize="15px"
                          aria-hidden
                        />
                      </Flex>

                      <Box flex="1" minW={0}>
                        <Text
                          fontSize="12px"
                          fontWeight={isOn ? "700" : "600"}
                          lineHeight="1.3"
                        >
                          {copy.label}
                        </Text>
                        <Text fontSize="11px" color="fg.muted" lineHeight="1.4">
                          {copy.description}
                        </Text>
                      </Box>

                      <Box
                        as={
                          isOn
                            ? PanelIcon.radioButtonChecked
                            : PanelIcon.radioButtonUnchecked
                        }
                        boxSize="20px"
                        flexShrink={0}
                        color={
                          isOn
                            ? `app.${presentation.palette}.secondary`
                            : "fg.subtle"
                        }
                        aria-hidden
                      />
                    </PanelPressable>
                  )
                })}
              </Flex>

              {/* The page scrolls to its own section once it is built; the
                  router's hash scroll would move the whole layout instead. */}
              <RouterLink
                to="/settings"
                hash="privacy"
                hashScrollIntoView={false}
              >
                <Flex
                  align="center"
                  gap="5px"
                  px="4px"
                  pt="8px"
                  color="fg.muted"
                >
                  <Box as={PanelIcon.tune} boxSize="14px" aria-hidden />
                  <Text
                    fontSize="11px"
                    fontWeight="600"
                    position="relative"
                    top="1px"
                  >
                    Change your default
                  </Text>
                </Flex>
              </RouterLink>
            </Popover.Content>
          </Popover.Positioner>
        </Portal>
      </Popover.Root>

      <InviteBeforePrivateDialog
        open={isAskingToInvite}
        friends={keepInLoop}
        onConfirm={answerInviteQuestion}
        onSkip={() => answerInviteQuestion(NO_FRIENDS)}
      />
    </Box>
  )
}

export default ShowtimeVisibilityPanel
