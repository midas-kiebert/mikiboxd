/**
 * A person's circle: their avatar when they have one linked and
 * synced, a colored initial otherwise — and always the initial underneath,
 * so a picture that fails to load falls back to it rather than leaving a
 * blank circle. Mirrors `frontend/src/components/Showtimes/detail/PersonAvatar.tsx`,
 * the same pattern for the web app.
 */
import { useState } from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { getAvatarSources } from "shared/users/avatar-sources";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { getAvatarColors, getAvatarInitial } from "@/utils/avatar-color";

type PersonAvatarProps = {
  /** Drives the avatar tint, so a person keeps their color across the app. */
  userId: string;
  name: string;
  avatarUrl?: string | null;
  size: number;
  fontSize: number;
  style?: StyleProp<ViewStyle>;
};

export default function PersonAvatar({
  userId,
  name,
  avatarUrl,
  size,
  fontSize,
  style,
}: PersonAvatarProps) {
  const colors = useThemeColors();
  const avatarColors = getAvatarColors(userId, colors);
  // A bigger render first when drawn large, then the stored one; a source
  // that fails is skipped for good, and none left means the initial.
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const photo = getAvatarSources(avatarUrl, size).find((src) => !failed.has(src));

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: avatarColors.primary,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        },
        style,
      ]}
    >
      {/* The line height must follow the font size: ThemedText's default
          24pt line box pushes a large letter up and clips its top half. */}
      <ThemedText
        style={{
          fontSize,
          lineHeight: Math.round(fontSize * 1.2),
          fontWeight: "700",
          textAlign: "center",
          includeFontPadding: false,
          color: avatarColors.secondary,
        }}
      >
        {getAvatarInitial(name)}
      </ThemedText>
      {photo ? (
        <Image
          key={photo}
          source={{ uri: photo }}
          style={StyleSheet.absoluteFill}
          onError={() => setFailed((current) => new Set(current).add(photo))}
        />
      ) : null}
    </View>
  );
}
