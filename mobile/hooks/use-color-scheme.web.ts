/**
 * Custom mobile hook for Use color scheme web.
 */
import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  // Read flow: derive hook behavior first, then return the API consumed by callers.
  // Avoid hydration mismatches by waiting for client mount on web.
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  // Native/web color-scheme value from React Native.
  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  // Return the hook API that callers consume.
  return 'light';
}
