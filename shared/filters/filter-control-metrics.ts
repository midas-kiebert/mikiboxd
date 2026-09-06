/**
 * Shared metrics for the *action* controls in the filter UI: the Filters
 * button and the saved-preset buttons.
 *
 * They no longer share a row — Filters sits beside the search field, the
 * presets have a captioned row of their own — but they are the same family of
 * control and are sized from one place so they cannot drift into looking like
 * two unrelated things.
 */

/**
 * Squared corners are what keep a preset button from reading as one more
 * selection pill — every stateful pill and chip in the filter UI is fully
 * rounded. (The Filters button is the exception, and deliberately so: it sits
 * in the search row and is cut to the search field's shape instead.)
 */
export const PRESET_BUTTON_RADIUS = 10;

/**
 * Set explicitly on every label in these controls: ThemedText's default type
 * carries a 24pt line height that survives a fontSize override, and leaving it
 * in charge is what made both buttons 40pt tall.
 */
export const PRESET_BUTTON_TEXT_LINE_HEIGHT = 16;

/** The hairline border, top and bottom. */
const BORDER_HEIGHT = 2;

export const PRESET_BUTTON_PADDING_VERTICAL = 6;

/** 30: line height, padding either side, and the border. */
export const PRESET_BUTTON_HEIGHT =
  PRESET_BUTTON_TEXT_LINE_HEIGHT + PRESET_BUTTON_PADDING_VERTICAL * 2 + BORDER_HEIGHT;

/**
 * Breathing room kept around the preset buttons inside their scroller, so the
 * scale pop on tap (see `PresetButton`) swells into padding rather than into
 * the scroller's clipping bounds. Taken back out of the row's own padding, so
 * the row looks exactly as tall as it did without it.
 */
export const PRESET_BUTTON_POP_HEADROOM = 2;

/** The row's left inset, applied inside the scroller so the first button has
 * somewhere to swell into as well. */
export const PRESETS_ROW_INSET = 16;

export const PRESETS_CAPTION_FONT_SIZE = 9;
export const PRESETS_CAPTION_LINE_HEIGHT = 10;
export const PRESETS_CAPTION_GAP = 4;

/**
 * The Filters button takes its type size and corner radius from the search
 * field it stands beside (see `SEARCH_FIELD_FONT_SIZE`/`SEARCH_FIELD_RADIUS`);
 * only the metrics the field has no opinion about live here.
 */
export const FILTERS_BUTTON_TEXT_LINE_HEIGHT = 20;
export const FILTERS_BUTTON_ICON_SIZE = 18;

/** Gives the button a 44pt standing height; the search row stretches it past that. */
export const FILTERS_BUTTON_PADDING_VERTICAL = 11;
