/**
 * Who can see that you picked this screening.
 *
 * Drawn as the app draws it: a header row reading "Status visible to" with the
 * mode as a coloured pill on the right, and the three options folded away
 * behind it. Collapsed by default because the mode is usually something you
 * *check*, not something you change — the pill answers it without opening
 * anything, and the panel stays short enough that the invites below it are
 * still on screen.
 *
 * Only meaningful once you have picked the screening — a mode on a showtime you
 * are not going to governs nothing — so the panel renders this only when there
 * is a status to hide or show.
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
import { Box, Flex, Text } from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link as RouterLink } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import type { ShowtimePublic, VisibilityMode } from "shared"
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
import {
  PANEL_ROW_LABEL_SIZE,
  PANEL_ROW_VALUE_SIZE,
  PanelPressable,
} from "@/components/Showtimes/detail/PanelChrome"
import { PanelIcon } from "@/components/Showtimes/detail/panel-icons"
import useCustomToast from "@/hooks/useCustomToast"

/** The glyphs `shared/showtimes/visibility-mode` names, resolved for the web. */
const MODE_ICON = {
  hub: PanelIcon.hub,
  groups: PanelIcon.groups,
  mail: PanelIcon.mail,
} as const

type ShowtimeVisibilityPanelProps = {
  showtime: ShowtimePublic
}

const ShowtimeVisibilityPanel = ({ showtime }: ShowtimeVisibilityPanelProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const showtimeId = showtime.id
  const isSignedIn = useIsSignedIn()
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()

  const [isExpanded, setIsExpanded] = useState(false)

  // An open dropdown belongs to the screening it was opened on.
  useEffect(() => {
    setIsExpanded(false)
  }, [showtimeId])

  const { data: visibility } = useShowtimeVisibility({
    showtimeId,
    enabled: isSignedIn,
  })

  /**
   * Friends who are going to this screening but were never invited to it.
   *
   * They are exactly who "invited only" would hide you from, and the app warns
   * before that happens rather than after — the whole point of narrowing
   * visibility is usually not to disappear from the people you are going with.
   */
  const { data: uninvited } = useQuery({
    queryKey: ["showtimes", "uninvitedSelectedFriends", showtimeId],
    queryFn: () =>
      ShowtimesService.getUninvitedSelectedFriendsForShowtime({ showtimeId }),
    enabled: isSignedIn,
    staleTime: 30_000,
  })

  const { mutate: setMode } = useMutation({
    mutationFn: (mode: VisibilityMode) =>
      ShowtimesService.updateShowtimeVisibility({
        showtimeId,
        requestBody: { mode },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(showtimeVisibilityQueryKey(showtimeId), updated)
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
  const uninvitedCount = uninvited?.friends?.length ?? 0

  const handleChange = (mode: VisibilityMode) => {
    if (mode === current) return
    queryClient.setQueryData(showtimeVisibilityQueryKey(showtimeId), {
      showtime_id: showtimeId,
      movie_id: showtime.movie.id,
      mode,
    })
    setMode(mode)
  }

  // Render/output using the state and derived values prepared above.
  return (
    <Box px={3} py={2} borderTopWidth="1px" borderColor="border.muted">
      <PanelPressable
        type="button"
        onClick={() => setIsExpanded((open) => !open)}
        aria-expanded={isExpanded}
        display="flex"
        alignItems="center"
        gap="8px"
        w="100%"
        py="4px"
        bg="transparent"
        cursor="pointer"
        textAlign="left"
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
          <Box as={MODE_ICON[currentPresentation.icon]} boxSize="15px" aria-hidden />
          {currentCopy.label}
        </Flex>

        <Box
          as={PanelIcon.expandMore}
          boxSize="20px"
          flexShrink={0}
          color="fg.subtle"
          transition="transform 160ms ease"
          transform={isExpanded ? "rotate(180deg)" : "rotate(0deg)"}
          aria-hidden
        />
      </PanelPressable>

      {isExpanded ? (
        <Box pt="6px">
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
                  borderColor={isOn ? `app.${presentation.palette}.secondary` : "border"}
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
                    <Box as={MODE_ICON[presentation.icon]} boxSize="15px" aria-hidden />
                  </Flex>

                  <Box flex="1" minW={0}>
                    <Text fontSize="12px" fontWeight={isOn ? "700" : "600"} lineHeight="1.3">
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
                    color={isOn ? `app.${presentation.palette}.secondary` : "fg.subtle"}
                    aria-hidden
                  />
                </PanelPressable>
              )
            })}
          </Flex>

          <RouterLink to="/settings">
            <Flex align="center" gap="5px" pt="8px" color="fg.muted">
              <Box as={PanelIcon.tune} boxSize="14px" aria-hidden />
              <Text fontSize="11px" fontWeight="600">
                Change your default
              </Text>
            </Flex>
          </RouterLink>

          {current !== "INVITED_ONLY" && uninvitedCount > 0 ? (
            <Text fontSize="11px" color="app.orange.secondary" lineHeight="1.5" pt="6px">
              {uninvitedCount === 1
                ? "One friend going to this is not in the invite"
                : `${uninvitedCount} friends going to this are not in the invite`}
              , so “Invited only” would hide you from them. Invite them first.
            </Text>
          ) : null}

          <Text fontSize="11px" color="fg.subtle" lineHeight="1.5" pt="6px">
            Friends you invited, and friends who invited you, can always see this.
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

export default ShowtimeVisibilityPanel
