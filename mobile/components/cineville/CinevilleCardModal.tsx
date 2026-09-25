/**
 * The saved Cineville pass, for holding under the scanner at the door.
 *
 * A sheet rather than a full-screen modal so it can be flicked away one-handed
 * the moment the scanner beeps — the pass is opened and dismissed while holding
 * something else, which is the same reason the agenda's shortcut floats at the
 * bottom of the screen. The barcode sits on a white card whatever the app theme
 * is, and the screen is eased up to full brightness while the sheet is open —
 * a dimmed phone is the usual reason a scanner refuses to read a screen.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import CinevilleBarcode from '@/components/cineville/CinevilleBarcode';
import AppBottomSheet from '@/components/sheets/AppBottomSheet';
import { ThemedText } from '@/components/themed-text';
import { useFullBrightness } from '@/hooks/useFullBrightness';
import { useThemeColors } from '@/hooks/use-theme-color';
import { buildCinevilleBarcodeValue } from '@/utils/cineville-card';
import { triggerSelectionHaptic } from '@/utils/long-press';

const BARCODE_HEIGHT = 180;
const CARD_BACKGROUND = '#ffffff';
const CARD_TEXT_COLOR = '#000000';
const FULL_HEIGHT_SNAP_POINTS = ['100%'];
const COPIED_CONFIRMATION_MS = 1500;

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
  // Ramped rather than switched, both ways: this sheet is opened in a dark
  // cinema foyer as often as anywhere else.
  useFullBrightness(visible);

  const barcodeValue = buildCinevilleBarcodeValue(digits);

  const [didCopy, setDidCopy] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  // Only the digits, without the `CP$` prefix: this is for pasting into a
  // ticket site's Cineville field, which expects the number alone — the same
  // value the ticket-link auto-copy puts on the clipboard.
  const handleCopyDigits = async () => {
    triggerSelectionHaptic();
    await Clipboard.setStringAsync(digits);
    setDidCopy(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setDidCopy(false), COPIED_CONFIRMATION_MS);
  };

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
      // Nor is its content deferred: a barcode and a few lines cannot cost the
      // sheet its rise, and holding them back would only mean the pass — the
      // entire point of the sheet — shows up late.
      deferContent={false}
    >
      <BottomSheetScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 24 }]}
      >
        <View style={styles.card}>
          <CinevilleBarcode value={barcodeValue} height={BARCODE_HEIGHT} />
          <ThemedText style={styles.cardNumber}>{barcodeValue}</ThemedText>
        </View>
        <TouchableOpacity style={styles.copyButton} onPress={() => void handleCopyDigits()}>
          <MaterialIcons name={didCopy ? 'check' : 'content-copy'} size={16} color={colors.text} />
          <ThemedText style={styles.copyButtonText}>
            {didCopy ? 'Copied!' : 'Copy number'}
          </ThemedText>
        </TouchableOpacity>
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
    copyButton: {
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.pillBackground,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingVertical: 9,
      paddingHorizontal: 16,
      borderRadius: 8,
    },
    copyButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    helperText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 8,
    },
  });
