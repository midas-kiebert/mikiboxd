/**
 * The frame every auth screen (log in, sign up, pick a username) sits in.
 *
 * Exists so the three of them cannot drift: this is the first thing anyone sees
 * of the app, and a title that is two points bigger on one screen than the next,
 * or a form that sits eight pixels further left, reads as sloppy long before
 * anyone can say why.
 *
 * It also owns the error banner, which is the one thing on these screens that
 * appears and disappears under the user: it is tweened in rather than inserted,
 * so a failed login does not shunt the whole form up a line.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Dimensions, Image, Keyboard, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useLayoutAnimatedValue } from "@/hooks/useLayoutAnimatedValue";

type AuthScrollContextValue = {
  /** Scrolls the focused field above the keyboard; a no-op on iOS, which
   * already gets this from `automaticallyAdjustKeyboardInsets` below. */
  scrollToFocusedInput: (fieldRef: RefObject<View | null>) => void;
};

const AuthScrollContext = createContext<AuthScrollContextValue | null>(null);

/** Lets `AuthTextField` ask the enclosing shell to bring it into view on focus. */
export function useAuthScroll() {
  return useContext(AuthScrollContext);
}

// Matches `styles.content.paddingVertical` below — kept as a constant rather
// than read off the StyleSheet object, since `StyleSheet.create` can return
// an opaque numeric id for its styles rather than the plain object.
const CONTENT_VERTICAL_PADDING = 18;

type AuthScreenShellProps = {
  title: string;
  subtitle?: string;
  /** Server-side failure for the whole screen; field errors live on the fields. */
  error?: string | null;
  /** The form itself. */
  children: ReactNode;
  /** Links and secondary actions, pinned below the form. */
  footer?: ReactNode;
};

