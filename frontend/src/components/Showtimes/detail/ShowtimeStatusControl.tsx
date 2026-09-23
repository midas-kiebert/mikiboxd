/**
 * The three-way "are you going" control.
 *
 * One setting, not three toggles: pressing the option you already hold clears
 * it back to "not going", which is what the app's buttons do and what people
 * expect from a row of mutually exclusive choices.
 *
 * It paints before the request finishes. That is not a nicety here — marking
 * interest is also what sends the backend off to read the cinema's ticket
 * shop, so the round trip can run to seconds, and a button that sits inert for
 * that long reads as broken. `useShowtimeSelection` owns the optimistic write;
 * this file is the surface.
 *
 * The buttons stay visible for a signed-out visitor and gate on press, per the
 * app's guest rule: pressing "Going" is how someone discovers what an account
 * is for, and a screen that hides half of itself teaches nobody anything.
 *
 * Ordered not-going → interested → going, the app's order, because the two
 * clients showing the same three choices in opposite directions is how someone
 * presses the wrong one from muscle memory. The glyphs are the app's too — a
 * cross, a bookmark and a tick, from `panel-icons` — where the web had reached
 * for a slash and a star and made the same three choices unrecognisable
 * between the two.
 */
import { Box, Flex, Text } from "@chakra-ui/react"
import type { ElementType } from "react"
import type { GoingStatus } from "shared"

import { PanelPressable } from "@/components/Showtimes/detail/PanelChrome"
import { PanelIcon } from "@/components/Showtimes/detail/panel-icons"

const OPTIONS: {
  status: GoingStatus
  label: string
  icon: ElementType
  /** Fill and ink when this is the status in force. */
  bg: string
  fg: string
  border: string
}[] = [
  {
    status: "NOT_GOING",
    label: "Not going",
    icon: PanelIcon.cancel,
    bg: "app.gray.primary",
    fg: "app.gray.secondary",
    border: "app.gray.secondary",
  },
  {
    status: "INTERESTED",
    label: "Interested",
    icon: PanelIcon.bookmarkBorder,
    bg: "app.orange.primary",
    fg: "app.orange.secondary",
    border: "app.orange.secondary",
  },
  {
    status: "GOING",
    label: "Going",
    icon: PanelIcon.checkCircle,
    bg: "app.green.primary",
    fg: "app.green.secondary",
    border: "app.green.secondary",
  },
]

type ShowtimeStatusControlProps = {
  status: GoingStatus
  onChange: (status: GoingStatus) => void
  /**
   * True while somebody's invite is open and unanswered. "Not going" is then
   * an answer to *them* rather than a status you hold, so it is not drawn as
   * selected — the same call the app's sheet makes.
   */
  hasOpenInvite?: boolean
  /**
   * A guest's buttons: all three drawn off and greyed, none selected. They
   * still take a press — that is what sends a guest to sign in.
   */
  locked?: boolean
}

const ShowtimeStatusControl = ({
  status,
  onChange,
  hasOpenInvite = false,
  locked = false,
}: ShowtimeStatusControlProps) => (
  <Flex
    gap="6px"
    role="group"
    aria-label="Your status"
    opacity={locked ? 0.45 : 1}
  >
    {OPTIONS.map((option) => {
      const isOn =
        !locked &&
        option.status === status &&
        !(hasOpenInvite && option.status === "NOT_GOING")

      return (
        <PanelPressable
          type="button"
          key={option.status}
          onClick={() => onChange(option.status)}
          aria-pressed={isOn}
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          gap="3px"
          flex="1"
          minW={0}
          py="8px"
          px="4px"
          borderRadius="10px"
          borderWidth="1px"
          borderColor={isOn ? option.border : "border"}
          bg={isOn ? option.bg : "bg.panel"}
          color={isOn ? option.fg : "fg.muted"}
          cursor="pointer"
          transition="background-color 120ms ease, border-color 120ms ease, color 120ms ease, transform 90ms ease"
          _hover={isOn || locked ? undefined : { bg: "bg.subtle", color: "fg" }}
          _active={{ transform: "scale(0.97)" }}
          _focusVisible={{
            outline: "2px solid",
            outlineColor: "app.tint",
            outlineOffset: "1px",
          }}
        >
          <Box as={option.icon} boxSize="20px" aria-hidden />
          <Text
            fontSize="12px"
            fontWeight={isOn ? "700" : "600"}
            lineHeight="1.2"
            truncate
          >
            {option.label}
          </Text>
        </PanelPressable>
      )
    })}
  </Flex>
)

export default ShowtimeStatusControl
