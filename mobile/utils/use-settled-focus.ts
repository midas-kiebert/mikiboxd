/**
 * Whether this screen is the focused one, answered a beat late on purpose.
 *
 * `useIsFocused` subscribes to navigation state, so every screen that calls it
 * re-renders *inside the commit that switches tabs* — and the switch is only
 * on screen once that commit is done. On the tab screens here that is the
 * whole feed re-rendering, plus every query whose `enabled` is derived from it
 * dispatching a refetch and notifying every other mounted observer (see
 * `reference_query_notifications_rerender_other_screens`, the same fan-out
 * that cost the showtime sheet 400ms). All of it landed between the tap and
 * the tab appearing, with the *previous* tab still on display.
 *
 * None of that work has to be in the switch. The screen being switched to is
 * already mounted and already holds its last render; what focus actually gates
 * is whether its queries may run, which nothing sees until a frame later. So
 * this reports focus once the switch has been drawn instead of while it is
 * being computed: the navigator commits alone, the tab appears, and the
 * refetch follows it.
 *
 * Use `useIsFocused` instead wherever focus changes what is *drawn* — this
 * would show the wrong thing for a frame.
 */
import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import { useNavigation } from '@react-navigation/native';

/**
 * A backstop on the wait. `runAfterInteractions` only runs once every
 * interaction handle has been released, and a handle leaked anywhere in the app
 * would otherwise leave the focused tab's queries switched off for good — a
 * screen that never loads, which is far worse than the frame this is saving.
 * Whichever comes first wins.
 */
const SETTLE_TIMEOUT_MS = 200;

export function useSettledFocus(): boolean {
  const navigation = useNavigation();
  const [isFocused, setIsFocused] = useState(() => navigation.isFocused());

  useEffect(() => {
    let task: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cancel = () => {
      task?.cancel();
      task = null;
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const settle = (focused: boolean) => {
      cancel();
      const arrive = () => {
        cancel();
        setIsFocused(focused);
      };
      task = InteractionManager.runAfterInteractions(arrive);
      timer = setTimeout(arrive, SETTLE_TIMEOUT_MS);
    };

    const unsubscribeFocus = navigation.addListener('focus', () => settle(true));
    const unsubscribeBlur = navigation.addListener('blur', () => settle(false));

    // The listeners only report changes from here on, and the initial value was
    // read a render ago — a screen preloaded into the background, or focused
    // before this effect ran, would otherwise never hear about it.
    setIsFocused(navigation.isFocused());

    return () => {
      cancel();
      unsubscribeFocus();
      unsubscribeBlur();
    };
  }, [navigation]);

  return isFocused;
}
