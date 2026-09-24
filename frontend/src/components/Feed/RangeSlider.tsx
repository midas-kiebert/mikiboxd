/**
 * The app's dual-handle range slider, for the web: time of day and film length.
 *
 * A port of `mobile/components/filters/TimeRangeSliderInline.tsx` and
 * `RuntimeRangeSliderInline.tsx` — the same scales, the same geometry, the same
 * colours (a filled tint start handle, a hollow end handle, the chosen stretch
 * of track in the tint at 38%) and the same label to the right. The two app
 * files are one component twice over; here the scale is the only thing that
 * differs, so it is a parameter.
 *
 * Like the app it writes on release, not on every step: each write is a new
 * URL and a refetch, and a drag across the day would otherwise be forty of
 * them. The handle follows the pointer locally and holds its place after the
 * write until the feed's own value catches up, so it never jumps back.
 *
 * Keyboard: each handle is a `slider` — arrows step, Page Up/Down step four,
 * Home/End go to the ends.
 */
import { Box, Flex, Text } from "@chakra-ui/react"
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react"
import {
  RUNTIME_MAX_MINUTES,
  RUNTIME_MIN_MINUTES,
  RUNTIME_STEP_MINUTES,
  formatRuntimePillLabel,
} from "shared/filters/runtime-range-utils"
import { formatTimePillLabel } from "shared/filters/time-range-utils"

/** How a slider's slots map to the tokens in a `"start-end"` range string. */
export type RangeScale = {
  slotCount: number
  /** The token for a slot; only ever asked for slots strictly inside the scale. */
  toToken: (slot: number) => string
  /** The slot for a token, or null when it does not parse. */
  toSlot: (token: string) => number | null
  /** The words to the right of the track. */
  describe: (ranges: string[]) => string
}

const MINUTES_PER_DAY = 24 * 60

// ─── Time of day: the app's 09:30 → 03:00 in quarter hours ─────────────────
const TIME_BASE_MINUTES = 9 * 60 + 30
const TIME_STEP_MINUTES = 15
const TIME_END_MINUTES = MINUTES_PER_DAY + 3 * 60

const pad = (value: number) => String(value).padStart(2, "0")

export const TIME_SCALE: RangeScale = {
  slotCount: (TIME_END_MINUTES - TIME_BASE_MINUTES) / TIME_STEP_MINUTES,
  toToken: (slot) => {
    const minutes =
      (TIME_BASE_MINUTES + slot * TIME_STEP_MINUTES) % MINUTES_PER_DAY
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
  },
  toSlot: (token) => {
    const [hours, minutes] = token.split(":", 2).map(Number)
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
    let total = hours * 60 + minutes
    // Anything before the scale starts is after midnight, on the scale's tail.
    if (total < TIME_BASE_MINUTES) total += MINUTES_PER_DAY
    return Math.round((total - TIME_BASE_MINUTES) / TIME_STEP_MINUTES)
  },
  describe: formatTimePillLabel,
}

// ─── Film length: the app's 5 → 200 minutes in fives ────────────────────────
export const RUNTIME_SCALE: RangeScale = {
  slotCount: (RUNTIME_MAX_MINUTES - RUNTIME_MIN_MINUTES) / RUNTIME_STEP_MINUTES,
  toToken: (slot) => String(RUNTIME_MIN_MINUTES + slot * RUNTIME_STEP_MINUTES),
  toSlot: (token) => {
    const minutes = Number.parseInt(token, 10)
    if (!Number.isFinite(minutes)) return null
    return Math.round((minutes - RUNTIME_MIN_MINUTES) / RUNTIME_STEP_MINUTES)
  },
  describe: formatRuntimePillLabel,
}

// ─── Geometry, from the app ─────────────────────────────────────────────────
const SLIDER_HEIGHT = 42
const TRACK_HEIGHT = 5
const TRACK_TOP = Math.round(SLIDER_HEIGHT * 0.62)
const HANDLE_SIZE = 18
const HANDLE_TOP = TRACK_TOP - Math.round((HANDLE_SIZE - TRACK_HEIGHT) / 2)
const LABEL_OFFSET = 26
const LABEL_TOP = TRACK_TOP - LABEL_OFFSET
/** The two handles never meet: a range is at least one step wide. */
const MIN_RANGE_SLOTS = 1
const PAGE_STEP_SLOTS = 4

