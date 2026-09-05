import { Appearance, useColorScheme as useRNColorScheme } from 'react-native';
import { toScheme, useThemePreference, type Scheme } from '@/utils/theme-preference';

/**
 * The last system scheme the OS actually reported.
 *
 * `Appearance` answers `null` while the app is being restored or is on its way
 * to the background, and a null read must not be allowed to repaint the app —
 * that is a transition, not a theme change. So the last real answer is kept
 * and used whenever the current one is not a colour.
 *
 * Maintained from `Appearance`'s own listener rather than written inside
 * `useColorScheme` below. Assigning a module-level variable during render is a
 * side effect in the render phase: under concurrent rendering the render that
 * wrote it may be thrown away, two components in one commit can disagree
 * about the scheme depending on which rendered first, and the React Compiler
 * refuses to optimise any component whose hook does it — which here meant
 * every themed component in the app, since they all read their palette
 * through this.
 */
let lastKnownSystemScheme: Scheme = toScheme(Appearance.getColorScheme(), 'dark');
Appearance.addChangeListener(({ colorScheme }) => {
  lastKnownSystemScheme = toScheme(colorScheme, lastKnownSystemScheme);
});

/**
 * The scheme the app should paint itself in: the user's explicit preference if
 * they have one, otherwise the system's.
 *
 * `useRNColorScheme` is what makes this reactive — it subscribes, so a change
 * of system theme re-renders the caller. The cache above only decides what a
 * *non-answer* means.
 */
export function useColorScheme(): Scheme {
  const systemScheme = useRNColorScheme();
  const [preference] = useThemePreference();

  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return toScheme(systemScheme, lastKnownSystemScheme);
}
