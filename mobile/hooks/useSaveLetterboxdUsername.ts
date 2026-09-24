/**
 * Saving the user's Letterboxd username.
 *
 * Shared by every place that asks for it — the feature tip and the prompt in
 * the filters modal — so they invalidate the same cache entry and report a
 * failure the same way. Invalidating `currentUser` is what flips the watchlist
 * filters on: the pages read `letterboxd_username` from it to decide whether
 * those filters do anything. The saved account is written into the cache first:
 * the backend looks the account up while saving, so it already carries the
 * picture and whether the account exists, which the intro shows straight away.
 */
import { Alert } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MeService } from "shared/client";

export function useSaveLetterboxdUsername() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (letterboxdUsername: string) =>
      MeService.updateUserMe({ requestBody: { letterboxd_username: letterboxdUsername } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["currentUser"], updated);
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    },
    onError: (error) => {
      console.error("Error saving Letterboxd username:", error);
      Alert.alert("Could not save", "Your Letterboxd username was not saved. Please try again.");
    },
  });
}
