/**
 * Shows the one-time notice a sign-in can leave behind — currently only "your
 * password was removed when this account was linked to Apple/Google".
 *
 * Mounted in the root layout rather than on a screen: the notice is set during
 * a sign-in, and the screen that set it unmounts on the navigation that
 * immediately follows. See `utils/sign-in-notice`.
 */
import { useCallback } from "react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import {
  clearSignInNotice,
  usePendingSignInNotice,
} from "@/utils/sign-in-notice";

const PROVIDER_LABEL = {
  apple: "Apple",
  google: "Google",
} as const;

export default function SignInNoticeHost() {
  const provider = usePendingSignInNotice();
  const dismiss = useCallback(() => clearSignInNotice(), []);

  if (!provider) return null;

  const label = PROVIDER_LABEL[provider];
  return (
    <ConfirmDialog
      visible
      icon="lock-reset"
      title={`Signing in with ${label} from now on`}
      message={`Your email address hadn't been confirmed yet, so we removed the password on this account — signing in with ${label} is what proves it's yours. You can set a new password in Settings whenever you like.`}
      confirmLabel="Got it"
      tone="primary"
      onConfirm={dismiss}
      onCancel={dismiss}
    />
  );
}
