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
  enabled = false,
}: UseShowtimeVisibilityIndicatorProps): VisibilityIndicator => {
  const hasShowtimeId = typeof showtimeId === "number";
  const isVisibilityQueryEnabled = enabled && hasShowtimeId;
  const { data: friends = [] } = useFetchFriends({ enabled: hasShowtimeId });

  const { data: showtimeVisibility } = useQuery({
    queryKey: ["showtimes", "visibility", showtimeId],
    enabled: isVisibilityQueryEnabled,
    queryFn: () =>
      ShowtimesService.getShowtimeVisibility({
        showtimeId: showtimeId as number,
      }),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  const { data: friendGroups = [] } = useQuery<FriendGroupPublic[], Error>({
    queryKey: ["friend-groups"],
    enabled: hasShowtimeId,
    queryFn: () => MeService.getFriendGroups(),
    staleTime: 60 * 1000,
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
