/**
 * Draws a Code 128 barcode as SVG, sized to the width it is given.
 *
 * The colors are deliberately not themed: a scanner reads contrast, not taste,
 * so the bars stay black on white in dark mode too.
 */
import { useMemo, useState } from 'react';
import { type LayoutChangeEvent, PixelRatio, StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { encodeCode128 } from '@/utils/code128';

const BAR_COLOR = '#000000';
const BACKGROUND_COLOR = '#ffffff';

/** Blank margin Code 128 requires on both sides for a scanner to find the code. */
const QUIET_ZONE_MODULES = 10;

/**
 * Bars are snapped to whole *device* pixels so they stay crisp. Snapping to whole
 * layout points instead wastes most of the width: a 165-module code across ~318pt
 * wants 1.9pt per module and would floor to 1pt, drawing the barcode at little
 * over half the space it has. One device pixel per module is the floor — below
 * that the code stops being scannable, even if it means overflowing a very narrow
 * container.
 */
const MIN_MODULE_WIDTH_DEVICE_PIXELS = 1;

type CinevilleBarcodeProps = {
  /** The string to encode, e.g. `CP$123456789`. */
  value: string;
  height: number;
};

export default function CinevilleBarcode({ value, height }: CinevilleBarcodeProps) {
  // Read flow: measure the container, then lay the encoded bars out inside it.
  const [availableWidth, setAvailableWidth] = useState(0);
  const encoding = useMemo(() => encodeCode128(value), [value]);

  const handleLayout = (event: LayoutChangeEvent) => {
    setAvailableWidth(event.nativeEvent.layout.width);
  };

  const moduleCount = encoding.totalModules + QUIET_ZONE_MODULES * 2;
  const devicePixelRatio = PixelRatio.get();
  const moduleWidthInDevicePixels = Math.max(
    MIN_MODULE_WIDTH_DEVICE_PIXELS,
    Math.floor((availableWidth * devicePixelRatio) / moduleCount),
  );
  const moduleWidth = moduleWidthInDevicePixels / devicePixelRatio;
  const width = moduleCount * moduleWidth;

  // Every other element is a bar, starting with the first.
  const bars = useMemo(() => {
    const result: { x: number; width: number }[] = [];
    let moduleOffset = QUIET_ZONE_MODULES;
    for (let index = 0; index < encoding.elementWidths.length; index++) {
      const elementWidth = encoding.elementWidths[index];
      if (index % 2 === 0) {
        result.push({ x: moduleOffset, width: elementWidth });
      }
      moduleOffset += elementWidth;
    }
    return result;
  }, [encoding]);

  return (
    <View style={styles.container} onLayout={handleLayout}>
      {availableWidth > 0 ? (
        <Svg width={width} height={height}>
          <Rect x={0} y={0} width={width} height={height} fill={BACKGROUND_COLOR} />
          {bars.map((bar) => (
            <Rect
              key={bar.x}
              x={bar.x * moduleWidth}
              y={0}
              width={bar.width * moduleWidth}
              height={height}
              fill={BAR_COLOR}
            />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
});
