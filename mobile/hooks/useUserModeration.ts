/**
 * Blocking and reporting another user, behind one hook — the mobile half of
 * App Store Review guideline 1.2 (see backend/app/services/moderation.py for
 * why the two travel together).
 *
 * `["users"]` is invalidated on every mutation here because a block changes
 * three query shapes at once: search results (the blocked user disappears),
 * friend status (`is_blocked` flips) and the friends list (a blocked friend is
 * removed). Reporting invalidates the same key when it also blocks.
 */
import { Alert } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UsersService } from "shared";
import type { UserReportReason } from "shared";

export type UserModeration = {
  blockUser: (userId: string) => void;
  unblockUser: (userId: string) => void;
  reportUser: (params: {
    userId: string;
    reason: UserReportReason;
    message?: string;
    blockUser?: boolean;
  }) => void;
  /** True while any of the three is in flight — callers disable their controls on it. */
  isBusy: boolean;
};

export function useUserModeration(): UserModeration {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["users"] });
  };

  // Error toasts stay as native alerts, matching useFriendActions: these are
  // incidental failures, not decisions the user is asked to make.
  const reportError = (message: string) => (error: unknown) => {
    console.error(`${message}:`, error);
    Alert.alert("Error", `${message}.`);
  };

  const blockMutation = useMutation({
    mutationFn: (userId: string) => UsersService.blockUser({ userId }),
    onSuccess: invalidate,
    onError: reportError("Could not block this user"),
  });

  const unblockMutation = useMutation({
    mutationFn: (userId: string) => UsersService.unblockUser({ userId }),
    onSuccess: invalidate,
    onError: reportError("Could not unblock this user"),
  });

  const reportMutation = useMutation({
    mutationFn: (params: {
      userId: string;
      reason: UserReportReason;
      message?: string;
      blockUser?: boolean;
    }) =>
      UsersService.reportUser({
        userId: params.userId,
        requestBody: {
          reason: params.reason,
          message: params.message ?? null,
          block_user: params.blockUser ?? true,
        },
      }),
    onSuccess: invalidate,
    onError: reportError("Could not send this report"),
  });

  return {
    blockUser: (userId) => blockMutation.mutate(userId),
    unblockUser: (userId) => unblockMutation.mutate(userId),
    reportUser: (params) => reportMutation.mutate(params),
    isBusy: blockMutation.isPending || unblockMutation.isPending || reportMutation.isPending,
  };
}
