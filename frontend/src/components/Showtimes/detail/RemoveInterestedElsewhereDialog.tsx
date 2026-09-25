/**
 * "Clear your other 'interested' marks?", shown right after the viewer marks a
 * screening going when they had other screenings of the same film marked
 * interested (and none of those others going — see `ShowtimeStatusSection`).
 * The app's `mobile/components/showtimes/RemoveInterestedElsewhereDialog`, in
 * its words.
 *
 * Every screening starts ticked, since the default is to clear them all. The
 * "don't ask again" box is saved on either answer, whether or not anything is
 * removed. Closing it any other way — Esc, the backdrop — counts as "Keep as
 * is".
 */
import { Box, Dialog, Flex, Portal, Text } from "@chakra-ui/react"
import { DateTime } from "luxon"
import { useState } from "react"
import type { ShowtimeInMoviePublic } from "shared"

import {
  PanelActionButton,
  PanelPressable,
} from "@/components/Showtimes/detail/PanelChrome"
import { PanelIcon } from "@/components/Showtimes/detail/panel-icons"
import { setRemoveInterestedReminderEnabled } from "@/features/showtimes/interested-elsewhere-reminder"

/** How tall the list may get before it scrolls inside the dialog. */
const LIST_MAX_HEIGHT = "260px"

const TITLE = "Clear your other “interested” marks?"
const MESSAGE =
  "You're going to this showing. Want to remove “interested” from these other " +
  "showings of the same film?"

type RemoveInterestedElsewhereDialogProps = {
  open: boolean
  /** Kept while closing, so the list doesn't empty out under the animation. */
  showtimes: readonly ShowtimeInMoviePublic[]
  onConfirm: (selectedIds: number[]) => void
  onSkip: () => void
}

const Checkbox = ({ isOn }: { isOn: boolean }) => (
  <Flex
    as="span"
    align="center"
    justify="center"
    flexShrink={0}
    boxSize="20px"
    borderRadius="5px"
    borderWidth="2px"
    borderColor={isOn ? "app.tint" : "border"}
    bg={isOn ? "app.tint" : "transparent"}
    color="app.pillActiveText"
    transition="background-color 120ms ease, border-color 120ms ease"
  >
    {isOn ? <Box as={PanelIcon.check} boxSize="14px" aria-hidden /> : null}
  </Flex>
)

const ROW_PROPS = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  w: "100%",
  px: "6px",
  py: "6px",
  borderRadius: "8px",
  bg: "transparent",
  cursor: "pointer",
  textAlign: "left",
  transition: "background-color 120ms ease",
  _hover: { bg: "bg.subtle" },
  _focusVisible: {
    outline: "2px solid",
    outlineColor: "app.tint",
    outlineOffset: "-2px",
  },
} as const

const RemoveInterestedElsewhereDialog = ({
  open,
  showtimes,
  onConfirm,
  onSkip,
}: RemoveInterestedElsewhereDialogProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(
    () => new Set(showtimes.map((showtime) => showtime.id)),
  )
  const [dontAskAgain, setDontAskAgain] = useState(false)
  // Reseeded on each open.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSelectedIds(new Set(showtimes.map((showtime) => showtime.id)))
      setDontAskAgain(false)
    }
  }

  const toggle = (showtimeId: number) =>
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(showtimeId)) next.delete(showtimeId)
      else next.add(showtimeId)
      return next
    })

  const applyDontAskAgain = () => {
    if (dontAskAgain) setRemoveInterestedReminderEnabled(false)
  }
  const skip = () => {
    applyDontAskAgain()
    onSkip()
  }
  const confirm = () => {
    applyDontAskAgain()
    onConfirm(
      showtimes
        .map((showtime) => showtime.id)
        .filter((id) => selectedIds.has(id)),
    )
  }

  // Render/output using the state and derived values prepared above.
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details) => {
        if (!details.open) skip()
      }}
      placement="center"
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content
            w="100%"
            maxW="380px"
            p="20px"
            borderRadius="16px"
            bg="bg.panel"
          >
            <Flex
              align="center"
              justify="center"
              boxSize="40px"
              mb="10px"
              borderRadius="full"
              bg="app.surfaceMuted"
              color="app.tint"
            >
              <Box as={PanelIcon.playlistRemove} boxSize="20px" aria-hidden />
            </Flex>

            <Dialog.Title fontSize="16px" fontWeight="700" lineHeight="1.3">
              {TITLE}
            </Dialog.Title>
            <Dialog.Description
              fontSize="13px"
              color="fg.muted"
              lineHeight="1.5"
              mt="4px"
            >
              {MESSAGE}
            </Dialog.Description>

            <Box
              maxH={LIST_MAX_HEIGHT}
              overflowY="auto"
              overscrollBehavior="contain"
              mt="12px"
              mx="-6px"
            >
              {showtimes.map((showtime) => {
                const isOn = selectedIds.has(showtime.id)
                const start = DateTime.fromISO(showtime.datetime)
                return (
                  <PanelPressable
                    type="button"
                    key={showtime.id}
                    // biome-ignore lint/a11y/useSemanticElements: ARIA checkbox pattern on a styled button; a native checkbox cannot take this styling
                    role="checkbox"
                    aria-checked={isOn}
                    onClick={() => toggle(showtime.id)}
                    {...ROW_PROPS}
                  >
                    <Box flex="1" minW={0}>
                      <Text fontSize="14px" fontWeight="600" truncate>
                        {showtime.cinema.name}
                      </Text>
                      <Text fontSize="12px" color="fg.muted">
                        {start.isValid
                          ? start.toFormat("ccc d LLL · HH:mm")
                          : ""}
                      </Text>
                    </Box>
                    <Checkbox isOn={isOn} />
                  </PanelPressable>
                )
              })}
            </Box>

            <PanelPressable
              type="button"
              // biome-ignore lint/a11y/useSemanticElements: ARIA checkbox pattern on a styled button; a native checkbox cannot take this styling
              role="checkbox"
              aria-checked={dontAskAgain}
              onClick={() => setDontAskAgain((current) => !current)}
              {...ROW_PROPS}
              mt="8px"
              mx="-6px"
              w="calc(100% + 12px)"
            >
              <Checkbox isOn={dontAskAgain} />
              <Text fontSize="13px" color="fg.muted">
                Don't ask me again
              </Text>
            </PanelPressable>

            <Flex gap="8px" mt="12px">
              <Box display="grid" flex="1">
                <PanelActionButton onClick={skip}>Keep as is</PanelActionButton>
              </Box>
              <Box display="grid" flex="1">
                <PanelActionButton primary onClick={confirm}>
                  Remove
                </PanelActionButton>
              </Box>
            </Flex>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

export default RemoveInterestedElsewhereDialog
