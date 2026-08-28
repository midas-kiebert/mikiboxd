/**
 * Mobile filter UI component: a chip label that changes without snapping.
 *
 * Text cannot really morph, so this crosses one label into the next: the
 * outgoing text slides out sideways and fades while the incoming text slides
 * in behind it. The direction follows the width: a longer label arrives from
 * the right as the chip opens up to make room for it, a shorter one from the
 * left as the chip closes in — so the text and the box are travelling the same
 * way at the same moment rather than being two separate animations. Which
 * matters most on the cinema pill, whose label is a count one moment and a
 * preset's name the next.
 *
 * The outgoing copy is laid out absolutely, so only the incoming text decides
 * how wide the chip wants to be, and it is left mounted at zero opacity
 * afterwards rather than cleared on a timer — it costs one invisible Text and
 * saves a timer that could outlive the screen.
 *
 * Each swap mounts a fresh pair of copies and animates them with `entering`,
 * rather than resetting one shared progress value. A shared value can only be
 * put back to the start from an effect, which runs after the commit that
 * already showed the new label finished and in place — a single frame of the
 * wrong thing, seen as a flash just before the transition.
 */
import { useMemo, useRef, useState } from "react";
import { StyleSheet, View, type StyleProp, type TextStyle } from "react-native";
import Animated, {
  withDelay,
  withTiming,
  type EntryExitAnimationFunction,
} from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";
import {
  LABEL_MORPH_EASING,
  LABEL_MORPH_MS,
  LABEL_MORPH_SHIFT,
} from "@/components/filters/filter-change-animation";

/**
 * The incoming copy: from a shift in the direction the chip is travelling,
 * into place. `initialValues` land in the commit that mounts it, which is what
 * makes this flash-free.
 */
const makeIncoming =
  (delayMs: number, direction: number): EntryExitAnimationFunction =>
  () => {
    "worklet";
    return {
      initialValues: {
        opacity: 0,
        transform: [{ translateX: LABEL_MORPH_SHIFT * direction }],
      },
      animations: {
        opacity: withDelay(
          delayMs,
          withTiming(1, { duration: LABEL_MORPH_MS, easing: LABEL_MORPH_EASING })
        ),
        transform: [
          {
            translateX: withDelay(
              delayMs,
              withTiming(0, { duration: LABEL_MORPH_MS, easing: LABEL_MORPH_EASING })
            ),
          },
        ],
      },
    };
  };

/**
 * The outgoing copy: in place, then out the other way. Also an *entering*
 * animation — it is a newly mounted view being animated towards the resting
 * style it will hold afterwards, which is why that style is `opacity: 0`.
 */
const makeOutgoing =
  (delayMs: number, direction: number): EntryExitAnimationFunction =>
  () => {
    "worklet";
    return {
      initialValues: { opacity: 1, transform: [{ translateX: 0 }] },
      animations: {
        opacity: withDelay(
          delayMs,
          withTiming(0, { duration: LABEL_MORPH_MS, easing: LABEL_MORPH_EASING })
        ),
        transform: [
          {
            translateX: withDelay(
              delayMs,
              withTiming(-LABEL_MORPH_SHIFT * direction, {
                duration: LABEL_MORPH_MS,
                easing: LABEL_MORPH_EASING,
              })
            ),
          },
        ],
      },
    };
  };

type MorphingChipLabelProps = {
  label: string;
  style?: StyleProp<TextStyle>;
  /**
   * Held back by exactly what holds the chip's own resize back, so the text and
   * the box it lives in start and finish together. Anything else reads as the
   * pill lagging behind its label.
   */
  delayMs?: number;
};

type LabelSwap = {
  displayed: string;
  outgoing: string | null;
  /**
   * The width the outgoing label had while it was the one in the chip. It has
   * to be given back to it: the chip is laid out at its *new* width the moment
   * the label changes, so a longer outgoing label left to fill the slot is
   * measured against a box that has already shrunk, and truncates to an
   * ellipsis for the whole of its exit.
   */
  outgoingWidth: number;
  /** 1 when the chip is opening up for a longer label, -1 when closing in. */
  direction: number;
  /** Bumped on every swap, so the animation restarts even for a repeat. */
  count: number;
};

export default function MorphingChipLabel({
  label,
  style,
  delayMs = 0,
}: MorphingChipLabelProps) {
  const [swap, setSwap] = useState<LabelSwap>(() => ({
    displayed: label,
    outgoing: null,
    outgoingWidth: 0,
    direction: 1,
    count: 0,
  }));
  /** Measured from the label currently in the chip, for when it becomes the
   * outgoing one. */
  const displayedWidth = useRef(0);

  // Taken during render rather than in an effect, so the new text — and the
  // width the chip wants for it — reaches the same commit as whatever changed
  // it. Deferring by a frame put the chip's resize in a commit of its own,
  // after the row had stopped holding movement back for chips that were still
  // animating away, and the two collided.
  if (swap.displayed !== label) {
    setSwap((previous) => ({
      displayed: label,
      outgoing: previous.displayed,
      outgoingWidth: displayedWidth.current,
      // Length stands in for width here: the labels share a font, and being
      // one character out only matters if it flips the sign, which needs the
      // two to be the same width anyway.
      direction: label.length >= previous.displayed.length ? 1 : -1,
      count: previous.count + 1,
    }));
  }

  const { displayed, outgoing, outgoingWidth, direction, count } = swap;

  // Stable across renders that change nothing about the swap, so a re-render
  // for some other reason never looks like a new animation to Reanimated.
  const incoming = useMemo(() => makeIncoming(delayMs, direction), [delayMs, direction]);
  const leaving = useMemo(() => makeOutgoing(delayMs, direction), [delayMs, direction]);

  return (
    <View style={styles.slot}>
      <Animated.View
        // A new copy per swap, so its animation starts from its own first
        // frame. The first label of all is not a swap and simply appears.
        key={`in-${count}`}
        entering={count === 0 ? undefined : incoming}
        onLayout={(event) => {
          displayedWidth.current = event.nativeEvent.layout.width;
        }}
      >
        <ThemedText style={style} numberOfLines={1}>
          {displayed}
        </ThemedText>
      </Animated.View>
      {outgoing !== null && (
        <Animated.View
          key={`out-${count}`}
          entering={leaving}
          style={[styles.outgoing, outgoingWidth > 0 ? { width: outgoingWidth } : null]}
          pointerEvents="none"
        >
          <ThemedText style={style} numberOfLines={1}>
            {outgoing}
          </ThemedText>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { flexShrink: 1 },
  // No `right`: the outgoing label carries its own width instead of being
  // stretched to a slot that has already resized around it.
  //
  // `opacity: 0` is where its animation leaves it: an entering animation hands
  // the view back to its own style once it is done, and anything else here
  // would pop the old label back into view at the end.
  outgoing: { position: "absolute", left: 0, top: 0, opacity: 0 },
});
