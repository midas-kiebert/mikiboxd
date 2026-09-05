import Animated, { Easing, FadeInDown } from "react-native-reanimated";

/**
 * Wraps one feed row (a `ShowtimeCard`/`MovieCard`) so it fades and lifts
 * into place instead of popping in when its data arrives — cards further
 * down the first screenful follow a beat behind the ones above, so a fresh
 * page reads as filling in one-by-one rather than snapping in as a block.
 *
 * Capped at {@link MAX_STAGGER_INDEX}: past the first screenful the stagger
 * would only make lower rows land later for no visible reason, since they're
 * off-screen anyway.
 *
 * `index` is the row's position in the *whole* list, which only means "how
 * far down the first screenful" for an initial load. A page appended by
 * scrolling starts well past `MAX_STAGGER_INDEX`, so without `stagger={false}`
 * every one of its rows would sit at the same flat capped delay before
 * starting its own fade — read as a dead gap between the load-more spinner
 * fading out and the new rows actually appearing, since the reader is
 * already looking at the bottom of the list and was just told more was
 * coming, unlike the first load's blank screen.
 */
const STAGGER_STEP_MS = 45;
const MAX_STAGGER_INDEX = 8;
const DURATION_MS = 240;
const LIFT_PX = 10;

export function FeedItemEntrance({
  index,
  stagger = true,
  children,
}: {
  index: number;
  stagger?: boolean;
  children: React.ReactNode;
}) {
  const delay = stagger ? Math.min(index, MAX_STAGGER_INDEX) * STAGGER_STEP_MS : 0;
  return (
    <Animated.View
      entering={FadeInDown.delay(delay)
        .duration(DURATION_MS)
        .easing(Easing.out(Easing.quad))
        .withInitialValues({ transform: [{ translateY: LIFT_PX }] })}
    >
      {children}
    </Animated.View>
  );
}