type Slots = { start: number; end: number }
type Boundary = "start" | "end"

const clamp = (slot: number, max: number) => Math.max(0, Math.min(slot, max))

const parseRange = (range: string | undefined, scale: RangeScale): Slots => {
  const full = { start: 0, end: scale.slotCount }
  if (!range) return full
  const [startToken = "", endToken = ""] = range.split("-", 2)
  const start = startToken ? scale.toSlot(startToken) : 0
  const end = endToken ? scale.toSlot(endToken) : scale.slotCount
  if (start === null || end === null) return full
  return {
    start: clamp(Math.min(start, end), scale.slotCount),
    end: clamp(Math.max(start, end), scale.slotCount),
  }
}

/** An open end is written as nothing, and the whole scale as no range at all. */
const buildRanges = ({ start, end }: Slots, scale: RangeScale): string[] => {
  if (start <= 0 && end >= scale.slotCount) return []
  const startToken = start <= 0 ? "" : scale.toToken(start)
  const endToken = end >= scale.slotCount ? "" : scale.toToken(end)
  return [`${startToken}-${endToken}`]
}

const moveBoundary = (
  slots: Slots,
  boundary: Boundary,
  slot: number,
  max: number,
): Slots =>
  boundary === "start"
    ? {
        ...slots,
        start: clamp(Math.min(slot, slots.end - MIN_RANGE_SLOTS), max),
      }
    : {
        ...slots,
        end: clamp(Math.max(slot, slots.start + MIN_RANGE_SLOTS), max),
      }

