import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  type ListRenderItem,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MeService,
  type FriendGroupCreate,
  type FriendGroupPublic,
} from 'shared';
import { useFetchFriends } from 'shared/hooks/useFetchFriends';

import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/hooks/use-theme-color';

type FriendGroupsPage = 'selection' | 'groups';

const sortFriendIds = (friendIds: Iterable<string>) => Array.from(new Set(friendIds)).sort((a, b) => a.localeCompare(b));

export default function FriendGroupsScreen() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const [page, setPage] = useState<FriendGroupsPage>('selection');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');
  const [groupError, setGroupError] = useState<string | null>(null);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [isSaveDialogVisible, setIsSaveDialogVisible] = useState(false);

  const groupsQueryKey = useMemo(() => ['friend-groups'] as const, []);
  const { data: friends = [], isFetching: isFetchingFriends } = useFetchFriends();
  const { data: groups = [], isLoading: isLoadingGroups } = useQuery({
    queryKey: groupsQueryKey,
    queryFn: () => MeService.getFriendGroups(),
  });

  const friendNameById = useMemo(
    () =>
      new Map(
        friends.map((friend) => [friend.id, friend.display_name?.trim() || 'Friend'] as const)
      ),
    [friends]
  );

  const filteredFriends = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return friends
      .map((friend) => ({
        id: friend.id,
        label: friend.display_name?.trim() || 'Friend',
      }))
      .filter((friend) =>
        normalizedQuery ? friend.label.toLowerCase().includes(normalizedQuery) : true
      )
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [friends, searchQuery]);

  const selectedCount = selectedFriendIds.size;
  const allFriendIds = useMemo(() => friends.map((friend) => friend.id), [friends]);
  const allSelected =
    allFriendIds.length > 0 && allFriendIds.every((friendId) => selectedFriendIds.has(friendId));

  const saveGroupMutation = useMutation({
    mutationFn: (requestBody: FriendGroupCreate) => MeService.saveFriendGroup({ requestBody }),
    onSuccess: (savedGroup) => {
      setGroupError(null);
      setGroupName('');
      setSaveAsDefault(false);
      setIsSaveDialogVisible(false);
      setSelectedFriendIds(new Set(savedGroup.friend_ids));
      setPage('groups');
      queryClient.invalidateQueries({ queryKey: groupsQueryKey });
      queryClient.invalidateQueries({ queryKey: ['showtimes'] });
      queryClient.invalidateQueries({ queryKey: ['movie'] });
      queryClient.invalidateQueries({ queryKey: ['movies'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => {
      console.error('Error saving friend group:', error);
      setGroupError('Could not save group. Please try again.');
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (groupId: string) => MeService.deleteFriendGroup({ groupId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupsQueryKey });
      queryClient.invalidateQueries({ queryKey: ['showtimes'] });
      queryClient.invalidateQueries({ queryKey: ['movie'] });
      queryClient.invalidateQueries({ queryKey: ['movies'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const setDefaultGroupMutation = useMutation({
    mutationFn: (groupId: string) => MeService.setFavoriteFriendGroup({ groupId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupsQueryKey });
      queryClient.invalidateQueries({ queryKey: ['showtimes'] });
      queryClient.invalidateQueries({ queryKey: ['movie'] });
      queryClient.invalidateQueries({ queryKey: ['movies'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const clearDefaultGroupMutation = useMutation({
    mutationFn: () => MeService.clearFavoriteFriendGroup(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupsQueryKey });
      queryClient.invalidateQueries({ queryKey: ['showtimes'] });
      queryClient.invalidateQueries({ queryKey: ['movie'] });
      queryClient.invalidateQueries({ queryKey: ['movies'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const handleToggleFriend = useCallback((friendId: string) => {
    setSelectedFriendIds((current) => {
      const next = new Set(current);
      if (next.has(friendId)) {
        next.delete(friendId);
      } else {
        next.add(friendId);
      }
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setSelectedFriendIds((current) => {
      const isAllSelected = allFriendIds.length > 0 && allFriendIds.every((friendId) => current.has(friendId));
      if (isAllSelected) return new Set<string>();
      return new Set(allFriendIds);
    });
  }, [allFriendIds]);

  const handleApplyGroup = useCallback((group: FriendGroupPublic) => {
    setSelectedFriendIds(new Set(group.friend_ids));
    setPage('selection');
  }, []);

  const handleDeleteGroup = useCallback(
    (group: FriendGroupPublic) => {
      Alert.alert(
        'Delete group?',
        `Are you sure you want to delete "${group.name}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              deleteGroupMutation.mutate(group.id);
            },
          },
        ],
        { cancelable: true }
      );
    },
    [deleteGroupMutation]
  );

  const handleToggleDefaultGroup = useCallback(
    (group: FriendGroupPublic) => {
      if (group.is_favorite) {
        clearDefaultGroupMutation.mutate();
        return;
      }
      setDefaultGroupMutation.mutate(group.id);
    },
    [clearDefaultGroupMutation, setDefaultGroupMutation]
  );

  const handleOpenSaveDialog = useCallback(() => {
    setGroupName('');
    setGroupError(null);
    setSaveAsDefault(false);
    setIsSaveDialogVisible(true);
  }, []);

  const handleCloseSaveDialog = useCallback(() => {
    if (saveGroupMutation.isPending) return;
    setIsSaveDialogVisible(false);
    setGroupError(null);
  }, [saveGroupMutation.isPending]);

  const handleSaveGroup = useCallback(() => {
    const trimmedName = groupName.trim();
    if (!trimmedName) {
      setGroupError('Enter a group name.');
      return;
    }

    saveGroupMutation.mutate({
      name: trimmedName,
      friend_ids: sortFriendIds(selectedFriendIds),
      is_favorite: saveAsDefault,
    });
  }, [groupName, saveAsDefault, saveGroupMutation, selectedFriendIds]);

  const renderFriend: ListRenderItem<{ id: string; label: string }> = useCallback(
    ({ item }) => {
      const selected = selectedFriendIds.has(item.id);
      return (
        <TouchableOpacity
          style={[styles.friendRow, selected && styles.friendRowSelected]}
          onPress={() => handleToggleFriend(item.id)}
          activeOpacity={0.8}
        >
          <ThemedText style={styles.friendName}>{item.label}</ThemedText>
          <MaterialIcons
            name={selected ? 'check-box' : 'check-box-outline-blank'}
            size={20}
            color={selected ? colors.tint : colors.textSecondary}
          />
        </TouchableOpacity>
      );
    },
    [colors.textSecondary, colors.tint, handleToggleFriend, selectedFriendIds, styles.friendName, styles.friendRow, styles.friendRowSelected]
  );

  const renderGroup: ListRenderItem<FriendGroupPublic> = useCallback(
    ({ item }) => {
      const memberPreview = item.friend_ids
        .slice(0, 3)
        .map((friendId) => friendNameById.get(friendId))
        .filter(Boolean)
        .join(', ');

      return (
        <TouchableOpacity
          style={styles.groupCard}
          onPress={() => handleApplyGroup(item)}
          activeOpacity={0.85}
        >
          <View style={styles.groupHeaderRow}>
            <View style={styles.groupTitleWrap}>
              <ThemedText style={styles.groupName}>{item.name}</ThemedText>
              <ThemedText style={styles.groupMeta}>
                {item.friend_ids.length} friend{item.friend_ids.length === 1 ? '' : 's'}
              </ThemedText>
              {memberPreview ? (
                <ThemedText style={styles.groupPreview} numberOfLines={1}>
                  {memberPreview}
                </ThemedText>
              ) : null}
            </View>
            <View style={styles.groupActions}>
              <TouchableOpacity
                style={styles.groupActionButton}
                onPress={(event) => {
                  event.stopPropagation();
                  handleToggleDefaultGroup(item);
                }}
                activeOpacity={0.8}
                disabled={setDefaultGroupMutation.isPending || clearDefaultGroupMutation.isPending}
              >
                <MaterialIcons
                  name={item.is_favorite ? 'star' : 'star-border'}
                  size={17}
                  color={item.is_favorite ? colors.yellow.secondary : colors.textSecondary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.groupActionButton}
                onPress={(event) => {
                  event.stopPropagation();
                  handleDeleteGroup(item);
                }}
                activeOpacity={0.8}
                disabled={deleteGroupMutation.isPending}
              >
                <MaterialIcons name="delete-outline" size={17} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [
      clearDefaultGroupMutation.isPending,
      colors.textSecondary,
      colors.yellow.secondary,
      deleteGroupMutation.isPending,
      friendNameById,
      handleApplyGroup,
      handleDeleteGroup,
      handleToggleDefaultGroup,
      setDefaultGroupMutation.isPending,
      styles.groupActionButton,
      styles.groupActions,
      styles.groupCard,
      styles.groupHeaderRow,
      styles.groupMeta,
      styles.groupName,
      styles.groupPreview,
      styles.groupTitleWrap,
    ]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar title="Friend Groups" showBackButton />
      <View style={styles.pageSwitcherRow}>
        <TouchableOpacity
          style={[styles.pageSwitcherButton, page === 'selection' && styles.pageSwitcherButtonActive]}
          onPress={() => setPage('selection')}
          activeOpacity={0.8}
        >
          <ThemedText style={[styles.pageSwitcherText, page === 'selection' && styles.pageSwitcherTextActive]}>
            Selection
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pageSwitcherButton, page === 'groups' && styles.pageSwitcherButtonActive]}
          onPress={() => setPage('groups')}
          activeOpacity={0.8}
        >
          <ThemedText style={[styles.pageSwitcherText, page === 'groups' && styles.pageSwitcherTextActive]}>
            Groups
          </ThemedText>
        </TouchableOpacity>
      </View>

      {page === 'selection' ? (
        <>
          <View style={styles.selectionHeader}>
            <SearchBar value={searchQuery} onChangeText={setSearchQuery} placeholder="Search friends" />
            <View style={styles.selectionMetaRow}>
              <ThemedText style={styles.selectionMetaText}>
                {selectedCount} of {friends.length} selected
              </ThemedText>
              <TouchableOpacity style={styles.metaActionButton} onPress={handleToggleAll} activeOpacity={0.8}>
                <ThemedText style={styles.metaActionButtonText}>
                  {allSelected ? 'Deselect all' : 'Select all'}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
          {isFetchingFriends && friends.length === 0 ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={colors.tint} />
            </View>
          ) : (
            <FlatList
              data={filteredFriends}
              keyExtractor={(item) => item.id}
              renderItem={renderFriend}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          )}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.footerButton, selectedCount === 0 && styles.footerButtonDisabled]}
              disabled={selectedCount === 0}
              onPress={handleOpenSaveDialog}
              activeOpacity={0.8}
            >
              <ThemedText style={styles.footerButtonText}>Save Group</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.footerSecondaryButton} onPress={() => setPage('groups')} activeOpacity={0.8}>
              <ThemedText style={styles.footerSecondaryButtonText}>View Groups</ThemedText>
            </TouchableOpacity>
          </View>
        </>
      ) : isLoadingGroups ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          renderItem={renderGroup}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <ThemedText style={styles.emptyText}>No groups saved yet.</ThemedText>
            </View>
          }
        />
      )}

      <Modal visible={isSaveDialogVisible} transparent animationType="fade" onRequestClose={handleCloseSaveDialog}>
        <View style={styles.dialogBackdrop}>
          <TouchableOpacity style={styles.dialogBackdropPressable} activeOpacity={1} onPress={handleCloseSaveDialog} />
          <View style={styles.dialogCard}>
            <ThemedText style={styles.dialogTitle}>Save Friend Group</ThemedText>
            <TextInput
              value={groupName}
              onChangeText={setGroupName}
              placeholder="Group name"
              placeholderTextColor={colors.textSecondary}
              style={styles.dialogInput}
              autoCapitalize="words"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.defaultToggleRow}
              onPress={() => setSaveAsDefault((current) => !current)}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name={saveAsDefault ? 'check-box' : 'check-box-outline-blank'}
                size={18}
                color={saveAsDefault ? colors.tint : colors.textSecondary}
              />
              <ThemedText style={styles.defaultToggleText}>Set as default visibility group</ThemedText>
            </TouchableOpacity>
            {groupError ? <ThemedText style={styles.dialogErrorText}>{groupError}</ThemedText> : null}
            <View style={styles.dialogActions}>
              <TouchableOpacity style={styles.dialogActionButton} onPress={handleCloseSaveDialog} activeOpacity={0.8}>
                <ThemedText style={styles.dialogActionText}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogActionButton, styles.dialogPrimaryAction]}
                onPress={handleSaveGroup}
                activeOpacity={0.8}
                disabled={saveGroupMutation.isPending}
              >
                <ThemedText style={[styles.dialogActionText, styles.dialogPrimaryActionText]}>
                  {saveGroupMutation.isPending ? 'Saving...' : 'Save'}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    pageSwitcherRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 8,
    },
    pageSwitcherButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 10,
      backgroundColor: colors.cardBackground,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
    },
    pageSwitcherButtonActive: {
      borderColor: colors.tint,
      backgroundColor: colors.pillBackground,
    },
    pageSwitcherText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    pageSwitcherTextActive: {
      color: colors.tint,
    },
    selectionHeader: {
      paddingHorizontal: 16,
      gap: 8,
      paddingBottom: 6,
    },
    selectionMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    selectionMetaText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    metaActionButton: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingVertical: 5,
      paddingHorizontal: 10,
      backgroundColor: colors.cardBackground,
    },
    metaActionButtonText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    list: {
      flex: 1,
    },
    listContent: {
      padding: 16,
      paddingTop: 8,
      paddingBottom: 24,
    },
    separator: {
      height: 10,
    },
    friendRow: {
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    friendRowSelected: {
      borderColor: colors.tint,
      backgroundColor: colors.pillBackground,
    },
    friendName: {
      flex: 1,
      fontSize: 14,
      color: colors.text,
    },
    groupCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    groupHeaderRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 10,
    },
    groupTitleWrap: {
      flex: 1,
      gap: 2,
    },
    groupName: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    groupMeta: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    groupPreview: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    groupActions: {
      flexDirection: 'row',
      gap: 6,
    },
    groupActionButton: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 6,
      backgroundColor: colors.background,
    },
    footer: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 8,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
      backgroundColor: colors.background,
    },
    footerButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.tint,
      backgroundColor: colors.tint,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 11,
    },
    footerButtonDisabled: {
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
    },
    footerButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.pillActiveText,
    },
    footerSecondaryButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
    },
    footerSecondaryButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    emptyCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 18,
      paddingHorizontal: 12,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    centerContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dialogBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.35)',
      justifyContent: 'center',
      paddingHorizontal: 22,
    },
    dialogBackdropPressable: {
      ...StyleSheet.absoluteFillObject,
    },
    dialogCard: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      paddingHorizontal: 14,
      paddingVertical: 14,
      gap: 10,
    },
    dialogTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    dialogInput: {
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 10,
      paddingVertical: 9,
      fontSize: 14,
      color: colors.text,
    },
    defaultToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    defaultToggleText: {
      flex: 1,
      fontSize: 13,
      color: colors.textSecondary,
    },
    dialogErrorText: {
      fontSize: 12,
      color: colors.red.secondary,
    },
    dialogActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 2,
    },
    dialogActionButton: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    dialogPrimaryAction: {
      borderColor: colors.tint,
      backgroundColor: colors.tint,
    },
    dialogActionText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    dialogPrimaryActionText: {
      color: colors.pillActiveText,
    },
  });
