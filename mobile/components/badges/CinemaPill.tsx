/**
 * Mobile badge component: Cinema Pill.
 */
import {
  StyleSheet,
  TouchableOpacity,
  type GestureResponderEvent,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import type { CinemaPublic, FestivalPublic } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useSingleFireNavigation } from "@/hooks/useSingleFireNavigation";
import { useInheritFiltersParams } from "@/hooks/usePageFilters";
import { useThemeColors } from "@/hooks/use-theme-color";
import { getCinemaColorPalette } from "@/utils/cinema-color";
import { FESTIVAL_TAG_TEXT, getCinemaPaletteKey } from "shared/cinemas/cinema-color";

type CinemaPillProps = {
  cinema: CinemaPublic;
  /**
   * The festival the screening is part of. Shown as a tag inside the pill,
   * after the cinema — unless the screening is placed at the festival itself
   * (its hall is unknown), where the cinema name already says it.
   */
  festival?: FestivalPublic | null;
  variant?: "compact" | "default";
  disabledIfSameId?: number;
  /**
   * Run just before navigating away. Callers that render this pill inside an
   * overlay pass their close handler: leaving the showtime sheet standing over
   * the cinema page the tap just opened hides the page the user asked for.
   */
  onNavigate?: () => void;
};

type VariantStyles = {
  container: ViewStyle;
  text: TextStyle;
};

const CINEMA_PILL_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;

export default function CinemaPill({
  cinema,
  festival,
  variant = "default",
  disabledIfSameId,
  onNavigate,
}: CinemaPillProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const router = useRouter();
  const inheritFiltersParams = useInheritFiltersParams();
  const goToCinemaShowtimes = useSingleFireNavigation((c: CinemaPublic) =>
    router.push({
      pathname: "/cinema-showtimes/[id]",
      params: {
        id: c.id.toString(),
        name: c.name,
        city: c.city.name,
        badgeBgColor: c.badge_bg_color,
        url: c.url,
        ...inheritFiltersParams,
      },
    })
  );
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Size variant keeps the same badge logic reusable in compact rows and full cards.
  const sizeStyles: VariantStyles =
    variant === "compact"
      ? {
          container: styles.compactContainer,
          text: styles.compactText,
        }
      : {
          container: styles.defaultContainer,
          text: styles.defaultText,
        };

  const cinemaPalette = getCinemaColorPalette(cinema, colors);
  const cinemaBackground = cinemaPalette.primary;
  const cinemaText = cinemaPalette.secondary;
  const shownFestival = festival && festival.id !== cinema.id ? festival : null;
  const festivalPalette = shownFestival
    ? getCinemaColorPalette(shownFestival, colors)
    : null;

  const isDisabled = disabledIfSameId !== undefined && cinema.id === disabledIfSameId;

  const handlePress = (event: GestureResponderEvent) => {
    if (isDisabled) return;
    event.stopPropagation();
    onNavigate?.();
    goToCinemaShowtimes(cinema);
  };

  // Render/output using the state and derived values prepared above.
  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.75}
      hitSlop={CINEMA_PILL_HIT_SLOP}
      style={[
        styles.container,
        sizeStyles.container,
        { backgroundColor: cinemaBackground, borderColor: cinemaText },
      ]}
    >
      <ThemedText
        style={[styles.text, sizeStyles.text, { color: cinemaText }]}
        numberOfLines={1}
      >
        {cinema.name}
      </ThemedText>
      {shownFestival && festivalPalette ? (
        <View
          style={[
            styles.festivalTag,
            variant === "compact" ? styles.festivalTagCompact : null,
            { backgroundColor: festivalPalette.secondary },
          ]}
        >
          <ThemedText
            style={[
              styles.text,
              sizeStyles.text,
              {
                color:
                  FESTIVAL_TAG_TEXT[getCinemaPaletteKey(shownFestival)] ??
                  festivalPalette.primary,
              },
            ]}
            numberOfLines={1}
          >
            {shownFestival.name}
          </ThemedText>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      borderWidth: 1,
      borderRadius: 3,
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      maxWidth: "65%",
      paddingHorizontal: 6,
    },
    // Neither part shrinks: squeezed, the cinema's name gave way first and
    // the pill read as just the festival, hiding where the screening is.
    text: {
      includeFontPadding: false,
      flexShrink: 0,
    },
    festivalTag: {
      marginLeft: 4,
      marginRight: -3,
      borderRadius: 2,
      paddingHorizontal: 3,
      flexShrink: 0,
      justifyContent: "center",
    },
    festivalTagCompact: {
      marginLeft: 3,
      marginRight: -2,
      paddingHorizontal: 2,
    },
    compactContainer: {
      borderRadius: 3,
      minHeight: 14,
      // A pixel more above than below: the name has no descenders, so centred
      // on its line box the ink sat high.
      paddingTop: 2,
      paddingBottom: 0,
      paddingHorizontal: 5,
    },
    compactText: {
      fontSize: 9,
      lineHeight: 10,
    },
    defaultContainer: {
      minHeight: 18,
      paddingTop: 2,
      paddingBottom: 0,
      paddingHorizontal: 6,
    },
    defaultText: {
      fontSize: 11,
      lineHeight: 12,
    },
  });
