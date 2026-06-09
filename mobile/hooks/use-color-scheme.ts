import { Appearance, useColorScheme as useRNColorScheme } from 'react-native';
import { useThemePreference } from '@/utils/theme-preference';

type Scheme = 'light' | 'dark';

let lastKnownSystemScheme: Scheme = Appearance.getColorScheme() ?? 'dark';

// Keep theme selection stable when React Native briefly reports `null` during transitions.
// Respects the user's explicit preference (light/dark/system).
export function useColorScheme(): Scheme {
  const systemScheme = useRNColorScheme();
  const [preference] = useThemePreference();

  if (systemScheme === 'light' || systemScheme === 'dark') {
    lastKnownSystemScheme = systemScheme;
  }

  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return lastKnownSystemScheme;
}
