import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MeService, ShowtimesService, type FriendGroupPublic } from "shared";
import { useFetchFriends } from "shared/hooks/useFetchFriends";

type VisibilityIndicator =
  | { kind: "none" }
  | { kind: "label"; label: string }
  | null;

type UseShowtimeVisibilityIndicatorProps = {
  showtimeId?: number | null;
  enabled?: boolean;
};

export const useShowtimeVisibilityIndicator = ({
  showtimeId,
  enabled = true,
}: UseShowtimeVisibilityIndicatorProps): VisibilityIndicator => {
  const isEnabled = enabled && typeof showtimeId === "number";
  const { data: friends = [] } = useFetchFriends({ enabled: isEnabled });

  const { data: showtimeVisibility } = useQuery({
    queryKey: ["showtimes", "visibility", showtimeId],
    enabled: isEnabled,
    queryFn: () =>
      ShowtimesService.getShowtimeVisibility({
        showtimeId: showtimeId as number,
      }),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });

  const { data: friendGroups = [] } = useQuery<FriendGroupPublic[], Error>({
    queryKey: ["friend-groups"],
    enabled: isEnabled,
    queryFn: () => MeService.getFriendGroups(),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    if (!showtimeVisibility) return null;
    if (showtimeVisibility.all_friends_selected) return null;

    const visibleFriendIds = showtimeVisibility.visible_friend_ids ?? [];
    const visibleGroupIds = showtimeVisibility.visible_group_ids ?? [];

    if (visibleFriendIds.length === 0 && visibleGroupIds.length === 0) {
      return { kind: "none" };
    }

    if (visibleGroupIds.length > 0) {
      const groupNameById = new Map(friendGroups.map((group) => [group.id, group.name] as const));
      const selectedGroupNames = visibleGroupIds
        .map((groupId) => groupNameById.get(groupId))
        .filter((name): name is string => Boolean(name));

      if (selectedGroupNames.length === 1) {
        return {
          kind: "label",
          label: selectedGroupNames[0],
        };
      }

      if (selectedGroupNames.length > 1) {
        return {
          kind: "label",
          label: `${selectedGroupNames[0]} +${selectedGroupNames.length - 1}`,
        };
      }
    }

    return {
      kind: "label",
      label: `${visibleFriendIds.length}/${friends.length}`,
    };
  }, [friendGroups, friends.length, showtimeVisibility]);
};
