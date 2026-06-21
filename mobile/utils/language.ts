/**
 * Human-readable language names for ISO-639-1 codes.
 *
 * `movie.original_language` comes from TMDB as a two-letter code (e.g. "en",
 * "fr", "ja"). The filter `LANGUAGE_LABEL` maps in components/filters/ only
 * cover the subtitle-relevant nl/en pair, so this fuller map is used wherever
 * we want to show the film's main spoken language.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  nl: "Dutch",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  hi: "Hindi",
  ar: "Arabic",
  tr: "Turkish",
  pl: "Polish",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  fi: "Finnish",
  cs: "Czech",
  el: "Greek",
  he: "Hebrew",
  hu: "Hungarian",
  ro: "Romanian",
  uk: "Ukrainian",
  fa: "Persian",
  th: "Thai",
  id: "Indonesian",
  vi: "Vietnamese",
  is: "Icelandic",
  ca: "Catalan",
  sr: "Serbian",
  hr: "Croatian",
  bg: "Bulgarian",
  sk: "Slovak",
  sl: "Slovenian",
  et: "Estonian",
  lv: "Latvian",
  lt: "Lithuanian",
  ga: "Irish",
  cy: "Welsh",
};

/**
 * Returns a display name for a language code, falling back to the uppercased
 * code for anything not in the map. Returns null for empty/missing input.
 */
export function formatLanguageCode(code?: string | null): string | null {
  const normalized = code?.trim().toLowerCase();
  if (!normalized) return null;
  return LANGUAGE_NAMES[normalized] ?? normalized.toUpperCase();
}
