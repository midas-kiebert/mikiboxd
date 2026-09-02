/**
 * Holds the screen at full brightness while `active`, easing in and out of it.
 *
 * Written for the Cineville pass, where a dimmed phone is the usual reason a
 * scanner refuses to read a screen. `setBrightnessAsync` moves the screen in
 * one step, and stepping from a dim room's brightness straight to full is a
 * flash in the face — so the value is written a frame at a time over a few
 * hundred milliseconds instead, and walked back down the same way on close,
 * under the sheet's own exit animation.
 *
 * A ramp interrupted half-way (the sheet reopened before the descent finished)
 * carries on from the brightness actually on screen rather than restarting from
 * where the last ramp began, so a quick close-and-reopen never jumps either.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Brightness from 'expo-brightness';

const FULL_BRIGHTNESS = 1;
const RAISE_DURATION_MS = 400;
const RESTORE_DURATION_MS = 300;
// 30fps: a brightness step this small is invisible, and halving the number of
// native round-trips keeps the ramp honest on slower devices.
const FRAME_MS = 1000 / 30;

type RampState = {
  /**
   * The last value written to the screen, or `null` when we are not driving the
   * brightness at all. Doubles as "is this ramp ours to continue".
   */
  written: number | null;
  /** Bumped by every new ramp; an older ramp seeing a change stops writing. */
  generation: number;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Ease in and out, so neither end of the ramp starts or stops abruptly. */
const smoothstep = (progress: number) => progress * progress * (3 - 2 * progress);

/**
 * Walks the screen brightness from `from` to `to` over `durationMs`, resolving
 * `true` once it lands and `false` if a newer ramp took over (or the device
 * refused the write) part-way.
 *
 * Progress is taken from the clock rather than counted in steps, so a device
 * that is slow to apply a write ends the ramp on time with fewer frames instead
 * of running long.
 */
async function rampBrightness(
  state: RampState,
  from: number,
  to: number,
  durationMs: number,
): Promise<boolean> {
  const generation = (state.generation += 1);
  const startedAt = Date.now();

  for (;;) {
    const progress = durationMs <= 0 ? 1 : Math.min(1, (Date.now() - startedAt) / durationMs);
    const value = from + (to - from) * smoothstep(progress);
    try {
      await Brightness.setBrightnessAsync(value);
    } catch {
      // Brightness control is a nicety; a device that refuses it still shows a
      // perfectly readable barcode.
      return false;
    }
    if (state.generation !== generation) return false;
    state.written = value;
    if (progress >= 1) return true;
    await wait(FRAME_MS);
    if (state.generation !== generation) return false;
  }
}

export function useFullBrightness(active: boolean) {
  const rampRef = useRef<RampState>({ written: null, generation: 0 });
  // The brightness the phone was on before we touched it, read once per boost.
  //
  // On iOS it is the exact value to put back, since `setBrightnessAsync` moves
  // the real system brightness there. On Android the call sets a window-level
  // override instead, and this number is on a different scale entirely — the
  // system setting's gamma-encoded slider position, or, under adaptive
  // brightness, the auto-brightness *offset* — so it is only ever used as the
  // approximate target the descent aims at. What ends the boost on Android is
  // dropping the override, which is the only thing that leaves the real system
  // brightness (and adaptive brightness) as the user had them.
  const brightnessBeforeBoost = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;

    const state = rampRef.current;
    let isCancelled = false;

    const raise = async () => {
      // Only read when we are not already driving the screen: mid-descent the
      // reading would be our own boost, and we would "restore" to full later.
      if (state.written === null) {
        try {
          brightnessBeforeBoost.current = await Brightness.getBrightnessAsync();
        } catch {
          brightnessBeforeBoost.current = null;
        }
      }
      if (isCancelled) return;
      // iOS with no reading is the one case we leave the screen alone: there the
      // only way back down is writing the old value, and we do not have it.
      // Anywhere else, land on full in one write rather than not at all — the
      // pass being readable matters more than the transition.
      const readBefore = brightnessBeforeBoost.current;
      if (Platform.OS === 'ios' && state.written === null && readBefore === null) return;
      const from = state.written ?? readBefore ?? FULL_BRIGHTNESS;
      await rampBrightness(state, from, FULL_BRIGHTNESS, RAISE_DURATION_MS);
    };
    void raise();

    return () => {
      isCancelled = true;
      const from = state.written;
      // Nothing was ever written, so there is nothing to walk back.
      if (from === null) return;
      const target = brightnessBeforeBoost.current;

      void (async () => {
        if (target !== null) {
          const landed = await rampBrightness(state, from, target, RESTORE_DURATION_MS);
          // A reopen took the screen back mid-descent; it owns the state now.
          if (!landed) return;
        }
        const generation = state.generation;
        if (Platform.OS !== 'ios') {
          await Brightness.restoreSystemBrightnessAsync().catch(() => {});
        }
        if (state.generation !== generation) return;
        state.written = null;
        brightnessBeforeBoost.current = null;
      })();
    };
  }, [active]);
}
