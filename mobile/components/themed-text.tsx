/**
 * Shared mobile UI component: Themed text.
 */
import {
  Platform,
  StyleSheet,
  Text,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: 'default' | 'title' | 'defaultSemiBold' | 'subtitle' | 'link';
};

const IOS_FONT_SCALE = 0.94;

const applyIosFontScale = (style: TextStyle): TextStyle => {
  if (Platform.OS !== 'ios') return style;

  return {
    ...style,
    fontSize:
      typeof style.fontSize === 'number'
        ? style.fontSize * IOS_FONT_SCALE
        : style.fontSize,
    lineHeight:
      typeof style.lineHeight === 'number'
        ? style.lineHeight * IOS_FONT_SCALE
        : style.lineHeight,
  };
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  ...rest
}: ThemedTextProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  // `useThemeColor` resolves explicit overrides first, then theme defaults.
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');
  const resolvedStyle = StyleSheet.flatten([
    { color },
    type === 'default' ? styles.default : undefined,
    type === 'title' ? styles.title : undefined,
    type === 'defaultSemiBold' ? styles.defaultSemiBold : undefined,
    type === 'subtitle' ? styles.subtitle : undefined,
    type === 'link' ? styles.link : undefined,
    style,
  ]);
  const finalStyle = resolvedStyle
    ? applyIosFontScale(resolvedStyle as TextStyle)
    : resolvedStyle;

  // Render/output using the state and derived values prepared above.
  return (
    <Text
      style={finalStyle}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {
    fontSize: 16,
    lineHeight: 24,
  },
  defaultSemiBold: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  link: {
    lineHeight: 30,
    fontSize: 16,
    color: '#0a7ea4',
  },
});
