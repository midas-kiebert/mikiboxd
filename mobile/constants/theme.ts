/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#04c24a';

// App-wide color tokens consumed by themed UI helpers/components.
export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
    cardBackground: '#ffffff',
    cardBorder: '#f0f0f0',
    textSecondary: '#666666',
    searchBackground: '#f5f5f5',
    pillBackground: '#f5f5f5',
    pillText: '#666666',
    pillActiveBackground: tintColorLight,
    pillActiveText: '#ffffff',
    notificationBadge: '#c92a2a',
    divider: '#f0f0f0',
    posterPlaceholder: '#f0f0f0',
    pink: {
      primary: '#f8c9d8',
      secondary: '#7a1f3d',
    },
    purple: {
      primary: '#e2d6ff',
      secondary: '#4c2a8a',
    },
    green: {
      primary: '#cfe9d7',
      secondary: '#1f6b3a',
    },
    orange: {
      primary: '#ffd9b5',
      secondary: '#8a4a10',
    },
    yellow: {
      primary: '#fff1b8',
      secondary: '#7a5a00',
    },
    blue: {
      primary: '#dbe6ff',
      secondary: '#1d3fa8',
    },
    teal: {
      primary: '#d3f0df',
      secondary: '#116a4f',
    },
    red: {
      primary: '#ffd1d1',
      secondary: '#8a1c1c',
    },
    cyan: {
      primary: '#d5f4ff',
      secondary: '#0a6f99',
    },
    friendGoing: {
      primary: '#e3f6ec',
      secondary: '#0b7f56',
    },
    friendInterested: {
      primary: '#fff0e0',
      secondary: '#a95708',
    },
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
    cardBackground: '#1c1c1c',
    cardBorder: '#3a3a3a',
    textSecondary: '#9BA1A6',
    searchBackground: '#2a2a2a',
    pillBackground: '#2a2a2a',
    pillText: '#9BA1A6',
    pillActiveBackground: tintColorDark,
    pillActiveText: '#151718',
    notificationBadge: '#d63a3a',
    divider: '#3a3a3a',
    posterPlaceholder: '#3a3a3a',
    pink: {
      primary: '#5a1e33',
      secondary: '#f6b7cf',
    },
    purple: {
      primary: '#3f2a6b',
      secondary: '#d8ccff',
    },
    green: {
      primary: '#1f4d34',
      secondary: '#bfe5c7',
    },
    orange: {
      primary: '#6b3a12',
      secondary: '#ffd1a6',
    },
    yellow: {
      primary: '#6b5a12',
      secondary: '#ffeaa1',
    },
    blue: {
      primary: '#1b2f63',
      secondary: '#c8d8ff',
    },
    teal: {
      primary: '#143e34',
      secondary: '#a9e8c8',
    },
    red: {
      primary: '#5a1c1c',
      secondary: '#ffb8b8',
    },
    cyan: {
      primary: '#0f3f51',
      secondary: '#9fe8ff',
    },
    friendGoing: {
      primary: '#173b2b',
      secondary: '#7fddb6',
    },
    friendInterested: {
      primary: '#4e3015',
      secondary: '#ffc590',
    },
  },
};

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
