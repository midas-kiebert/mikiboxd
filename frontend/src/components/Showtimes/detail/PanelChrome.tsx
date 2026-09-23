/**
 * The vocabulary the showtime panel is built from: an action, a small square
 * icon button, an empty state, and the real `<button>`/`<a>` everything
 * pressable is made of.
 *
 * The same idea as `Feed/FilterRailControls` on the other side of the list —
 * one file owns the metrics so the panel reads as one designed surface rather
 * than a stack of ad-hoc Chakra props — and it borrows that file's rules,
 * because the two cards face each other across the feed and any disagreement
 * between them is visible in a single glance:
 *
 *   - Anything stateful is fully round; anything that *does* something is
 *     squared to `PRESET_BUTTON_RADIUS`. The corner is the only signal a
 *     label like a friend's name can never carry itself.
 *   - Transitions are 120ms, so a hover here matches a hover there.
 *
 * It used to own a `PanelSection` heading, a meta line and a count bubble as
 * well. Those went when the panel took the app's layout: the app has no
 * uppercase section headings here, and the facts they organised are now the
 * header's own badges and the seat card's rows.
 *
 * What differs is the ground. The rail sits on a tinted green card and has to
 * fight it; this sits on `bg.panel`, so the neutrals work and the ink is the
 * ordinary `fg` / `fg.muted` pair.
 */
import { Box, Flex, Text, chakra } from "@chakra-ui/react"
import type { ElementType, ReactNode } from "react"
import { PRESET_BUTTON_RADIUS } from "shared/filters/filter-control-metrics"

/**
 * A real `<button>` and a real `<a>` that still take style props.
 *
 * `Box as="button"` looks like the same thing and is not: `as` only swaps the
 * rendered tag, so the props stay a `div`'s and `type`, `disabled` and `href`
 * are not among them. Everything in the panel that is pressable is built from
 * these two, which is also what keeps keyboard activation and the disabled
 * state working without an `onKeyDown` written by hand.
 */
export const PanelPressable = chakra("button")
export const PanelAnchor = chakra("a")

/** Squared, for anything that performs an action. */
export const ACTION_RADIUS = `${PRESET_BUTTON_RADIUS}px`

/**
 * The type scale for a row that states a fact and answers it — "Available
 * seats" against the count, "Status visible to" against the mode.
 *
 * Larger than the rest of the panel on purpose. These two are the lines people
 * actually come to the panel to read, and they were set at the app's sizes,
 * which are sized for a sheet that fills a phone. A 460px column beside a feed
 * has room the sheet does not, and 11px for the answer to "how full is it" was
 * smaller than the label asking it.
 *
 * One pair of tokens rather than two sets of literals, because the two rows sit
 * within a card of each other and any disagreement between them reads as a
 * mistake.
 */
export const PANEL_ROW_LABEL_SIZE = { base: "13px", "2xl": "14px" }
export const PANEL_ROW_VALUE_SIZE = { base: "12px", "2xl": "13px" }

const FOCUS_RING = {
  outline: "2px solid",
  outlineColor: "app.tint",
  outlineOffset: "1px",
} as const

type PanelActionButtonProps = {
  children: ReactNode
  onClick?: () => void
  href?: string
  icon?: ElementType
  /** Solid green. For the one action a section is actually for. */
  primary?: boolean
  fullWidth?: boolean
  disabled?: boolean
  title?: string
  /**
   * Renders the whole thing as a `span`, for the case where the caller has
   * already wrapped it in the router's own `Link` — a `button` inside an
   * anchor is invalid, and the router's link is what gives client-side
   * navigation its prefetching and its middle-click.
   */
  insideLink?: boolean
}

/**
 * A button that does something: check the seats, send the invites, open the
 * ticket shop. Rendered as an anchor when it is a link, so the browser's own
 * middle-click and "copy link" keep working.
 */
export const PanelActionButton = ({
  children,
  onClick,
  href,
  icon,
  primary = false,
  fullWidth = false,
  disabled = false,
  title,
  insideLink = false,
}: PanelActionButtonProps) => {
  const style = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    w: fullWidth ? "100%" : undefined,
    minW: 0,
    px: "12px",
    py: "7px",
    borderRadius: ACTION_RADIUS,
    borderWidth: "1px",
    borderColor: primary ? "app.tint" : "border",
    bg: primary ? "app.tint" : "bg.panel",
    color: primary ? "app.pillActiveText" : "fg",
    fontSize: "13px",
    fontWeight: "600",
    lineHeight: "1.3",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition:
      "background-color 120ms ease, border-color 120ms ease, opacity 120ms ease",
    _hover: disabled
      ? undefined
      : { bg: primary ? "app.green.secondary" : "bg.subtle" },
    _focusVisible: FOCUS_RING,
  }

  const body = (
    <>
      {icon ? (
        <Box as={icon} boxSize="14px" flexShrink={0} aria-hidden />
      ) : null}
      {/* Nudged when there's an icon leading it: no-descender labels leave
          their own line-box empty below the letters, which flex-centering
          still splits evenly against the icon, landing the ink high. */}
      <Box
        as="span"
        truncate
        position="relative"
        top={icon ? "1px" : undefined}
      >
        {children}
      </Box>
    </>
  )

  if (href) {
    return (
      <PanelAnchor
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        {...style}
      >
        {body}
      </PanelAnchor>
    )
  }

  // Already inside the router's own `Link`: a button nested in an anchor is
  // invalid, and the anchor is what carries the navigation.
  if (insideLink) {
    return (
      <Flex as="span" title={title} {...style}>
        {body}
      </Flex>
    )
  }

  return (
    <PanelPressable
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      {...style}
    >
      {body}
    </PanelPressable>
  )
}

type PanelIconButtonProps = {
  /** The accessible name; these carry an icon and no text. */
  label: string
  onClick: () => void
  children: ReactNode
  /** Drawn as pressed — for a control that is a state, like a watch. */
  isOn?: boolean
  tone?: "neutral" | "danger"
  disabled?: boolean
}

/** The small square actions beside a row: nudge, uninvite, refresh, copy. */
export const PanelIconButton = ({
  label,
  onClick,
  children,
  isOn = false,
  tone = "neutral",
  disabled = false,
}: PanelIconButtonProps) => {
  const ink = tone === "danger" ? "app.red.secondary" : "fg.muted"

  return (
    <PanelPressable
      type="button"
      aria-label={label}
      aria-pressed={isOn}
      title={label}
      onClick={onClick}
      disabled={disabled}
      flexShrink={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      boxSize="28px"
      borderRadius={ACTION_RADIUS}
      color={isOn ? "app.tint" : ink}
      bg={isOn ? "app.green.primary" : "transparent"}
      cursor={disabled ? "not-allowed" : "pointer"}
      opacity={disabled ? 0.4 : 1}
      transition="background-color 120ms ease, color 120ms ease"
      _hover={
        disabled
          ? undefined
          : {
              bg: isOn ? "app.green.primary" : "bg.subtle",
              color: isOn ? "app.tint" : "fg",
            }
      }
      _focusVisible={FOCUS_RING}
    >
      {children}
    </PanelPressable>
  )
}

/** What a section says when it has nothing in it yet. */
export const PanelEmpty = ({ children }: { children: ReactNode }) => (
  <Text fontSize="12px" color="fg.subtle" lineHeight="1.5">
    {children}
  </Text>
)
