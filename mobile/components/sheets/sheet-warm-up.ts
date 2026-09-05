/**
 * Builds a sheet's node once at startup, so no open ever has to.
 *
 * The measured cost of opening a sheet is almost entirely whether its node
 * already exists. A sheet gorhom still has mounted animates from inside the
 * `requestAnimationFrame` that `present()` schedules — one frame. A sheet it
 * has to build first goes `present()` → `setState({mount: true})` → a commit
 * for the portal → the portal's own effect → another commit → the sheet tree
 * mounts and lays out → and only then does it move. On a mid-range Android that
 * was ~325ms with the JS thread completely idle: not work anyone can optimise
 * away, just a mount standing between the tap and the animation.
 *
 * So a sheet that would otherwise be built on first open is presented and
 * closed here instead, while it is invisible and its animations are
 * instantaneous. From then on it is a mounted, closed sheet like any other and
 * every open takes the one-frame path.
 *
 * ## Why this is also what fixes stacking
 *
 * @gorhom/portal's `addUpdatePortal` updates a portal in place and never
 * reorders one, so a sheet's z-order is fixed by *when it first registered* —
 * which used to mean the only way to get a sheet in front of the one it opens
 * from was a `dismissWhenClosed` flag (now gone) that rebuilt it on every open,
 * i.e. paid the ~325ms above every time. Warming registers the portals in a
 * known order instead, so the sheets that have to stack correctly can stay
 * mounted and be fast.
 *
 * That makes the *order* of these load-bearing, which is why they run through
 * one queue, one at a time, each finishing before the next begins: whoever
 * warms later draws in front. Warm-ups are enqueued from mount effects, and React
 * runs those in tree order — but note it runs a child's effects *before* its
 * parent's, so a sheet rendered inside another sheet's component must not be
 * warmed, or it would register first and end up behind.
 *
 * Every step waits on gorhom's own `onChange` rather than on a count of frames.
 * The first version guessed, and both guesses were wrong: `close()` landed
 * before the node it was closing had been built, and the sheet was made visible
 * again well before it had finished rising — so the sheets sat open and empty
 * on the launch screen.
 *
 * The caller must hide the sheet with `containerStyle`, **not** `style`: gorhom
 * composes its own animated style after the `style` prop and hard-sets
 * `opacity: 1` on it whenever the sheet is not at index -1, so `style` cannot
 * hide an open sheet — and a warm-up is an open sheet. That one cost a second
 * round of visible flashing at launch.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";

import { SHEET_OPEN_DURATION_MS } from "@/components/sheets/sheet-timing";

/** Warm-ups waiting to run, in the order they were asked for. */
const queue: ((release: () => void) => void)[] = [];
let isDraining = false;

/**
 * How long the queue will wait for one warm-up to report itself finished
 * before moving on without it.
 *
 * The per-warm-up timeout below cannot cover this, because it is armed *inside*
 * the drained callback: a warm-up that never starts — the frame it is waiting
 * for never arriving, the sheet ref still null, anything throwing on the way in
 * — has no timer of its own, and the queue is strictly one-at-a-time, so it
 * would hold every sheet behind it un-warmed for the rest of the session. For
 * `ShowtimeActionModal` that is not a slow first open but a dead one: it
 * refuses to present at all while it believes it is still warming, so the
 * symptom is a showtime sheet that never opens again. Generous enough never to
 * cut a real warm-up short, and it only ever runs at startup.
 */
const QUEUE_STALL_TIMEOUT_MS = 8000;

function drain(): void {
  const next = queue.shift();
  if (!next) {
    isDraining = false;
    return;
  }
  isDraining = true;
  let hasReleased = false;
  // Armed here rather than inside the callback below, and therefore outside
  // the frame it waits for: this is the backstop for a warm-up that never
  // begins, where the callback's own timeout would never be set at all.
  const stallTimer = setTimeout(() => {
    if (hasReleased) return;
    hasReleased = true;
    drain();
  }, QUEUE_STALL_TIMEOUT_MS);
  // On the next frame rather than right here. `release()` is called from
  // `finish()`, immediately after that sheet's own `setPhase("done")` — so
  // draining synchronously meant one sheet's state update reached straight
  // into the next sheet and called `present()` on it, and `present()` is a
  // `setState` of gorhom's. React warns about exactly that ("Can't perform a
  // React state update on a component that hasn't mounted yet"), and it is
  // right to: the update lands on a component in the middle of being mounted.
  //
  // A frame costs nothing here — this is startup work on invisible sheets with
  // their animations set to instant — and ordering is untouched, because the
  // queue is still FIFO and still runs strictly one at a time.
  requestAnimationFrame(() => {
    // Each warm-up finishes before the next one starts, so the portals register
    // in queue order rather than in whatever order their animations happen to
    // complete in.
    next(() => {
      if (hasReleased) return;
      hasReleased = true;
      clearTimeout(stallTimer);
      drain();
    });
  });
}

