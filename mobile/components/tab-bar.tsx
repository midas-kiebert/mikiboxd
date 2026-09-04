/**
 * The bottom tab bar's parts: the button behind a tab, and the icon and label
 * on it.
 *
 * All three exist for one reason — a tab press has to be answered in the frame
 * it happens, and the default bar cannot do that.
 *
 * The second is the point. Everything the default tab bar shows about which
 * tab is selected — the icon tint, the label colour — is derived from
 * navigation state, and navigation state changes in the same commit that
 * renders the screen being navigated to. So on a mid-range phone a tab press
 * did nothing at all for as long as that screen took to build, and then the
 * bar and the screen arrived together. The tap looked ignored and the switch
 * looked abrupt, which is the same complaint twice.
 *
 * So none of it is derived from navigation state. There is one shared value
 * saying which tab is lit, set on press, and everything here follows it on the
 * UI thread before the navigator has done anything. Navigation still decides
 * what is *actually* selected — this only ever runs ahead of it, and is
 * corrected by it if they ever disagree.
 *
 * Two movements, on purpose, because they answer two different questions:
 *
 *   The flash says *you touched this*. It is fired on touch-down, from one
 *   clock started right there, and nothing it draws is derived from anything
 *   that has to load: a band of light out of the middle of the button, opening
 *   to the edges and gone. It runs whether or not the press turns into a
 *   navigation, and it is the same length every time. It does not hold the
 *   navigation up: the switch is dispatched in the same handler, and what
 *   keeps out of the flash's way is the one part that is actually expensive —
 *   a first visit's screen build, see {@link tabContentHoldMs}.
 *
 *   The lit state says *this is the tab you are on*. That one waits for the
 *   press to actually complete, since a press dragged off and cancelled must
 *   not leave the wrong tab lit.
 *
 * The colours cross-fade rather than animate: an icon's colour is a prop, not
 * a style, so each of them is drawn twice — once in each colour — and the two
 * copies are faded past each other. Cheaper than it sounds (two glyphs), and
 * it needs nothing to support animated colour values.
 */
