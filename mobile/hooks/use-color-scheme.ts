/**
 * Custom mobile hook for Use color scheme.
 */
import { Appearance, useColorScheme as useRNColorScheme } from 'react-native';

type Scheme = 'light' | 'dark';

let lastKnownScheme: Scheme = Appearance.getColorScheme() ?? 'light';

// Keep theme selection stable when React Native briefly reports `null` during transitions.
export function useColorScheme(): Scheme {
  const scheme = useRNColorScheme();
  if (scheme === 'light' || scheme === 'dark') {
    lastKnownScheme = scheme;
    return scheme;
  }
  return lastKnownScheme;
}
