/**
 * The five friendship mutations (send/accept/decline/cancel a request, remove a
 * friend) behind one hook, so every place that offers these actions — the
 * Friends tab rows, the inline controls in a showtime's invite list — shares the
 * same cache invalidation and error handling instead of redeclaring them.
 */
import { Alert } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FriendsService } from "shared";
import type {
  FriendsAcceptFriendRequestData,
  FriendsCancelFriendRequestData,
  FriendsDeclineFriendRequestData,
  FriendsRemoveFriendData,
  FriendsSendFriendRequestData,
} from "shared";

export type FriendActions = {
  sendRequest: (receiverId: string) => void;
  acceptRequest: (senderId: string) => void;
  declineRequest: (senderId: string) => void;
  cancelRequest: (receiverId: string) => void;
  removeFriend: (friendId: string) => void;
  /** True while any of the five is in flight — callers disable their controls on it. */
  isBusy: boolean;
};

export function useFriendActions(): FriendActions {
  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["users"] });
  };

  // Error toasts stay as native alerts on purpose: they are incidental failures,
  // not decisions the user is asked to make.
  const reportError = (message: string) => (error: unknown) => {
    console.error(`${message}:`, error);
    Alert.alert("Error", `${message}.`);
  };

  const sendFriendRequestMutation = useMutation({
    mutationFn: (data: FriendsSendFriendRequestData) => FriendsService.sendFriendRequest(data),
    onSuccess: invalidate,
    onError: reportError("Could not send friend request"),
  });

  const acceptFriendRequestMutation = useMutation({
    mutationFn: (data: FriendsAcceptFriendRequestData) => FriendsService.acceptFriendRequest(data),
    onSuccess: invalidate,
    onError: reportError("Could not accept friend request"),
  });

  const declineFriendRequestMutation = useMutation({
    mutationFn: (data: FriendsDeclineFriendRequestData) =>
      FriendsService.declineFriendRequest(data),
    onSuccess: invalidate,
    onError: reportError("Could not decline friend request"),
  });

  const cancelFriendRequestMutation = useMutation({
    mutationFn: (data: FriendsCancelFriendRequestData) => FriendsService.cancelFriendRequest(data),
    onSuccess: invalidate,
    onError: reportError("Could not cancel friend request"),
  });

  const removeFriendMutation = useMutation({
    mutationFn: (data: FriendsRemoveFriendData) => FriendsService.removeFriend(data),
    onSuccess: invalidate,
    onError: reportError("Could not remove friend"),
  });

  return {
    sendRequest: (receiverId) => sendFriendRequestMutation.mutate({ receiverId }),
    acceptRequest: (senderId) => acceptFriendRequestMutation.mutate({ senderId }),
    declineRequest: (senderId) => declineFriendRequestMutation.mutate({ senderId }),
    cancelRequest: (receiverId) => cancelFriendRequestMutation.mutate({ receiverId }),
    removeFriend: (friendId) => removeFriendMutation.mutate({ friendId }),
    isBusy:
      sendFriendRequestMutation.isPending ||
      acceptFriendRequestMutation.isPending ||
      declineFriendRequestMutation.isPending ||
      cancelFriendRequestMutation.isPending ||
      removeFriendMutation.isPending,
  };
}
