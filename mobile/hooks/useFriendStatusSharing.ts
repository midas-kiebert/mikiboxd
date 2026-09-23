/**
 * The app's side of `shared/hooks/useFriendStatusSharing`: the same debounced,
 * one-at-a-time per-friend writes, with a native alert when one fails.
 */
import { Alert } from "react-native";
import {
  type FriendStatusSharing,
  useFriendStatusSharing as useSharedFriendStatusSharing,
} from "shared/hooks/useFriendStatusSharing";

export type { FriendStatusSharing };

const reportError = () =>
  Alert.alert("Error", "Could not update who can see your showtimes.");

export function useFriendStatusSharing(
  friendId: string,
  serverValue: boolean
): FriendStatusSharing {
  return useSharedFriendStatusSharing(friendId, serverValue, reportError);
}
