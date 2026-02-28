import { type CinemaPresetPublic } from "shared";
import { storage } from "shared/storage";

const CINEMA_PRESET_ORDER_STORAGE_KEY = "cinema_preset_order_v1";

const compareByDefaultOrder = (left: CinemaPresetPublic, right: CinemaPresetPublic) => {
  if (left.is_default !== right.is_default) return left.is_default ? -1 : 1;
  if (left.is_favorite !== right.is_favorite) return left.is_favorite ? -1 : 1;
  const nameDelta = left.name.localeCompare(right.name, undefined, {
    sensitivity: "base",
    numeric: true,
  });
  if (nameDelta !== 0) return nameDelta;
  return left.id.localeCompare(right.id);
};

export const sortCinemaPresetsByOrder = (
  presets: readonly CinemaPresetPublic[],
  orderedIds: readonly string[]
) => {
  const indexById = new Map(orderedIds.map((id, index) => [id, index]));
  return [...presets].sort((left, right) => {
    if (left.is_default !== right.is_default) return left.is_default ? -1 : 1;

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

export const sanitizeCinemaPresetOrderIds = (orderedIds: readonly string[]) =>
  Array.from(new Set(orderedIds));

export const loadCinemaPresetOrder = async () => {
  try {
    const raw = await storage.getItem(CINEMA_PRESET_ORDER_STORAGE_KEY);
    if (!raw) return [] as string[];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as string[];
    return sanitizeCinemaPresetOrderIds(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return [] as string[];
  }
};

export const saveCinemaPresetOrder = async (orderedIds: readonly string[]) => {
  const normalized = sanitizeCinemaPresetOrderIds(orderedIds);
  await storage.setItem(CINEMA_PRESET_ORDER_STORAGE_KEY, JSON.stringify(normalized));
};