import { type ReactNode, useRef } from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';
import { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import Animated, {
  Easing,
  interpolate,
  makeMutable,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { triggerTabPressHaptic } from '@/utils/long-press';

import { ThemedText } from '@/components/themed-text';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { useThemeColors } from '@/hooks/use-theme-color';

/**
 * How long the lit tab takes to become the lit tab.
 *
 * Short, and shorter than it reads: the UI thread is also what mounts the
 * screen being navigated to, so a cross-fade still in flight when that lands
 * stalls and then finishes late — which looked like the bar changing its mind
 * a beat after the tap. The less of it is left by then, the less there is to
 * stall. What actually answers the tap is the flash below, which is already
 * most of the way through by the time this starts.
 */
const HIGHLIGHT_MS = 150;
/** How small the lit pill starts, so it grows into place rather than blinking. */
const HIGHLIGHT_SCALE_FROM = 0.94;

/**
 * The press flash, from touch-down to gone.
 *
 * Longer than the cross-fade because it is the part that has to read as a
 * movement — but it is spent almost entirely on the fade out, which is the
 * part that can afford to share the thread.
 */
const FLASH_MS = 260;
/**
 * The flash's clock, driven linearly so that every channel below can shape its
 * own curve out of it with `interpolate` and they all stay in step. Anything
 * eased here would skew all of them at once.
 */
const FLASH_TIMING = { duration: FLASH_MS, easing: Easing.linear } as const;
/** How wide the band of light starts, as a fraction of the button. */
const FLASH_WIDTH_FROM = 0.16;
/** Peak strength of the band, as a hex alpha on the theme's tint. */
const FLASH_ALPHA = '4d';
/** Fully transparent, in the *same* hue — a stop that fades to `transparent`
 *  fades through black on Android instead of simply thinning out. */
const FLASH_ALPHA_NONE = '00';

/**
 * Which tab is lit, as far as the bar is concerned.
 *
 * Module-level and never torn down: it is one string, there is exactly one tab
 * bar, and a shared value is the only kind of state a press can change without
 * waiting for a React commit — which is the whole reason this exists.
 */
const litTab = makeMutable('');

/**
 * When the flash currently running started, in JS-side wall clock.
 *
 * The shared value it drives lives on the UI thread and cannot be read from
 * here, and everything that has to keep out of the flash's way — the
 * navigation below, the tab screens' own mount — is scheduled from this side.
 * One number, for the one flash that can be in flight at a time.
 */
let flashStartedAt = 0;

/**
 * Nothing is kept back from the navigation any more, and that is the point.
 *
 * There used to be a hold here: the press animated first and navigated
 * afterwards, on the theory that the next screen's commit would otherwise take
 * the UI thread off the flash mid-movement. It cost every tab press that much
 * latency before anything happened — including the presses where there was
 * nothing to commit, because the tab was already built and mounted and the
 * switch is only a change of which screen is on top. A wait that shows the tab
 * you are leaving is worse than a wait that shows the tab you asked for, and a
 * built tab was spending the whole hold showing the wrong one.
 *
 * What is left protecting the flash is the only thing that was ever expensive:
 * a first visit's screen build, which waits behind this function with a
 * skeleton already up. The switch itself commits immediately.
 *
 * So: how much longer the flash needs the UI thread, from right now.
 *
 * The tab screens hold their skeleton for this, so that the mount they were
 * always going to do lands after the movement instead of inside it. Read at
 * the moment the wait is set up rather than passed as a constant: a screen
 * mounts at whatever point in the flash the navigation reached it, so the
 * remainder is the only honest answer.
 */
export function tabContentHoldMs(): number {
  return Math.max(0, flashStartedAt + FLASH_MS - Date.now());
}

const FADE = { duration: HIGHLIGHT_MS, easing: Easing.out(Easing.quad) } as const;

/**
 * Cross-fade opacities for one tab's two copies of anything: the one drawn in
 * the selected colour, and the one drawn in the unselected colour.
 */
function useTabFade(tabKey: string) {
  const lit = useAnimatedStyle(() => ({
    opacity: withTiming(litTab.value === tabKey ? 1 : 0, FADE),
  }));
  const dim = useAnimatedStyle(() => ({
    opacity: withTiming(litTab.value === tabKey ? 0 : 1, FADE),
  }));
  return { lit, dim };
}

/** A tab's icon, cross-fading between its two colours. */
export function TabIcon({
  tabKey,
  name,
  size = 28,
  children,
}: {
  tabKey: string;
  name: IconSymbolName;
  size?: number;
  /** A badge, drawn over both copies. */
  children?: ReactNode;
}) {
  const colors = useThemeColors();
  const fade = useTabFade(tabKey);

  return (
    <View style={[styles.iconBox, { width: size, height: size }]}>
      <Animated.View style={[StyleSheet.absoluteFill, fade.dim]}>
        <IconSymbol size={size} name={name} color={colors.tabIconDefault} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, fade.lit]}>
        <IconSymbol size={size} name={name} color={colors.tabIconSelected} />
      </Animated.View>
      {children}
    </View>
  );
}

/** A tab's label, cross-fading between its two colours. */
export function TabLabel({
  tabKey,
  children,
  style,
}: {
  tabKey: string;
  children: string;
  style?: TextStyle;
}) {
  const colors = useThemeColors();
  const fade = useTabFade(tabKey);

  return (
    // The unselected copy is the one in flow, so it alone decides how wide the
    // label is; the selected copy is laid over it and is the same string.
    <View>
      <Animated.View style={fade.dim}>
        <ThemedText style={[styles.label, style, { color: colors.tabIconDefault }]}>
          {children}
        </ThemedText>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, fade.lit]}>
        <ThemedText style={[styles.label, style, { color: colors.tabIconSelected }]}>
          {children}
        </ThemedText>
      </Animated.View>
    </View>
  );
}

