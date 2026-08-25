/**
 * Shortcut to the Cineville pass, floated over the agenda and showtimes feeds:
 * one tap from opening the app, which is the point — the barcode is wanted while
 * standing at the door, not while digging through settings.
 *
 * It floats at the bottom of the tab rather than sitting in a row at the top,
 * because the top of a phone screen is the one place a thumb cannot reach while
 * the other hand is holding a ticket. Small and wordless on purpose: it sits on
 * top of a feed it must not compete with, and a barcode drawn at this size says
 * what it opens more compactly than any label could.
 *
 * Renders nothing until a card number has been saved, and nothing on a surface
 * the user has switched it off for in Settings.
 */
import { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import CinevilleCardModal from '@/components/cineville/CinevilleCardModal';
import { useThemeColors } from '@/hooks/use-theme-color';
import { useCinevilleCardDigits } from '@/utils/cineville-card';
import {
  useCinevilleShortcutEnabled,
  type CinevilleShortcutSurface,
} from '@/utils/cineville-shortcuts';
import { triggerSelectionHaptic } from '@/utils/long-press';

type CinevilleCardButtonProps = {
  /** Which feed this instance sits on, i.e. which Settings switch controls it. */
  surface: CinevilleShortcutSurface;
};

/** Round, so it reads as floating over the feed rather than as part of it. */
const BUTTON_SIZE = 44;
/**
 * Deliberately much larger a share of the button than a FAB icon usually is: the
 * bars are the whole message here, and the glyph's own drawing sits well inside
 * its em box, so a conventional icon size left the circle looking mostly empty.
 */
const ICON_SIZE = 30;

export default function CinevilleCardButton({ surface }: CinevilleCardButtonProps) {
  // Read flow: saved-card state first, then the returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const digits = useCinevilleCardDigits();
  const isEnabled = useCinevilleShortcutEnabled(surface);
  const [isModalVisible, setIsModalVisible] = useState(false);

  const handlePress = () => {
    triggerSelectionHaptic();
    setIsModalVisible(true);
  };

  // Render/output using the state and derived values prepared above.
  if (!digits || !isEnabled) return null;

  return (
    <>
      {/* Sits outside the flow so it stays put while the agenda scrolls under it. */}
      <View style={styles.anchor} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.button}
          onPress={handlePress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Show Cineville pass"
        >
          <MaterialCommunityIcons name="barcode" size={ICON_SIZE} color={colors.pillActiveText} />
        </TouchableOpacity>
      </View>
      <CinevilleCardModal
        visible={isModalVisible}
        digits={digits}
        onClose={() => setIsModalVisible(false)}
      />
    </>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    anchor: {
      position: 'absolute',
      // Inset past the cards' own 16pt margin: lining this up with the card
      // edges below read as a layout mistake rather than as something floating
      // over them.
      right: 26,
      bottom: 18,
      // The tab bar already clears the home indicator, so the button only has to
      // clear the tab bar — which it is laid out above.
      zIndex: 2,
    },
    button: {
      width: BUTTON_SIZE,
      height: BUTTON_SIZE,
      borderRadius: BUTTON_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.pillActiveBackground,
      // Lifted off the list it covers, rather than blending into it — but only
      // just, since it is meant to sit quietly over the feed.
      shadowColor: '#000000',
      shadowOpacity: 0.16,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
  });