function enqueueWarmUp(warmUp: (release: () => void) => void): void {
  queue.push(warmUp);
  if (!isDraining) drain();
}

/**
 * Where a warm-up has got to. The sheet is kept invisible for everything except
 * `done`, and the caller must feed it `onSheetChange` until then — this runs on
 * gorhom's own signals rather than on a guess about how many frames a present
 * and a close take, which was wrong in both directions: `close()` landed before
 * the node it was closing existed, and the sheet was made visible again long
 * before it had finished rising.
 */
type WarmUpPhase = "presenting" | "closing" | "done";

/**
 * If gorhom never reports back, stop waiting: a sheet stuck mid-warm-up would
 * be invisible for the rest of the session, which is far worse than a slow
 * first open.
 */
const WARM_UP_TIMEOUT_MS = 3000;

/**
 * Present-and-close the sheet once, returning whether that is still happening
 * — the caller must keep it invisible and its animations instant until this
 * goes false, and route the sheet's `onChange` into `onSheetChange`.
 */
export function useSheetWarmUp(
  sheetRef: RefObject<BottomSheetModal | null>,
  enabled: boolean
): { isWarmingUp: boolean; onSheetChange: (index: number) => void } {
  const [phase, setPhase] = useState<WarmUpPhase>(enabled ? "presenting" : "done");
  /**
   * The phase, moved in the same tick as the decision that changes it.
   *
   * Emphatically not a render-phase mirror of the state above, which is what
   * this was. `onSheetChange` runs from gorhom's own `onChange`, and with the
   * warm-up's instant animations that can land in the same tick as the
   * `setPhase` before it — so the ref still said "presenting" when the close
   * reported `index === -1`, which matches *neither* branch below. The warm-up
   * then sat in "presenting" for good, and a sheet that believes it is still
   * warming never opens.
   */
  const phaseRef = useRef(phase);
  const releaseRef = useRef<(() => void) | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
  }, []);

  /** Moves the phase, ref first so nothing can read a stale one. */
  const advance = useCallback((next: WarmUpPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const finish = useCallback(() => {
    // Before anything else: a timer left running would fire minutes later and
    // `close()` a sheet the user had since opened for real.
    clearTimers();
    advance("done");
    releaseRef.current?.();
    releaseRef.current = null;
  }, [clearTimers, advance]);

  useEffect(() => {
    if (!enabled) return;
    let isCancelled = false;

    enqueueWarmUp((release) => {
      if (isCancelled) {
        release();
        return;
      }
      releaseRef.current = release;
      timersRef.current.push(
        setTimeout(() => {
          if (isCancelled) return;
          // Put the sheet away before giving up on it. Un-hiding a sheet that
          // never reported back could otherwise reveal one sitting wide open.
          sheetRef.current?.close();
          timersRef.current.push(
            setTimeout(() => {
              if (!isCancelled) finish();
            }, SHEET_OPEN_DURATION_MS + 60)
          );
        }, WARM_UP_TIMEOUT_MS)
      );
      sheetRef.current?.present();
    });

    return () => {
      isCancelled = true;
      clearTimers();
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, [enabled, sheetRef, finish, clearTimers]);

  const onSheetChange = useCallback(
    (index: number) => {
      if (phaseRef.current === "presenting" && index >= 0) {
        advance("closing");
        // Out of gorhom's own callback before driving it again.
        requestAnimationFrame(() => sheetRef.current?.close());
        return;
      }
      if (phaseRef.current === "closing" && index === -1) {
        finish();
      }
    },
    [sheetRef, finish, advance]
  );

  return { isWarmingUp: phase !== "done", onSheetChange };
}