export default function AuthScreenShell({
  title,
  subtitle,
  error,
  children,
  footer,
}: AuthScreenShellProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Tweens the banner in and out instead of inserting it under the user.
  const visibleError = useLayoutAnimatedValue(error ?? null);
  const scrollViewRef = useRef<ScrollView>(null);
  // Tracked by hand because we need "how far have we already scrolled" to
  // turn a field's on-screen position into a scrollTo offset.
  const scrollOffsetRef = useRef(0);
  // The field most recently focused; re-read once the keyboard height below
  // is actually known, since focus can fire before `keyboardDidShow` does.
  const pendingFieldRef = useRef<RefObject<View | null> | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // The padding below is driven off this, not `keyboardHeight` directly, and
  // only ever grows: shrinking it back down when the keyboard closes was
  // what caused the scroll offset to clamp abruptly, including when the
  // keyboard closed because the user scrolled it away rather than dismissing
  // it directly. Simpler to just always leave the room to scroll into once
  // the keyboard has been seen at all, at the cost of some empty space below
  // the form when the keyboard is closed.
  const [scrollPadding, setScrollPadding] = useState(0);

  // Android has `edgeToEdgeEnabled` on (app.json), which disables the classic
  // adjustResize window-resize the ScrollView here used to rely on — the
  // window never shrinks, so the ScrollView never gains the extra scroll
  // range a resize would have given it, and a `scrollTo` past the content's
  // natural height just clamps back to 0. Tracking the keyboard's own height
  // and padding the content by that much gives the ScrollView real room to
  // scroll into. `automaticallyAdjustKeyboardInsets` gets iOS this for free.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const showSubscription = Keyboard.addListener("keyboardDidShow", (keyboardEvent) => {
      const height = keyboardEvent.endCoordinates.height;
      setKeyboardHeight(height);
      setScrollPadding((current) => Math.max(current, height));
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // `measureLayout`/`UIManager.measureLayout` are both off the table under
  // the New Architecture (`newArchEnabled` in app.json) — they throw at
  // runtime. `.measure()` (page coordinates) is still supported, so the
  // scroll offset is computed by hand instead of asking the ScrollView to
  // do it via a relative measurement.
  //
  // Measuring is deferred a beat: the extra bottom padding that gives the
  // ScrollView room to scroll into is itself a state update, and measuring
  // the field before that padding has actually been laid out on the native
  // side under-scrolls it (using the field's pre-padding position).
  const scrollFieldIntoView = (fieldRef: RefObject<View | null>) => {
    setTimeout(() => {
      fieldRef.current?.measure((_x, _y, _width, fieldHeight, _pageX, pageY) => {
        const screenHeight = Dimensions.get("window").height;
        // Generous margin: Android's own suggestion/autofill strip sits on
        // top of the keyboard proper and isn't part of `endCoordinates.height`.
        const visibleBottom = screenHeight - keyboardHeight - 56;
        const fieldBottom = pageY + fieldHeight;
        if (fieldBottom <= visibleBottom) return;
        const targetOffset = scrollOffsetRef.current + (fieldBottom - visibleBottom);
        scrollViewRef.current?.scrollTo({ y: Math.max(targetOffset, 0), animated: true });
      });
    }, 100);
  };

  const scrollToFocusedInput = (fieldRef: RefObject<View | null>) => {
    pendingFieldRef.current = fieldRef;
    // If the keyboard is already up (switching between fields), scroll now;
    // otherwise wait for the `keyboardHeight` effect below, once it's known.
    if (keyboardHeight > 0) scrollFieldIntoView(fieldRef);
  };

  useEffect(() => {
    if (keyboardHeight > 0 && pendingFieldRef.current) {
      scrollFieldIntoView(pendingFieldRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboardHeight]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={[
          styles.content,
          scrollPadding > 0 && { paddingBottom: CONTENT_VERTICAL_PADDING + scrollPadding },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        showsVerticalScrollIndicator={false}
        onScroll={(event) => {
          scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        <View style={styles.header}>
          {/* The same mark the splash shows, so the hand-off from launch to
              this screen is the same logo rather than a second one. */}
          <Image
            source={require("../../assets/images/splash-icon.png")}
            style={styles.brandMark}
            resizeMode="contain"
          />
          <ThemedText style={styles.title}>{title}</ThemedText>
          {subtitle ? <ThemedText style={styles.subtitle}>{subtitle}</ThemedText> : null}
        </View>

        {visibleError ? (
          <View style={styles.errorBanner}>
            <MaterialIcons name="error-outline" size={18} color={colors.red.secondary} />
            <ThemedText style={styles.errorText}>{visibleError}</ThemedText>
          </View>
        ) : null}

        <AuthScrollContext.Provider value={{ scrollToFocusedInput }}>
          {children}
        </AuthScrollContext.Provider>

        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      // flexGrow (not flex) so the form still centres when it fits, but the
      // ScrollView can grow past the viewport when it doesn't.
      flexGrow: 1,
      justifyContent: "center",
      paddingHorizontal: 24,
      paddingVertical: CONTENT_VERTICAL_PADDING,
    },
    // Sized to leave the form itself on screen: the sign-up form is four fields
    // and two provider buttons, and a header that took a third of the viewport
    // pushed the thing the user actually came here to do below the fold.
    header: {
      alignItems: "center",
      gap: 6,
      paddingBottom: 16,
    },
    brandMark: {
      width: 60,
      height: 60,
    },
    title: {
      fontSize: 24,
      lineHeight: 30,
      fontWeight: "800",
      textAlign: "center",
      color: colors.text,
    },
    subtitle: {
      fontSize: 14,
      lineHeight: 19,
      textAlign: "center",
      color: colors.textSecondary,
    },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.red.primary,
      borderWidth: 1,
      borderColor: colors.red.secondary,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 9,
      marginBottom: 12,
    },
    errorText: {
      flex: 1,
      color: colors.red.secondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
    },
    footer: {
      paddingTop: 14,
      gap: 12,
    },
  });
