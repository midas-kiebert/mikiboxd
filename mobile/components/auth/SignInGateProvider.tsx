/**
 * One place to ask "does this need an account?", and one dialog to answer it.
 *
 * Guests can reach almost every screen, so an account-only affordance can be
 * tapped from anywhere — a sheet, a card, a list row, a settings toggle. Rather
 * than each of those learning to render its own prompt (and drift from the
 * others), they all call the same thing:
 *
 *     const { requireAccount } = useSignInGate();
 *     onPress={() => {
 *       if (!requireAccount("going")) return;
 *       ...do the account-only thing
 *     }}
 *
 * `requireAccount` returns true when there is an account and the caller should
 * carry on, and false when it has put the prompt up instead. Signed in, it is a
 * plain `true` and costs nothing, so it is safe to leave on a path that is
 * usually taken by signed-in users.
 *
 * Mounted at the root, above the navigator, so the dialog outlives the sheet or
 * screen the tap came from — several of those close themselves on press.
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "expo-router";

import SignInRequiredDialog from "@/components/auth/SignInRequiredDialog";
import type { AccountFeature } from "@/components/auth/account-features";
import { closeAllBlockingOverlays } from "@/utils/blocking-overlays";
import { useIsSignedIn } from "@/utils/auth-session";

type SignInGateContextValue = {
  /**
   * True when the caller may proceed. False means the sign-in prompt is now
   * showing and the caller must not run its action.
   */
  requireAccount: (feature: AccountFeature) => boolean;
  /** Opens the prompt outright, for a surface that is *only* an invitation to
   *  sign in (the panels on the account-only tabs) rather than an intercepted
   *  action. */
  promptForAccount: (feature: AccountFeature) => void;
};

const SignInGateContext = createContext<SignInGateContextValue>({
  requireAccount: () => true,
  promptForAccount: () => {},
});

export function useSignInGate() {
  return useContext(SignInGateContext);
}

export function SignInGateProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isSignedIn = useIsSignedIn();
  const [pendingFeature, setPendingFeature] = useState<AccountFeature | null>(null);

  const promptForAccount = useCallback((feature: AccountFeature) => {
    setPendingFeature(feature);
  }, []);

  const requireAccount = useCallback(
    (feature: AccountFeature) => {
      if (isSignedIn) return true;
      setPendingFeature(feature);
      return false;
    },
    [isSignedIn]
  );

  const dismiss = useCallback(() => setPendingFeature(null), []);

  const goToAuthScreen = useCallback(
    (path: "/signup" | "/login") => {
      setPendingFeature(null);
      // A showtime sheet is almost always what the tap came from, and it would
      // otherwise keep drawing over the auth screen this pushes.
      closeAllBlockingOverlays();
      router.push(path);
    },
    [router]
  );

  const value = useMemo<SignInGateContextValue>(
    () => ({ requireAccount, promptForAccount }),
    [requireAccount, promptForAccount]
  );

  return (
    <SignInGateContext.Provider value={value}>
      {children}
      <SignInRequiredDialog
        feature={pendingFeature}
        onSignUp={() => goToAuthScreen("/signup")}
        onLogIn={() => goToAuthScreen("/login")}
        onDismiss={dismiss}
      />
    </SignInGateContext.Provider>
  );
}
