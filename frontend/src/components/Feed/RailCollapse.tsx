/**
 * The filter rail's collapsed form, and the handle that collapses it.
 *
 * Collapsed, the rail is a slim strip: the filters button (with the number of
 * filters in force, so a narrowed feed never looks unfiltered) and whatever
 * the page puts under the rail, in its compact form. `FeedLayout` decides
 * when: the reader can fold it away (remembered on this device), and it folds
 * itself when the window is too narrow for the list beside it — see
 * `minListWidth` there.
 *
 * The handle is a slim tab on the rail card's right edge, the way sidebars
 * usually offer it, so it costs the rail no height.
 */
import { Box, Flex, chakra } from "@chakra-ui/react"
import {
  type ReactNode,
  type Ref,
  createContext,
  useCallback,
  useContext,
  useState,
} from "react"
import { FiChevronLeft, FiSliders } from "react-icons/fi"

const StripButton = chakra("button")

/**
 * Whether the rail is folded to its strip, for whatever sits in the list
 * beside it: the ticket wall offers a fifth ticket a row in the room a folded
 * rail gives back. Provided by `FeedLayout`; false outside it.
 */
const RailFoldedContext = createContext(false)
export const RailFoldedProvider = RailFoldedContext.Provider
export const useIsRailFolded = () => useContext(RailFoldedContext)

/** How wide the collapsed rail is: its 36px buttons and a hair either side. */
export const RAIL_STRIP_WIDTH = { base: "44px" }
/**
 * And the gap after it — half a docked rail's. A strip of icons is not a
 * column of text that wants breathing room, and the list gets the space.
 */
export const RAIL_STRIP_GAP = 12

/** The handle: a slim tab, taller than wide, like a divider's grip. */
const HANDLE_WIDTH = 16
const HANDLE_HEIGHT = 40
/** Level with the rail card's first heading rather than its very corner. */
const HANDLE_INSET_TOP = 10

const STORAGE_KEY = "mikino.feed.railCollapsed.v1"

const readCollapsed = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    // ignore storage read errors
    return false
  }
}

/** Whether the reader folded the rail away, kept on this device. */
export const useRailCollapsed = () => {
  const [isCollapsed, setIsCollapsed] = useState(readCollapsed)
  const setCollapsed = useCallback((next: boolean) => {
    setIsCollapsed(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
    } catch {
      // ignore storage write errors
    }
  }, [])
  return [isCollapsed, setCollapsed] as const
}

/**
 * Sits straight after the rail in the row, taking no width of its own: its
 * margins put it in the middle of the gap the rail leaves, and the tab hangs
 * from it, centred on the rail card's right edge — so the card's own outline
 * runs into it and it reads as part of the card rather than a loose button in
 * the gap. Sticky like the rail, so it stays beside the card it folds.
 */
export const RailCollapseHandle = ({
  gap,
  inset = 0,
  top,
  onCollapse,
}: {
  /** The rail's trailing gap, which the handle's anchor sits in the middle of. */
  gap: number
  /**
   * How far inside the rail's column its card ends — the scroll lane the
   * column reserves (`scrollbar-gutter`), which is as wide as the platform's
   * scrollbar and so has to be measured.
   */
  inset?: number
  top: string
  onCollapse: () => void
}) => (
  <Box
    position="sticky"
    top={top}
    alignSelf="flex-start"
    w={0}
    h={0}
    ms={`-${gap / 2}px`}
    me={`${gap / 2}px`}
    zIndex={4}
  >
    <StripButton
      type="button"
      onClick={onCollapse}
      aria-label="Collapse filters"
      title="Collapse filters"
      position="absolute"
      top={`${HANDLE_INSET_TOP}px`}
      // From the middle of the gap back to the card's edge, then half the tab.
      left={`-${gap / 2 + inset + HANDLE_WIDTH / 2}px`}
      w={`${HANDLE_WIDTH}px`}
      h={`${HANDLE_HEIGHT}px`}
      display="flex"
      alignItems="center"
      justifyContent="center"
      borderRadius="full"
      borderWidth="1px"
      borderColor="border"
      bg="bg.panel"
      color="fg.muted"
      boxShadow="0 1px 3px rgb(0 0 0 / 0.08)"
      cursor="pointer"
      transition="color 120ms ease, background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease"
      _hover={{
        color: "fg",
        bg: "bg.subtle",
        borderColor: "border.emphasized",
        boxShadow: "0 2px 6px rgb(0 0 0 / 0.12)",
      }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "app.tint",
        outlineOffset: "2px",
      }}
    >
      <FiChevronLeft size={13} strokeWidth={2.5} />
    </StripButton>
  </Box>
)

export const RailStrip = ({
  activeFilterCount,
  isOpen,
  onToggle,
  footer,
  stripRef,
}: {
  activeFilterCount: number
  /** The filters are open beside the strip, floating over the list. */
  isOpen: boolean
  onToggle: () => void
  footer?: ReactNode
  stripRef?: Ref<HTMLDivElement>
}) => (
  <Flex
    ref={stripRef}
    direction="column"
    align="center"
    gap="6px"
    py="4px"
    bg="bg.panel"
    borderWidth="1px"
    borderColor="border"
    borderRadius="md"
    boxShadow="sm"
  >
    <StripButton
      type="button"
      onClick={onToggle}
      aria-label={isOpen ? "Hide filters" : "Show filters"}
      aria-expanded={isOpen}
      title={isOpen ? "Hide filters" : "Show filters"}
      position="relative"
      boxSize="36px"
      display="flex"
      alignItems="center"
      justifyContent="center"
      borderRadius="md"
      bg={isOpen ? "app.surfaceMuted" : "transparent"}
      color={isOpen || activeFilterCount > 0 ? "fg" : "fg.muted"}
      cursor="pointer"
      transition="color 120ms ease, background-color 120ms ease"
      _hover={{ color: "fg", bg: isOpen ? "app.surfaceMuted" : "bg.subtle" }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "app.tint",
        outlineOffset: "1px",
      }}
    >
      <FiSliders size={17} />
      {activeFilterCount > 0 ? (
        <Box
          as="span"
          position="absolute"
          top="1px"
          right="1px"
          minW="16px"
          h="16px"
          px="4px"
          borderRadius="full"
          bg="app.pillActiveBackground"
          color="app.pillActiveText"
          fontSize="10px"
          fontWeight="700"
          lineHeight="16px"
          textAlign="center"
        >
          {activeFilterCount}
        </Box>
      ) : null}
    </StripButton>
    {footer ? (
      <>
        <Box w="24px" borderTopWidth="1px" borderColor="border" aria-hidden />
        {footer}
      </>
    ) : null}
  </Flex>
)
