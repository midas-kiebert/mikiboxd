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
 */
const STAGGER_STEP_MS = 45;
const MAX_STAGGER_INDEX = 8;
const DURATION_MS = 240;
const LIFT_PX = 10;

export function FeedItemEntrance({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  const delay = Math.min(index, MAX_STAGGER_INDEX) * STAGGER_STEP_MS;
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
