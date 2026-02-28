import { type FilterPresetPublic, type FilterPresetScope } from "shared";
import { storage } from "shared/storage";

const FILTER_PRESET_ORDER_STORAGE_KEY_PREFIX = "filter_preset_order_v1";

const getStorageKey = (scope: FilterPresetScope) =>
  `${FILTER_PRESET_ORDER_STORAGE_KEY_PREFIX}_${scope.toLowerCase()}`;

const compareByDefaultOrder = (left: FilterPresetPublic, right: FilterPresetPublic) => {
  if (left.is_favorite !== right.is_favorite) return left.is_favorite ? -1 : 1;
  const nameDelta = left.name.localeCompare(right.name, undefined, {
    sensitivity: "base",
    numeric: true,
  });
  if (nameDelta !== 0) return nameDelta;
  return left.id.localeCompare(right.id);
};

export const sortFilterPresetsByOrder = (
  presets: readonly FilterPresetPublic[],
  orderedIds: readonly string[]
) => {
  const indexById = new Map(orderedIds.map((id, index) => [id, index]));
  return [...presets].sort((left, right) => {
    const leftIndex = indexById.get(left.id);
    const rightIndex = indexById.get(right.id);

    if (leftIndex !== undefined || rightIndex !== undefined) {
      if (leftIndex === undefined) return 1;
      if (rightIndex === undefined) return -1;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    }

    return compareByDefaultOrder(left, right);
  });
};

export const sanitizeFilterPresetOrderIds = (orderedIds: readonly string[]) =>
  Array.from(new Set(orderedIds));

export const loadFilterPresetOrder = async (scope: FilterPresetScope) => {
  try {
    const raw = await storage.getItem(getStorageKey(scope));
    if (!raw) return [] as string[];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as string[];
    return sanitizeFilterPresetOrderIds(
      parsed.filter((value): value is string => typeof value === "string")
    );
  } catch {
    return [] as string[];
  }
};

export const saveFilterPresetOrder = async (
  scope: FilterPresetScope,
  orderedIds: readonly string[]
) => {
  const normalized = sanitizeFilterPresetOrderIds(orderedIds);
  await storage.setItem(getStorageKey(scope), JSON.stringify(normalized));
};
