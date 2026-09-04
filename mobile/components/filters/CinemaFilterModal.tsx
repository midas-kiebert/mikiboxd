/**
 * Mobile filter UI component: Cinema Filter Modal.
 *
 * Laid out like FiltersModal: a scroll box holding nothing but the cinemas
 * themselves, plus a footer pinned below it for the actions that end the visit.
 * Presets are applied from the top bar and from the Filters sheet, not from in
 * here, so the list is never a wall of preset cards standing between the user
 * and the cinemas.
 *
 * The footer carries two unequal jobs. Setting *your cinemas* — the selection
 * applied on startup — is something every user wants and nobody should have to
 * name, so it is one prominent tap with no dialog behind it. Saving a *named
 * preset* is a power feature most users never need, so it is a demoted text
 * button; it still opens a name dialog, but prefilled, so the field never
 * blocks the save. Applying without saving anything needs no button at all:
 * closing the sheet already commits the selection to the session.
 *
 * Editing a saved preset uses the same page with a different frame: a name
 * field above the list, and a footer holding nothing but Cancel and Save
 * changes. A preset's name and its cinemas are one edit, so there is one Edit
 * button on the manage page and no separate rename dialog anywhere.
 *
 * The cinemas are drawn by the shared {@link CinemaPickerList}, so the sheet and
 * the cinema-preset feature tip pick cinemas in exactly the same way.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheetScrollView, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { QueryClientProvider, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  MeService,
  type CinemaPresetCreate,
  type CinemaPresetPublic,
} from "shared";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";

import { ThemedText } from "@/components/themed-text";
import CinemaPickerList from "@/components/filters/CinemaPickerList";
import { serializeCinemaIds, sortCinemaIds } from "@/components/filters/cinema-grouping";
import {
  findMyCinemasPreset,
  findNamedCinemaPresets,
  invalidateCinemaPresets,
  nextCinemaPresetName,
  useCinemaPresets,
} from "@/components/filters/cinema-presets";
import {
  loadCinemaPresetOrder,
  sanitizeCinemaPresetOrderIds,
  saveCinemaPresetOrder,
  sortCinemaPresetsByOrder,
} from "@/components/filters/cinema-preset-order";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useCinemaSelection } from "@/hooks/useCinemaSelection";
import { useIsSignedIn } from "@/utils/auth-session";
import AppBottomSheet from "@/components/sheets/AppBottomSheet";
import { retireCinemaPresetTip } from "@/utils/feature-tips";
import { triggerImpactHaptic, triggerSelectionHaptic } from "@/utils/long-press";

type CinemaFilterModalProps = {
  visible: boolean;
  onClose: () => void;
  onBack?: () => void;
  initialPage?: CinemaModalPage;
  /**
   * Opens straight into editing this preset — the picker seeded with its
   * cinemas and the edit footer up — rather than on the plain selection page.
   * Set by the cinema pill's dropdown, whose rows each carry a pencil.
   */
  initialEditPresetId?: string | null;
};

/** What the cinema pill's dropdown (and anything else opening this sheet) can ask for. */
export type OpenCinemaModalOptions = { editPresetId?: string };

type CinemaModalPage = "selection" | "presets";

const formatCinemaCount = (count: number) => `${count} cinema${count === 1 ? "" : "s"}`;

const setsMatch = (left: Set<number>, right: Set<number>) => {
  if (left.size !== right.size) return false;
  for (const id of left) { if (!right.has(id)) return false; }
  return true;
};

