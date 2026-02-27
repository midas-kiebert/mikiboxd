import { Platform, type ViewStyle } from "react-native";

type GlowPalette = {
  green: { secondary: string };
  orange: { secondary: string };
};

const IOS_GLOW = {
  shadowOpacity: 0.2,
  shadowRadius: 7,
  shadowOffsetY: 2,
  elevation: 5,
} as const;

const DEFAULT_GLOW = {
  shadowOpacity: 0.46,
  shadowRadius: 14,
  shadowOffsetY: 6,
  elevation: 7,
} as const;

const createGlowStyle = (shadowColor: string): ViewStyle => {
  const glow = Platform.OS === "ios" ? IOS_GLOW : DEFAULT_GLOW;
  return {
    shadowColor,
    shadowOpacity: glow.shadowOpacity,
    shadowRadius: glow.shadowRadius,
    shadowOffset: { width: 0, height: glow.shadowOffsetY },
    elevation: glow.elevation,
  };
};

export const createShowtimeStatusGlowStyles = (colors: GlowPalette) => ({
  going: createGlowStyle(colors.green.secondary),
  interested: createGlowStyle(colors.orange.secondary),
});
