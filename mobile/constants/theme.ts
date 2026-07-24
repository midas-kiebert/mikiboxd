/**
 * App color palette + font stacks. The colors now live in `shared/theme/colors.ts`
 * so the website can build matching Chakra tokens from the same source; this module
 * re-exports them (keeping every existing `@/constants/theme` import working) and
 * keeps the platform-aware `Fonts` here where React Native is available.
 */

import { Platform } from 'react-native';

// App-wide color tokens, shared with the website. See shared/theme/colors.ts.
export { Colors } from 'shared/theme/colors';

// Font stacks are platform-aware so text looks native on iOS/Android/Web.
export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