export default function CinemaFilterModal({
  visible,
  onClose,
  onBack,
  initialPage = "selection",
  initialEditPresetId = null,
}: CinemaFilterModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const { bottom: bottomInset } = useSafeAreaInsets();

  const [page, setPage] = useState<CinemaModalPage>("selection");
  const [presetName, setPresetName] = useState("");
  // Uncontrolled input (no `value` prop) to avoid swallowing fast keystrokes.
  const presetNameInputRef = useRef<TextInput>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [isSavePresetDialogVisible, setIsSavePresetDialogVisible] = useState(false);
  // Set when the backend reports the typed name is taken. The save button then
  // offers to replace that preset, so overwriting is always a second, deliberate
  // tap rather than something that happens silently behind a reused name.
  const [isReplacingNamedPreset, setIsReplacingNamedPreset] = useState(false);
  // The preset being edited, if any — the picker is seeded with its cinemas,
  // the name field with its name, and "Save changes" writes both back to this
  // same preset by id, rather than creating or overwriting-by-name. Name and
  // cinemas are one edit: there is no separate rename anywhere.
  const [presetBeingEdited, setPresetBeingEdited] = useState<CinemaPresetPublic | null>(null);
  const [presetPendingDeletion, setPresetPendingDeletion] = useState<CinemaPresetPublic | null>(null);
  // Uncontrolled like the save dialog's field, for the same reason: a
  // controlled value swallows fast keystrokes. `BottomSheetTextInput`, not a
  // bare one: it lives inside the sheet, which has to know it holds focus.
  const [editNameValue, setEditNameValue] = useState("");
  const [editNameError, setEditNameError] = useState<string | null>(null);
  // Guards the auto-start below against the reset effect running again (the
  // cinema list resolving re-fires it) and throwing the edit away.
  const autoEditStartedRef = useRef(false);
  // Set alongside it: opened straight into an edit from the dropdown's
  // pencil, this sheet was never on the manage-presets list, so Cancel and
  // Save changes have nowhere sensible to land but closed — back to whatever
  // screen the pencil was tapped from, not a page the user never opened.
  const editOpenedFromShortcutRef = useRef(false);
  // Flips the moment "Set as my cinemas" is tapped, so the button reports the
  // result on the same frame instead of after the round trip. Holds the
  // selection it was tapped for, so editing the picker afterwards re-arms it.
  const [savedMyCinemasSignature, setSavedMyCinemasSignature] = useState<string | null>(null);
  const [presetOrderIds, setPresetOrderIds] = useState<readonly string[]>([]);

  const { data: cinemas } = useFetchCinemas();
  // Presets and saved favourites belong to an account. A guest still picks
  // cinemas here — that is the whole point, it is what shapes their feed — but
  // the picks are kept on the device, and the preset footer below is theirs to
  // discover after signing up rather than a row of buttons that can only refuse.
  const isSignedIn = useIsSignedIn();
  const { data: favoriteCinemaIds, isLoading: isFavoritesLoading } = useFetchSelectedCinemas({
    enabled: isSignedIn,
  });
  const { cinemaIds: sessionCinemaIds, setCinemaIds: setSessionCinemaIds } = useCinemaSelection();

  // Picking nothing is picking everything (see useCinemaSelection), so the
  // picker opens with every cinema ticked rather than with an empty list that
  // contradicts the feed behind it.
  const selectedCinemas = useMemo(() => {
    const chosen = sessionCinemaIds ?? favoriteCinemaIds ?? [];
    if (chosen.length > 0) return chosen;
    return (cinemas ?? []).map((cinema) => cinema.id);
  }, [sessionCinemaIds, favoriteCinemaIds, cinemas]);
  const [localSelectedCinemaSet, setLocalSelectedCinemaSet] = useState<Set<number>>(
    () => new Set(selectedCinemas),
  );
  const selectedCinemaSet = useMemo(() => new Set(selectedCinemas), [selectedCinemas]);

  // Refs so handleSheetChange can commit the latest selection without stale closure.
  const localSelectedCinemaSetRef = useRef(localSelectedCinemaSet);
  useEffect(() => { localSelectedCinemaSetRef.current = localSelectedCinemaSet; }, [localSelectedCinemaSet]);
  const selectedCinemaSetRef = useRef(selectedCinemaSet);
  useEffect(() => { selectedCinemaSetRef.current = selectedCinemaSet; }, [selectedCinemaSet]);

  // Commit the pending selection (if changed) when the sheet closes.
  const handleClose = useCallback(() => {
    const current = localSelectedCinemaSetRef.current;
    const preferred = selectedCinemaSetRef.current;
    if (!setsMatch(current, preferred)) {
      setSessionCinemaIds(sortCinemaIds(current));
    }
    onClose();
  }, [onClose, setSessionCinemaIds]);

  // "Apply": the same commit `handleClose` already does implicitly on swipe-down
  // or backdrop tap, spelled out as a button next to "Set as preferred cinemas"
  // for anyone who wants a one-off selection without changing their default.
  const handleApplySelection = useCallback(() => {
    triggerSelectionHaptic();
    handleClose();
  }, [handleClose]);

  // Header back button: step back from the presets page, else return to the
  // parent sheet (when opened nested), else nothing (root selection page).
  const headerBack =
    page === "presets" ? () => setPage("selection") : onBack;

  const handleAndroidBack = useCallback(() => {
    if (page === "presets") {
      setPage("selection");
      return true;
    }
    if (onBack) {
      onBack();
      return true;
    }
    handleClose();
    return true;
  }, [page, onBack, handleClose]);

  useEffect(() => {
    if (!visible) {
      autoEditStartedRef.current = false;
      editOpenedFromShortcutRef.current = false;
      return;
    }
    setPresetError(null);
    setPresetName("");
    setIsSavePresetDialogVisible(false);
    setIsReplacingNamedPreset(false);
    setPresetPendingDeletion(null);
    setSavedMyCinemasSignature(null);
    // An edit already under way owns the picker and the page; this effect
    // re-runs whenever the cinema list settles, which would otherwise wipe it.
    if (autoEditStartedRef.current) return;
    setLocalSelectedCinemaSet(new Set(selectedCinemas));
    setPresetBeingEdited(null);
    setEditNameError(null);
    setPage(initialPage);
  }, [visible, selectedCinemas, initialPage]);

  const { data: presets = [], isLoading: isPresetsLoading } = useCinemaPresets({
    enabled: visible && isSignedIn,
  });

  useEffect(() => {
    if (!visible) return;
    let isMounted = true;
    loadCinemaPresetOrder().then((orderedIds) => {
      if (!isMounted) return;
      setPresetOrderIds(orderedIds);
    });
    return () => { isMounted = false; };
  }, [visible]);

  // "Set as my cinemas": no name, no dialog, one round trip. The endpoint
  // creates the user's preset row the first time and overwrites it after that,
  // so this is the same button whether or not they have one yet.
  const saveMyCinemasMutation = useMutation({
    mutationFn: (cinemaIds: number[]) =>
      MeService.setCinemaSelections({ requestBody: cinemaIds }),
    onSuccess: (_data, cinemaIds) => {
      // Applied straight away rather than at close: the user just declared
      // these their cinemas, and the feed behind the sheet should agree.
      setSessionCinemaIds(cinemaIds);
      invalidateCinemaPresets(queryClient);
      retireCinemaPresetTip();
    },
    onError: () => {
      setSavedMyCinemasSignature(null);
      Alert.alert("Could not save", "Your cinemas were not saved. Please try again.");
    },
  });

  const savePresetMutation = useMutation({
    mutationFn: (requestBody: CinemaPresetCreate) => MeService.createCinemaPreset({ requestBody }),
    onSuccess: () => {
      setPresetError(null);
      setPresetName("");
      setIsReplacingNamedPreset(false);
      setIsSavePresetDialogVisible(false);
      invalidateCinemaPresets(queryClient);
      retireCinemaPresetTip();
    },
    onError: (error) => {
      // 409 means the name is taken. That is a question, not a failure: keep
      // the dialog open with the name intact and let the next tap replace it.
      if (error instanceof ApiError && error.status === 409) {
        setIsReplacingNamedPreset(true);
        setPresetError("You already have a preset with that name.");
        return;
      }
      setPresetError("Could not save cinema preset. Please try again.");
    },
  });

  // One write for both halves of an edit: the endpoint takes a name and a
  // cinema list, and the edit page offers both at once.
  const editPresetMutation = useMutation({
    mutationFn: ({ presetId, name, cinemaIds }: { presetId: string; name: string; cinemaIds: number[] }) =>
      MeService.renameCinemaPreset({ presetId, requestBody: { name, cinema_ids: cinemaIds } }),
    onSuccess: () => {
      setPresetBeingEdited(null);
      setEditNameError(null);
      autoEditStartedRef.current = false;
      invalidateCinemaPresets(queryClient);
      triggerSelectionHaptic();
      // Opened straight into this edit from the dropdown's pencil: there is
      // no manage-presets list underneath to reveal, so the sheet closes
      // outright rather than navigating to a page this visit never opened.
      // The picker held the preset's own cinemas, not the active filter, so
      // it is reset first — closing must not silently apply them as the
      // session's selection.
      if (editOpenedFromShortcutRef.current) {
        editOpenedFromShortcutRef.current = false;
        // See handleCancelEditPreset: handleClose reads the ref synchronously,
        // ahead of the effect that would otherwise sync it to the state below.
        const revertedSet = new Set(selectedCinemas);
        localSelectedCinemaSetRef.current = revertedSet;
        setLocalSelectedCinemaSet(revertedSet);
        handleClose();
        return;
      }
      setPage("presets");
    },
    onError: (error) => {
      // A taken name is a question for the field, not a failure of the save:
      // keep the page as it is and answer under the input.
      if (error instanceof ApiError && error.status === 409) {
        setEditNameError("You already have a preset with that name.");
        return;
      }
      setEditNameError("Could not save this preset. Please try again.");
    },
  });

  const deletePresetMutation = useMutation({
    mutationFn: (presetId: string) => MeService.deleteCinemaPreset({ presetId }),
    onSuccess: () => {
      setPresetPendingDeletion(null);
      invalidateCinemaPresets(queryClient);
    },
    onError: () => {
      setPresetPendingDeletion(null);
      Alert.alert("Could not delete", "That preset was not deleted. Please try again.");
    },
  });

  // Copies a preset's cinemas into the user's own row rather than handing the
  // role over to it — see the backend's `apply_cinema_preset_as_favorite`.
  const useAsMyCinemasMutation = useMutation({
    mutationFn: (presetId: string) => MeService.setFavoriteCinemaPreset({ presetId }),
    onSuccess: () => {
      invalidateCinemaPresets(queryClient);
    },
  });

  // The user's own cinemas are pinned above the list and never reordered, so
  // only the named presets take part in the saved ordering.
  const myCinemasPreset = useMemo(() => findMyCinemasPreset(presets), [presets]);
  const namedPresets = useMemo(() => findNamedCinemaPresets(presets), [presets]);

  const orderedPresets = useMemo(
    () => sortCinemaPresetsByOrder(namedPresets, presetOrderIds),
    [presetOrderIds, namedPresets],
  );
  const presetsForRender = useMemo(
    () => (orderedPresets.length > 0 || namedPresets.length === 0 ? orderedPresets : namedPresets),
    [orderedPresets, namedPresets],
  );

  useEffect(() => {
    if (presetOrderIds.length === 0 || namedPresets.length === 0) return;
    const presetIdSet = new Set(namedPresets.map((p) => p.id));
    const trimmedOrder = presetOrderIds.filter((id) => presetIdSet.has(id));
    if (trimmedOrder.length === presetOrderIds.length) return;
    const normalizedOrder = sanitizeCinemaPresetOrderIds(trimmedOrder);
    setPresetOrderIds(normalizedOrder);
    saveCinemaPresetOrder(normalizedOrder).catch(() => undefined);
  }, [presetOrderIds, namedPresets]);

  const cinemaList = useMemo(() => cinemas ?? [], [cinemas]);
  const allCinemaIds = useMemo(() => cinemaList.map((c) => c.id), [cinemaList]);
  const allSelected = allCinemaIds.length > 0 && allCinemaIds.every((id) => localSelectedCinemaSet.has(id));
  const selectedCount = localSelectedCinemaSet.size;
  const currentSelectionSignature = useMemo(
    () => serializeCinemaIds(localSelectedCinemaSet),
    [localSelectedCinemaSet],
  );
  // Already saved either because the stored row says so, or because the tap
  // just happened and the round trip has not landed yet.
  const isCurrentSelectionMyCinemas =
    savedMyCinemasSignature === currentSelectionSignature ||
    (myCinemasPreset !== null &&
      serializeCinemaIds(myCinemasPreset.cinema_ids) === currentSelectionSignature);
  const selectionMatchesNamedPreset = useMemo(
    () => namedPresets.some((p) => serializeCinemaIds(p.cinema_ids) === currentSelectionSignature),
    [currentSelectionSignature, namedPresets],
  );
  // A selection covering no cinema would filter every showtime away, so neither
  // action is offered for one. Beyond that the two disable independently: the
  // same cinemas can be both your default and a named preset, and saving one
  // has no bearing on whether the other is worth a tap.
  const canSaveMyCinemas = selectedCount > 0 && !isCurrentSelectionMyCinemas;
  const canSaveAsPreset = selectedCount > 0 && !selectionMatchesNamedPreset;
  // An edit needs both halves to be sayable: a preset with no cinemas filters
  // everything away, and one with no name cannot be picked out of a list.
  const canSaveEditedPreset =
    !editPresetMutation.isPending && selectedCount > 0 && editNameValue.trim().length > 0;

  const handleToggle = useCallback((cinemaId: number) => {
    setLocalSelectedCinemaSet((current) => {
      const next = new Set(current);
      if (next.has(cinemaId)) { next.delete(cinemaId); } else { next.add(cinemaId); }
      return next;
    });
  }, []);

  const handleSelectCinemas = useCallback((cinemaIds: readonly number[]) => {
    setLocalSelectedCinemaSet((current) => {
      const next = new Set(current);
      cinemaIds.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const handleDeselectCinemas = useCallback((cinemaIds: readonly number[]) => {
    setLocalSelectedCinemaSet((current) => {
      const next = new Set(current);
      cinemaIds.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    triggerSelectionHaptic();
    setLocalSelectedCinemaSet(new Set(allCinemaIds));
  }, [allCinemaIds]);

  const handleClearAll = useCallback(() => {
    triggerSelectionHaptic();
    setLocalSelectedCinemaSet(new Set());
  }, []);

  const handleApplyPreset = useCallback((preset: CinemaPresetPublic) => {
    triggerSelectionHaptic();
    setLocalSelectedCinemaSet(new Set(preset.cinema_ids));
  }, []);

  const handleDeletePreset = useCallback((preset: CinemaPresetPublic) => {
    triggerSelectionHaptic();
    setPresetPendingDeletion(preset);
  }, []);

  const handleCancelDelete = useCallback(() => {
    if (deletePresetMutation.isPending) return;
    setPresetPendingDeletion(null);
  }, [deletePresetMutation.isPending]);

  const handleConfirmDelete = useCallback(() => {
    if (!presetPendingDeletion) return;
    triggerImpactHaptic();
    deletePresetMutation.mutate(presetPendingDeletion.id);
  }, [deletePresetMutation, presetPendingDeletion]);

  const handleUseAsMyCinemas = useCallback((preset: CinemaPresetPublic) => {
    triggerSelectionHaptic();
    useAsMyCinemasMutation.mutate(preset.id);
  }, [useAsMyCinemasMutation]);

  const handleStartEditPreset = useCallback((preset: CinemaPresetPublic) => {
    // "All cinemas" is the built-in fallback, not a saved row — nothing here
    // could edit it meaningfully. Every caller already filters it out; this
    // is just the backstop for `initialEditPresetId`, which names an id.
    if (preset.is_default) return;
    triggerSelectionHaptic();
    setLocalSelectedCinemaSet(new Set(preset.cinema_ids));
    setEditNameValue(preset.name);
    setEditNameError(null);
    setPresetBeingEdited(preset);
    setPage("selection");
  }, []);

  const handleCancelEditPreset = useCallback(() => {
    triggerSelectionHaptic();
    setLocalSelectedCinemaSet(new Set(selectedCinemas));
    setPresetBeingEdited(null);
    setEditNameError(null);
    autoEditStartedRef.current = false;
    // See the mutation's onSuccess: a shortcut-opened edit has no
    // manage-presets list to fall back to, so cancelling closes the sheet too.
    if (editOpenedFromShortcutRef.current) {
      editOpenedFromShortcutRef.current = false;
      // handleClose reads the ref, which only picks up the reset above on the
      // next effect pass — too late for a close happening in this same tick.
      // Written through directly so the close sees the reverted selection.
      localSelectedCinemaSetRef.current = new Set(selectedCinemas);
      handleClose();
    }
  }, [selectedCinemas, handleClose, localSelectedCinemaSetRef]);

  const handleConfirmEditPreset = useCallback(() => {
    const trimmedName = editNameValue.trim();
    if (!presetBeingEdited || localSelectedCinemaSet.size === 0 || !trimmedName) return;
    triggerImpactHaptic();
    editPresetMutation.mutate({
      presetId: presetBeingEdited.id,
      name: trimmedName,
      cinemaIds: sortCinemaIds(localSelectedCinemaSet),
    });
  }, [presetBeingEdited, localSelectedCinemaSet, editNameValue, editPresetMutation]);

  // Opened from the dropdown's pencil: the presets query has to land before
  // there is anything to edit, so this waits for it rather than running in the
  // reset effect. Once armed it stays armed until the edit ends (see the ref).
  useEffect(() => {
    if (!visible || !initialEditPresetId || autoEditStartedRef.current) return;
    const target = presets.find((preset) => preset.id === initialEditPresetId);
    if (!target) return;
    autoEditStartedRef.current = true;
    editOpenedFromShortcutRef.current = true;
    handleStartEditPreset(target);
  }, [visible, initialEditPresetId, presets, handleStartEditPreset]);

  const persistPresetOrder = useCallback((orderedIds: readonly string[]) => {
    const normalizedOrder = sanitizeCinemaPresetOrderIds(orderedIds);
    setPresetOrderIds(normalizedOrder);
    saveCinemaPresetOrder(normalizedOrder).catch(() => undefined);
  }, []);

  const handleMovePreset = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex || toIndex >= presetsForRender.length) return;
    const reordered = [...presetsForRender];
    const [moved] = reordered.splice(fromIndex, 1);
    if (!moved) return;
    reordered.splice(toIndex, 0, moved);
    persistPresetOrder(reordered.map((p) => p.id));
  }, [persistPresetOrder, presetsForRender]);

  const handleSaveMyCinemas = useCallback(() => {
    if (!canSaveMyCinemas) return;
    triggerSelectionHaptic();
    // Recorded before the request so the button reports "saved" this frame.
    setSavedMyCinemasSignature(currentSelectionSignature);
    saveMyCinemasMutation.mutate(sortCinemaIds(localSelectedCinemaSet));
  }, [
    canSaveMyCinemas,
    currentSelectionSignature,
    localSelectedCinemaSet,
    saveMyCinemasMutation,
  ]);

  const handleSavePreset = useCallback(() => {
    const trimmed = presetName.trim();
    if (!trimmed) { setPresetError("Enter a preset name."); return; }
    savePresetMutation.mutate({
      name: trimmed,
      cinema_ids: sortCinemaIds(localSelectedCinemaSet),
      overwrite: isReplacingNamedPreset,
    });
  }, [isReplacingNamedPreset, localSelectedCinemaSet, presetName, savePresetMutation]);

  const handleOpenSavePresetDialog = useCallback(() => {
    if (!canSaveAsPreset) return;
    triggerSelectionHaptic();
    // Prefilled, so the dialog opens on a name that already works: the user
    // types only if they care what it is called.
    setPresetName(nextCinemaPresetName(presets));
    setPresetError(null);
    setIsReplacingNamedPreset(false);
    setIsSavePresetDialogVisible(true);
  }, [canSaveAsPreset, presets]);

  const handleCloseSavePresetDialog = useCallback(() => {
    if (savePresetMutation.isPending) return;
    setIsSavePresetDialogVisible(false);
    setIsReplacingNamedPreset(false);
    setPresetError(null);
  }, [savePresetMutation.isPending]);

  // Block only while the cinema list is unavailable or the favourites query is
  // still in-flight. Once favourites settles — even on error (e.g. a rejected
  // token or a network blip) — fall through with an empty selection instead of
  // spinning forever.
  const isLoadingSelection =
    cinemas === undefined ||
    (sessionCinemaIds === undefined && favoriteCinemaIds === undefined && isFavoritesLoading);

  return (
    <>
      <AppBottomSheet
        visible={visible}
        onClose={handleClose}
        onBack={headerBack}
        handleAndroidBack={handleAndroidBack}
        title={page === "presets" ? "Manage presets" : "Cinemas"}
        backgroundColor={colors.nestedModalBackground}
        // Opens both on its own (the cinema chip) and on top of the Filters
        // sheet, so it has to draw in front of it. That used to mean rebuilding
        // the sheet on every open, which cost ~400ms before it started to move;
        // warming instead registers its portal after the Filters sheet's, once,
        // and every open after that is a single frame. It must therefore stay
        // *after* FiltersModal in FiltersModalProvider's JSX.
        warmUpOnMount
        // ~80 cinema chips are several hundred native views, so this sheet is
        // the reason AppBottomSheet defers content at all: it holds the chips
        // back until the sheet is up, and this keeps the panel there past that
        // for as long as there is nothing to put in them.
        contentReady={!isLoadingSelection}
        loadingLabel="Loading cinemas…"
      >
        {/* @gorhom/portal does not forward React context; re-provide QueryClient for hooks inside. */}
        <QueryClientProvider client={queryClient}>
          {page === "presets" ? (
            /* ── Manage presets page ── */
            <BottomSheetScrollView
              contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {isPresetsLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={colors.tint} />
                </View>
              ) : (
                <>
                  {/* Pinned above the presets and never reordered: this is not
                      one of the presets, it is the selection every other screen
                      falls back to. */}
                  <ThemedText style={styles.manageSectionTitle}>Your preferred cinemas</ThemedText>
                  <ThemedText style={styles.hintText}>
                    Selected by default every time you open the app.
                  </ThemedText>
                  <View style={styles.manageCard}>
                    {myCinemasPreset ? (
                      <>
                        <TouchableOpacity
                          style={styles.manageNameBlock}
                          onPress={() => { handleApplyPreset(myCinemasPreset); setPage("selection"); }}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={`Apply ${myCinemasPreset.name}`}
                        >
                          <ThemedText style={styles.manageName} numberOfLines={1}>
                            {myCinemasPreset.name}
                          </ThemedText>
                          <ThemedText style={styles.manageMeta} numberOfLines={1}>
                            {formatCinemaCount(myCinemasPreset.cinema_ids.length)}
                          </ThemedText>
                        </TouchableOpacity>
                        {/* One Edit: the name and the cinemas are the same
                            edit, and the page it opens carries both. */}
                        <View style={styles.manageActions}>
                          <TouchableOpacity
                            style={styles.manageAction}
                            onPress={() => handleStartEditPreset(myCinemasPreset)}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            hitSlop={6}
                          >
                            <MaterialIcons name="edit" size={15} color={colors.textSecondary} />
                            <ThemedText style={styles.manageActionText}>Edit</ThemedText>
                          </TouchableOpacity>
                        </View>
                      </>
                    ) : (
                      <ThemedText style={styles.manageMeta}>
                        Not set yet. Pick your preferred cinemas and tap “Set as my preferred cinemas”.
                      </ThemedText>
                    )}
                  </View>

                  <ThemedText style={styles.manageSectionTitle}>Saved presets</ThemedText>
                  {presetsForRender.length === 0 ? (
                    <View style={styles.emptyContainer}>
                      <ThemedText style={styles.emptyText}>
                        No saved presets.
                      </ThemedText>
                    </View>
                  ) : (
                    <>
                      <ThemedText style={styles.hintText}>
                        Tap a preset to apply it to the picker. Use the arrows to reorder.
                      </ThemedText>
                      {presetsForRender.map((item, index) => {
                        const canMoveUp = index > 0;
                        const canMoveDown = index < presetsForRender.length - 1;
                        return (
                          <View key={item.id} style={styles.manageCard}>
                            <View style={styles.manageCardHeader}>
                              <TouchableOpacity
                                style={styles.manageNameBlock}
                                onPress={() => { handleApplyPreset(item); setPage("selection"); }}
                                activeOpacity={0.7}
                                accessibilityRole="button"
                                accessibilityLabel={`Apply ${item.name}`}
                              >
                                <ThemedText style={styles.manageName} numberOfLines={1}>
                                  {item.name}
                                </ThemedText>
                                <ThemedText style={styles.manageMeta} numberOfLines={1}>
                                  {formatCinemaCount(item.cinema_ids.length)}
                                </ThemedText>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.iconBtn, !canMoveUp && styles.iconBtnDisabled]}
                                onPress={() => { if (canMoveUp) handleMovePreset(index, index - 1); }}
                                disabled={!canMoveUp}
                                activeOpacity={0.7}
                                hitSlop={6}
                                accessibilityLabel="Move preset up"
                              >
                                <MaterialIcons name="keyboard-arrow-up" size={20} color={colors.textSecondary} />
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.iconBtn, !canMoveDown && styles.iconBtnDisabled]}
                                onPress={() => { if (canMoveDown) handleMovePreset(index, index + 1); }}
                                disabled={!canMoveDown}
                                activeOpacity={0.7}
                                hitSlop={6}
                                accessibilityLabel="Move preset down"
                              >
                                <MaterialIcons name="keyboard-arrow-down" size={20} color={colors.textSecondary} />
                              </TouchableOpacity>
                            </View>
                            {/* Worded rather than iconographic: these change
                                saved data, and a bare glyph is a guess. */}
                            <View style={styles.manageActions}>
                              <TouchableOpacity
                                style={styles.manageAction}
                                onPress={() => handleStartEditPreset(item)}
                                activeOpacity={0.7}
                                accessibilityRole="button"
                                hitSlop={6}
                              >
                                <MaterialIcons name="edit" size={15} color={colors.textSecondary} />
                                <ThemedText style={styles.manageActionText}>Edit</ThemedText>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.manageAction}
                                onPress={() => handleUseAsMyCinemas(item)}
                                activeOpacity={0.7}
                                disabled={useAsMyCinemasMutation.isPending}
                                accessibilityRole="button"
                                hitSlop={6}
                              >
                                <MaterialIcons name="star-border" size={15} color={colors.textSecondary} />
                                <ThemedText style={styles.manageActionText}>Set as preferred cinemas</ThemedText>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.manageAction}
                                onPress={() => handleDeletePreset(item)}
                                activeOpacity={0.7}
                                disabled={deletePresetMutation.isPending}
                                accessibilityRole="button"
                                hitSlop={6}
                              >
                                <MaterialIcons name="delete-outline" size={15} color={colors.red.secondary} />
                                <ThemedText style={[styles.manageActionText, styles.manageActionTextDestructive]}>
                                  Delete
                                </ThemedText>
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </BottomSheetScrollView>
          ) : (
            /* ── Cinema selection page ── */
            <>
              {presetBeingEdited ? (
                /* The name lives here rather than behind a second dialog:
                   renaming and re-picking cinemas are one edit, so the page
                   that does one does both. Keyed so switching preset re-mounts
                   the uncontrolled field on the new name. */
                <View style={styles.editingBanner}>
                  <ThemedText style={styles.editingBannerLabel}>Preset name</ThemedText>
                  <BottomSheetTextInput
                    key={presetBeingEdited.id}
                    defaultValue={presetBeingEdited.name}
                    onChangeText={(value) => {
                      setEditNameValue(value);
                      if (editNameError) setEditNameError(null);
                    }}
                    placeholder="Preset name"
                    placeholderTextColor={colors.textSecondary}
                    style={styles.editingNameInput}
                    maxLength={80}
                    autoCapitalize="words"
                    autoCorrect={false}
                    selectTextOnFocus
                  />
                  {editNameError ? (
                    <ThemedText style={styles.editingBannerError}>{editNameError}</ThemedText>
                  ) : null}
                </View>
              ) : null}
              <BottomSheetScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.pickerHeader}>
                  <ThemedText style={styles.selectionCount}>
                    {selectedCount} of {allCinemaIds.length} selected
                  </ThemedText>
                  <View style={styles.pickerHeaderActions}>
                    {!allSelected ? (
                      <TouchableOpacity
                        onPress={handleSelectAll}
                        activeOpacity={0.7}
                        hitSlop={8}
                        accessibilityRole="button"
                      >
                        <ThemedText style={styles.headerAction}>Select all</ThemedText>
                      </TouchableOpacity>
                    ) : null}
                    {selectedCount > 0 ? (
                      <TouchableOpacity
                        onPress={handleClearAll}
                        activeOpacity={0.7}
                        hitSlop={8}
                        accessibilityRole="button"
                      >
                        <ThemedText style={styles.headerAction}>Clear all</ThemedText>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>

                <CinemaPickerList
                  cinemas={cinemaList}
                  selectedIds={localSelectedCinemaSet}
                  onToggleCinema={handleToggle}
                  onSelectCinemas={handleSelectCinemas}
                  onDeselectCinemas={handleDeselectCinemas}
                />
              </BottomSheetScrollView>

              {/* Pinned footer: the preset actions stay reachable at any scroll
                  position, since the cinema list is far longer than a screen.
                  Absent for a guest — nothing in it does anything without an
                  account, and an empty bordered strip reads as broken.

                  While a preset's cinemas are being edited the footer carries
                  nothing but that edit's two outcomes: every other action here
                  writes somewhere else (the session, the preferred cinemas, a
                  new preset), which is not what this visit is for. */}
              {presetBeingEdited ? (
                <View style={[styles.footer, { paddingBottom: bottomInset + 12 }]}>
                  <View style={styles.footerPrimaryRow}>
                    <TouchableOpacity
                      style={styles.footerButton}
                      onPress={handleCancelEditPreset}
                      activeOpacity={0.8}
                      disabled={editPresetMutation.isPending}
                      accessibilityRole="button"
                    >
                      <ThemedText style={styles.footerButtonText} numberOfLines={1}>
                        Cancel
                      </ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.editSaveButton, !canSaveEditedPreset && styles.editSaveButtonDisabled]}
                      onPress={handleConfirmEditPreset}
                      activeOpacity={0.8}
                      disabled={!canSaveEditedPreset}
                      accessibilityRole="button"
                    >
                      <ThemedText style={styles.editSaveButtonText} numberOfLines={1}>
                        {editPresetMutation.isPending ? "Saving…" : "Save changes"}
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : isSignedIn ? (
              <View style={[styles.footer, { paddingBottom: bottomInset + 12 }]}>
                {/* The same button as the preferred-cinemas one below, in the
                    same two states: quiet until there is something worth
                    saving, then a soft accent fill. Saving a named selection
                    and setting the preferred one are the two ways to keep a
                    selection, and one of them being a text link made it read
                    as a lesser kind of thing rather than a different one.
                    Still placed above the primary row, so the row you act on
                    last sits closest to the thumb. */}
                <View style={styles.footerPresetRow}>
                  <TouchableOpacity
                    style={styles.footerTextButton}
                    onPress={handleOpenSavePresetDialog}
                    activeOpacity={0.6}
                    disabled={!canSaveAsPreset}
                    accessibilityRole="button"
                  >
                    <MaterialIcons
                      name={selectionMatchesNamedPreset ? "bookmark" : "bookmark-add"}
                      size={17}
                      color={canSaveAsPreset ? colors.green.secondary : colors.textSecondary}
                    />
                    <ThemedText
                      style={[
                        styles.footerButtonText,
                        canSaveAsPreset && styles.footerButtonTextHighlighted,
                      ]}
                      numberOfLines={1}
                    >
                      {selectionMatchesNamedPreset ? "Already a preset" : "Save as preset"}
                    </ThemedText>
                  </TouchableOpacity>
                  {/* Never highlighted: it opens a page rather than writing
                      anything, so it is the quiet one of the pair whatever the
                      selection is. */}
                  <TouchableOpacity
                    style={styles.footerTextButton}
                    onPress={() => {
                      triggerSelectionHaptic();
                      setPage("presets");
                    }}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                  >
                    <MaterialIcons name="tune" size={17} color={colors.textSecondary} />
                    <ThemedText style={styles.footerButtonText} numberOfLines={1}>
                      Manage presets
                    </ThemedText>
                  </TouchableOpacity>
                </View>
                <View style={styles.footerPrimaryRow}>
                  {/* The one action nearly every user wants, and the only one
                      that needs no name: it writes the selection applied on
                      startup, creating it the first time. */}
                  <TouchableOpacity
                    style={[
                      styles.footerButton,
                      canSaveMyCinemas
                        ? styles.footerButtonHighlighted
                        : styles.footerButtonDisabled,
                    ]}
                    onPress={handleSaveMyCinemas}
                    activeOpacity={0.8}
                    disabled={!canSaveMyCinemas}
                    accessibilityRole="button"
                  >
                    <MaterialIcons
                      name={isCurrentSelectionMyCinemas ? "check" : "star-border"}
                      size={17}
                      color={canSaveMyCinemas ? colors.green.secondary : colors.textSecondary}
                    />
                    <ThemedText
                      style={[
                        styles.footerButtonText,
                        canSaveMyCinemas && styles.footerButtonTextHighlighted,
                      ]}
                      numberOfLines={1}
                    >
                      {isCurrentSelectionMyCinemas ? "These are your preferred cinemas" : "Set as preferred cinemas"}
                    </ThemedText>
                  </TouchableOpacity>
                  {/* Applies the picker's current selection to this session
                      without touching the preferred-cinemas row above. */}
                  <TouchableOpacity
                    style={styles.applyButton}
                    onPress={handleApplySelection}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                  >
                    <ThemedText style={styles.applyButtonText} numberOfLines={1}>
                      Apply
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
              ) : null}
            </>
          )}
        </QueryClientProvider>
      </AppBottomSheet>

      <Modal
        transparent
        visible={isSavePresetDialogVisible}
        animationType="fade"
        onRequestClose={handleCloseSavePresetDialog}
      >
        <View style={styles.dialogBackdrop}>
          <TouchableOpacity
            style={styles.dialogBackdropPressable}
            activeOpacity={1}
            onPress={handleCloseSavePresetDialog}
          />
          {/* Mounted only while open so the field picks up a fresh suggested
              name (and the autofocus) on every visit. */}
          {isSavePresetDialogVisible ? (
            <View style={styles.dialogCard}>
              <View style={styles.dialogHeader}>
                <ThemedText style={styles.dialogTitle}>Save as preset</ThemedText>
                <ThemedText style={styles.dialogSubtitle}>
                  A named selection you can switch to later. Your preferred cinemas stay what they are.
                </ThemedText>
              </View>
              <TextInput
                ref={presetNameInputRef}
                defaultValue={presetName}
                onChangeText={(value) => {
                  setPresetName(value);
                  if (presetError) setPresetError(null);
                  // A different name is a different question: stop offering to
                  // replace the preset the last one collided with.
                  if (isReplacingNamedPreset) setIsReplacingNamedPreset(false);
                }}
                // selectTextOnFocus doesn't reliably select on the focus that
                // autoFocus triggers (only on a manual tap), so select explicitly.
                onFocus={() => presetNameInputRef.current?.setSelection(0, presetName.length)}
                placeholder="Cinema preset name"
                placeholderTextColor={colors.textSecondary}
                style={styles.dialogInput}
                maxLength={80}
                autoCapitalize="words"
                autoCorrect={false}
                selectTextOnFocus
                autoFocus
              />
              {presetError ? (
                <ThemedText style={styles.presetErrorText}>{presetError}</ThemedText>
              ) : null}
              <View style={styles.dialogActions}>
                <TouchableOpacity
                  style={[styles.dialogButton, styles.dialogButtonSecondary]}
                  onPress={handleCloseSavePresetDialog}
                  activeOpacity={0.8}
                  disabled={savePresetMutation.isPending}
                >
                  <ThemedText style={[styles.dialogButtonText, styles.dialogButtonTextSecondary]}>
                    Cancel
                  </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.dialogButton,
                    styles.dialogButtonPrimary,
                    (savePresetMutation.isPending || presetName.trim().length === 0) &&
                      styles.dialogButtonDisabled,
                  ]}
                  onPress={handleSavePreset}
                  activeOpacity={0.8}
                  disabled={savePresetMutation.isPending || presetName.trim().length === 0}
                >
                  <ThemedText style={[styles.dialogButtonText, styles.dialogButtonTextPrimary]}>
                    {savePresetMutation.isPending
                      ? "Saving..."
                      : isReplacingNamedPreset
                        ? "Replace"
                        : "Save"}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      <Modal
        transparent
        visible={presetPendingDeletion !== null}
        animationType="fade"
        onRequestClose={handleCancelDelete}
      >
        <View style={styles.dialogBackdrop}>
          <TouchableOpacity
            style={styles.dialogBackdropPressable}
            activeOpacity={1}
            onPress={handleCancelDelete}
          />
          {presetPendingDeletion !== null ? (
            <View style={styles.dialogCard}>
              <View style={styles.dialogHeader}>
                <ThemedText style={styles.dialogTitle}>Delete preset?</ThemedText>
                <ThemedText style={styles.dialogSubtitle}>
                  “{presetPendingDeletion.name}” will be removed. Your cinemas are not affected.
                </ThemedText>
              </View>
              <View style={styles.dialogActions}>
                <TouchableOpacity
                  style={[styles.dialogButton, styles.dialogButtonSecondary]}
                  onPress={handleCancelDelete}
                  activeOpacity={0.8}
                  disabled={deletePresetMutation.isPending}
                >
                  <ThemedText style={[styles.dialogButtonText, styles.dialogButtonTextSecondary]}>
                    Cancel
                  </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.dialogButton,
                    styles.dialogButtonDestructive,
                    deletePresetMutation.isPending && styles.dialogButtonDisabled,
                  ]}
                  onPress={handleConfirmDelete}
                  activeOpacity={0.8}
                  disabled={deletePresetMutation.isPending}
                >
                  <ThemedText style={[styles.dialogButtonText, styles.dialogButtonTextDestructive]}>
                    {deletePresetMutation.isPending ? "Deleting..." : "Delete"}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    // The scroll box owns the full width between the header and the pinned
    // footer; only its content is inset.
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20 },
    loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
    editingBanner: {
      gap: 6,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      backgroundColor: colors.surfaceMuted,
    },
    editingBannerLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
    editingNameInput: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.text,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.checkboxBorder,
      backgroundColor: colors.checkboxBackground,
    },
    editingBannerError: { fontSize: 12, color: colors.red.secondary },
    // Cinema selection
    pickerHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 10,
    },
    pickerHeaderActions: { flexDirection: "row", alignItems: "center", gap: 14 },
    selectionCount: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    headerAction: { fontSize: 13, fontWeight: "700", color: colors.tint },
    // Pinned footer (mirrors FiltersModal's preset actions)
    footer: {
      paddingHorizontal: 20,
      paddingTop: 12,
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
      backgroundColor: colors.nestedModalBackground,
    },
    // Preferred-cinemas button shares its row with the smaller Apply button,
    // so it takes the leftover width instead of the full row. `center`, not
    // `stretch`: Apply sets its own (shorter) vertical padding, and stretch
    // would pull it up to the taller preferred button's height regardless.
    footerPrimaryRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    footerButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      flex: 1,
    },
    // Applies the current selection to this session only — no account write,
    // so it stays the tint-filled "go" action next to the quieter preferred
    // button, but narrow since it names a much smaller commitment.
    applyButton: {
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 28,
      paddingVertical: 9,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.tint,
      backgroundColor: colors.tint,
    },
    applyButtonText: { fontSize: 13, fontWeight: "700", color: colors.pillActiveText },
    // The commit half of the editing footer: same filled treatment as Apply,
    // but it takes the wider share of the row since it is the reason the page
    // is open at all.
    editSaveButton: {
      flex: 1.4,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.tint,
      backgroundColor: colors.tint,
    },
    editSaveButtonDisabled: { opacity: 0.5 },
    editSaveButtonText: { fontSize: 13, fontWeight: "700", color: colors.pillActiveText },
    // Saving is only worth a tap once the selection is actually new, so the
    // button stays quiet until then — a soft tinted fill at the same border
    // width, so nothing shifts when the state flips. The outline is the accent's
    // own border tone rather than the fill: a soft tint on the footer's
    // background has almost no edge of its own, which left the one primary
    // action in the modal reading as a flat patch of colour.
    footerButtonHighlighted: {
      backgroundColor: colors.green.primary,
      borderColor: colors.green.border,
    },
    footerButtonDisabled: { opacity: 0.5 },
    // Unlike `footerPrimaryRow` below it, these two are deliberately equal
    // weight: both stay plain text (no outline or fill) so neither reads as
    // a boxed button someone would be steered toward, but they split the row
    // evenly so each label centers over its own half instead of one hugging
    // the leftover space and the other hugging the edge.
    footerPresetRow: { flexDirection: "row", alignItems: "stretch", gap: 8 },
    footerTextButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      paddingVertical: 8,
      flex: 1,
    },
    footerButtonText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    footerButtonTextHighlighted: { color: colors.green.secondary },
    // Manage presets page
    emptyContainer: { paddingVertical: 24, alignItems: "center", justifyContent: "center" },
    emptyText: { fontSize: 13, color: colors.textSecondary, textAlign: "center" },
    hintText: { fontSize: 12, color: colors.textSecondary, marginBottom: 8 },
    manageSectionTitle: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 8,
      marginTop: 4,
    },
    manageCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 10,
      gap: 2,
    },
    manageCardHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
    manageNameBlock: { flex: 1, gap: 2 },
    manageName: { fontSize: 14, fontWeight: "600", color: colors.text },
    manageMeta: { fontSize: 11, color: colors.textSecondary },
    // A second line of worded buttons rather than a row of glyphs: these edit
    // and delete saved data, so each one says what it does.
    manageActions: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      columnGap: 16,
      rowGap: 6,
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    manageAction: { flexDirection: "row", alignItems: "center", gap: 4 },
    manageActionText: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
    manageActionTextDestructive: { color: colors.red.secondary },
    iconBtn: {
      width: 32,
      height: 32,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceMuted,
    },
    iconBtnDisabled: { opacity: 0.4 },
    // Save preset dialog
    presetErrorText: { fontSize: 12, color: colors.red.secondary },
    dialogBackdrop: {
      flex: 1,
      backgroundColor: "rgba(15, 18, 27, 0.55)",
      justifyContent: "center",
      paddingHorizontal: 20,
    },
    dialogBackdropPressable: { ...StyleSheet.absoluteFillObject },
    dialogCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      padding: 16,
      gap: 12,
    },
    dialogHeader: { gap: 2 },
    dialogTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
    dialogSubtitle: { fontSize: 12, color: colors.textSecondary },
    dialogInput: {
      borderWidth: 1,
      borderColor: colors.divider,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.cardBackground,
      color: colors.text,
      fontSize: 14,
      fontWeight: "500",
    },
    dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 2 },
    dialogButton: {
      minHeight: 38,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    dialogButtonPrimary: { backgroundColor: colors.tint, borderColor: colors.tint },
    dialogButtonSecondary: { backgroundColor: colors.cardBackground, borderColor: colors.divider },
    dialogButtonDestructive: { backgroundColor: colors.red.primary },
    dialogButtonTextDestructive: { color: colors.red.secondary },
    dialogButtonDisabled: { opacity: 0.5 },
    dialogButtonText: { fontSize: 12, fontWeight: "700" },
    dialogButtonTextPrimary: { color: colors.pillActiveText },
    dialogButtonTextSecondary: { color: colors.textSecondary },
  });