export function HapticTab({
  tabKey,
  ...props
}: BottomTabBarButtonProps & { tabKey: string }) {
  const colors = useThemeColors();
  const isSelected = props['aria-selected'] === true;

  // Navigation has the last word, but only when it disagrees about something
  // this button did not cause: a deep link, a back gesture, the first render.
  // Watched as an edge rather than asserted every render — between the press
  // and the navigator catching up, the tab bar still believes the *old* tab is
  // selected, and any re-render in that gap would otherwise snap it back.
  const wasSelected = useRef<boolean | null>(null);
  if (wasSelected.current !== isSelected) {
    const isFirstRender = wasSelected.current === null;
    wasSelected.current = isSelected;
    if (isSelected && (isFirstRender || litTab.value !== tabKey)) {
      litTab.value = tabKey;
    }
  }

  // 0 at rest and after the flash has finished, so both ends of the clock are
  // the button sitting still and nothing has to be reset between presses.
  const flash = useSharedValue(0);

  // The band of light: narrow and bright in the middle of the button, opening
  // out to its edges and thinning as it goes. Its own stops are transparent at
  // both ends, so reaching the edge *is* the fade — there is nothing to clip.
  const flashStyle = useAnimatedStyle(() => ({
    opacity: interpolate(flash.value, [0, 0.1, 0.45, 1], [0, 1, 0.42, 0]),
    transform: [{ scaleX: interpolate(flash.value, [0, 0.45, 1], [FLASH_WIDTH_FROM, 0.72, 1]) }],
  }));

  // The click itself: a dip under the finger and a small overshoot out of it.
  // Deliberately at the edge of noticing — the icon and the label move
  // together, so anything the eye can actually measure reads as the label
  // resizing rather than as the button being pressed. The flash carries the
  // movement; this only has to make it feel like it came from the finger.
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(flash.value, [0, 0.15, 0.45, 1], [1, 0.972, 1.016, 1]) }],
  }));

  const litStyle = useAnimatedStyle(() => {
    const lit = litTab.value === tabKey;
    return {
      opacity: withTiming(lit ? 1 : 0, FADE),
      transform: [{ scale: withTiming(lit ? 1 : HIGHLIGHT_SCALE_FROM, FADE) }],
    };
  });

  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        // Touch-down, before anything else in this file and long before the
        // navigator hears about it: this is the whole reason the flash is on
        // its own clock rather than following the lit tab.
        flashStartedAt = Date.now();
        flash.value = 0;
        flash.value = withTiming(1, FLASH_TIMING);
        // On touch-down with the flash, not on the navigation that follows it:
        // the press is answered by the bar, and the haptic is part of that
        // answer rather than a report that the screen has changed.
        triggerTabPressHaptic();
        props.onPressIn?.(ev);
      }}
      onPress={(ev) => {
        // The bar answers now — it owes the navigator nothing, and this is the
        // only part of the press that is free.
        litTab.value = tabKey;

        // And so does the navigator, in the same handler: `props.onPress` is
        // what commits the next screen, and the tab the user asked for is the
        // one thing that must not wait on an animation. See the note above
        // {@link tabContentHoldMs} for what still does.
        props.onPress?.(ev);
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.pill, { backgroundColor: colors.surfaceMuted }, litStyle]}
      />
      <Animated.View pointerEvents="none" style={[styles.pill, styles.flash, flashStyle]}>
        <LinearGradient
          colors={[
            `${colors.tint}${FLASH_ALPHA_NONE}`,
            `${colors.tint}${FLASH_ALPHA}`,
            `${colors.tint}${FLASH_ALPHA_NONE}`,
          ]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View pointerEvents="box-none" style={[styles.content, pressStyle]}>
        {props.children}
      </Animated.View>
    </PlatformPressable>
  );
}

const styles = StyleSheet.create({
  iconBox: {
    // Both copies are absolutely filled, so the box has to state its own size.
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    // The bar's own label metrics, which `ThemedText`'s default type would
    // otherwise override with body-copy size and a 24pt line height.
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  content: {
    // The pressable lays its icon and label out in a centred column; this only
    // stands between them and it so the two can be scaled as one.
    alignItems: 'center',
  },
  pill: {
    position: 'absolute',
    // Inset all round so it reads as a shape behind the tab rather than as the
    // tab's own background, and clear of the bar's top border.
    top: 4,
    bottom: 4,
    left: 6,
    right: 6,
    borderRadius: 14,
    borderCurve: 'continuous',
  },
  flash: {
    // The gradient is a rectangle; the pill's corners have to cut it.
    overflow: 'hidden',
  },
});