export const RangeSlider = ({
  scale,
  value,
  onChange,
  label,
}: {
  scale: RangeScale
  /** At most one `"start-end"` range. */
  value: string[]
  onChange: (ranges: string[]) => void
  /** What the two handles are named for a screen reader. */
  label: string
}) => {
  const railRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<Boundary | null>(null)
  const [draft, setDraft] = useState<Slots | null>(null)
  // What was last written, held until the feed's own value arrives.
  const [pending, setPending] = useState<Slots | null>(null)
  const [active, setActive] = useState<Boundary | null>(null)

  const valueKey = value[0] ?? ""
  // biome-ignore lint/correctness/useExhaustiveDependencies: valueKey is the trigger: the feed's own value arrived, so the pending write is done
  useEffect(() => {
    setPending(null)
  }, [valueKey])

  const slots = draft ?? pending ?? parseRange(value[0], scale)
  const max = scale.slotCount

  const commit = (next: Slots) => {
    setPending(next)
    onChange(buildRanges(next, scale))
  }

  const slotAt = (clientX: number) => {
    const rect = railRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return 0
    return clamp(Math.round(((clientX - rect.left) / rect.width) * max), max)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const slot = slotAt(event.clientX)
    // The nearer handle takes the press, as in the app — which is also what
    // makes a click on the track a jump rather than a no-op.
    const boundary: Boundary =
      Math.abs(slot - slots.start) <= Math.abs(slot - slots.end)
        ? "start"
        : "end"
    dragging.current = boundary
    setActive(boundary)
    setDraft(moveBoundary(slots, boundary, slot, max))
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const boundary = dragging.current
    if (!boundary) return
    setDraft((current) =>
      moveBoundary(current ?? slots, boundary, slotAt(event.clientX), max),
    )
  }

  const onPointerUp = () => {
    if (!dragging.current) return
    dragging.current = null
    setActive(null)
    if (draft) commit(draft)
    setDraft(null)
  }

  const onHandleKey =
    (boundary: Boundary) => (event: KeyboardEvent<HTMLDivElement>) => {
      const current = boundary === "start" ? slots.start : slots.end
      const steps: Record<string, number> = {
        ArrowLeft: current - 1,
        ArrowDown: current - 1,
        ArrowRight: current + 1,
        ArrowUp: current + 1,
        PageDown: current - PAGE_STEP_SLOTS,
        PageUp: current + PAGE_STEP_SLOTS,
        Home: 0,
        End: max,
      }
      const target = steps[event.key]
      if (target === undefined) return
      event.preventDefault()
      commit(moveBoundary(slots, boundary, target, max))
    }

  const startPercent = (slots.start / max) * 100
  const endPercent = (slots.end / max) * 100
  const startLabel = slots.start <= 0 ? "" : scale.toToken(slots.start)
  const endLabel = slots.end >= max ? "" : scale.toToken(slots.end)
  const valueLabel = scale.describe(buildRanges(slots, scale))

  const segment = (left: number, width: number, isChosen: boolean) => (
    <Box
      position="absolute"
      top={`${TRACK_TOP}px`}
      h={`${TRACK_HEIGHT}px`}
      left={`${left}%`}
      w={`${Math.max(0, width)}%`}
      borderRadius="full"
      pointerEvents="none"
      {...(isChosen
        ? { bg: "app.tint", opacity: 0.38 }
        : {
            bg: "app.searchBackground",
            borderWidth: "1px",
            borderColor: "app.divider",
          })}
    />
  )

  const handle = (
    boundary: Boundary,
    percent: number,
    slot: number,
    text: string,
  ) => (
    <>
      {text ? (
        <Text
          position="absolute"
          top={`${LABEL_TOP}px`}
          left={`${percent}%`}
          transform={`translateX(-50%)${active === boundary ? " translateY(-1px)" : ""}`}
          minW="40px"
          textAlign="center"
          fontSize="10px"
          fontWeight="700"
          color={active === boundary ? "fg" : "fg.muted"}
          pointerEvents="none"
          userSelect="none"
        >
          {text}
        </Text>
      ) : null}
      <Box
        role="slider"
        tabIndex={0}
        aria-label={`${label}, ${boundary === "start" ? "from" : "until"}`}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={slot}
        aria-valuetext={text || (boundary === "start" ? "Start" : "End")}
        onKeyDown={onHandleKey(boundary)}
        position="absolute"
        top={`${HANDLE_TOP}px`}
        left={`${percent}%`}
        boxSize={`${HANDLE_SIZE}px`}
        ml={`-${HANDLE_SIZE / 2}px`}
        borderRadius="full"
        borderWidth="2px"
        bg={boundary === "start" ? "app.tint" : "bg"}
        borderColor={boundary === "start" ? "bg" : "app.tint"}
        boxShadow="0 1px 3px color-mix(in srgb, var(--chakra-colors-app-tint) 18%, transparent)"
        transform={active === boundary ? "scale(1.08)" : undefined}
        cursor="grab"
        outline="none"
        // Style props, not a hand-written shadow: `app.green.border` is a dotted
        // key, so its CSS variable name needs escaping and a guess at it would
        // silently void the whole declaration.
        _focusVisible={{
          outline: "3px solid",
          outlineColor: "app.green.border",
          outlineOffset: "1px",
        }}
      />
    </>
  )

  return (
    <Flex align="center">
      <Box flex="3" h={`${SLIDER_HEIGHT}px`} px="4px">
        <Box
          ref={railRef}
          position="relative"
          h="100%"
          cursor="pointer"
          touchAction="none"
          userSelect="none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {segment(0, startPercent, false)}
          {segment(endPercent, 100 - endPercent, false)}
          {segment(startPercent, endPercent - startPercent, true)}
          {handle("start", startPercent, slots.start, startLabel)}
          {handle("end", endPercent, slots.end, endLabel)}
        </Box>
      </Box>
      <Text
        flex="1"
        pl="14px"
        mt={`${TRACK_TOP + Math.round(TRACK_HEIGHT / 2) - Math.round(SLIDER_HEIGHT / 2)}px`}
        fontSize="12px"
        color="fg.muted"
        whiteSpace="nowrap"
      >
        {valueLabel}
      </Text>
    </Flex>
  )
}
