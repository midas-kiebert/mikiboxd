/**
 * The saved Cineville pass, for holding under the scanner at the door.
 *
 * A sheet rather than a full-screen modal so it can be flicked away one-handed
 * the moment the scanner beeps — the pass is opened and dismissed while holding
 * something else, which is the same reason the agenda's shortcut floats at the
 * bottom of the screen. The barcode sits on a white card whatever the app theme
 * is, and the screen is turned up to full brightness while the sheet is open —
 * a dimmed phone is the usual reason a scanner refuses to read a screen.
 */
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Brightness from 'expo-brightness';

import CinevilleBarcode from '@/components/cineville/CinevilleBarcode';
import AppBottomSheet from '@/components/sheets/AppBottomSheet';
import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/hooks/use-theme-color';
import { buildCinevilleBarcodeValue } from '@/utils/cineville-card';

const BARCODE_HEIGHT = 180;
const CARD_BACKGROUND = '#ffffff';
const CARD_TEXT_COLOR = '#000000';
const FULL_BRIGHTNESS = 1;
const FULL_HEIGHT_SNAP_POINTS = ['100%'];

type CinevilleCardModalProps = {
  visible: boolean;
  /** The saved card number, without its `CP$` prefix. */
  digits: string;
  onClose: () => void;
};

export default function CinevilleCardModal({
  visible,
  digits,
  onClose,
}: CinevilleCardModalProps) {
  // Read flow: brightness handling first, then the returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { bottom: bottomInset } = useSafeAreaInsets();
  // The brightness the phone was on before we turned it up, so closing puts it
  // back. Kept in a ref because restoring it must not re-render anything.
  const previousBrightness = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) return;

    let isCancelled = false;
    const raiseBrightness = async () => {
      try {
        const current = await Brightness.getBrightnessAsync();
        if (isCancelled) return;
        previousBrightness.current = current;
        await Brightness.setBrightnessAsync(FULL_BRIGHTNESS);
      } catch {
        // Brightness control is a nicety; a device that refuses it still shows
        // a perfectly readable barcode.
      }
    };
    void raiseBrightness();

    return () => {
      isCancelled = true;
      const restore = previousBrightness.current;
      previousBrightness.current = null;
      if (restore === null) return;
      void Brightness.setBrightnessAsync(restore).catch(() => {});
    };
  }, [visible]);

  const barcodeValue = buildCinevilleBarcodeValue(digits);

  // Render/output using the state and derived values prepared above.
  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title="Cineville pass"
      // One snap point, at the full height under the status bar: the pass wants
      // every pixel it can get, and there is no half-open state worth resting
      // in — a swipe down is only ever meant to close it.
      snapPoints={FULL_HEIGHT_SNAP_POINTS}
      // Nothing here is expensive to build, so the sheet is thrown away on close
      // to keep its portal slot fresh — it can be opened from a tab that has
      // other sheets of its own.
      dismissWhenClosed
    >
      <BottomSheetScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 24 }]}
      >
        <View style={styles.card}>
          <CinevilleBarcode value={barcodeValue} height={BARCODE_HEIGHT} />
          <ThemedText style={styles.cardNumber}>{barcodeValue}</ThemedText>
        </View>
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    // Centred rather than top-aligned: the barcode is the only thing on this
    // sheet, and it is held up to a scanner rather than read.
    content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 12, gap: 16 },
    card: {
      backgroundColor: CARD_BACKGROUND,
      borderRadius: 20,
      paddingVertical: 28,
      // Kept narrow on purpose: every point of padding is a point the barcode
      // cannot use, and the code carries its own quiet zones anyway.
      paddingHorizontal: 12,
      alignItems: 'center',
      gap: 20,
    },
    cardNumber: {
      color: CARD_TEXT_COLOR,
      fontSize: 18,
      lineHeight: 22,
      fontWeight: '600',
      letterSpacing: 2,
    },
    helperText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 8,
    },
  });
