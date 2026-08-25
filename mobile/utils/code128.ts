/**
 * Minimal Code 128 encoder, used to draw the Cineville pass barcode in the app.
 *
 * Only what a card number needs is implemented: code set B (all printable ASCII)
 * with a hop into code set C for runs of digits, which is what keeps a 9-digit
 * card number narrow enough to scan comfortably on a phone screen. Code set A
 * (control characters) and the FNC/shift codes are not supported.
 *
 * The output is a list of module widths, alternating bar/space and always
 * starting with a bar — the shape Code 128 patterns are defined in, and the
 * shape `CinevilleBarcode` turns into SVG rects.
 */

/**
 * The 106 Code 128 symbol patterns, indexed by symbol value. Each string is the
 * six element widths (bar, space, bar, space, bar, space) of one symbol and
 * always totals 11 modules.
 */
const SYMBOL_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232'
] as const;

/** The stop symbol is the one 13-module pattern: it carries a fourth bar. */
const STOP_PATTERN = '2331112';

/** Symbol values that are instructions rather than characters. */
const CODE_C = 99;
const CODE_B = 100;
const START_B = 104;
const START_C = 105;

/** Code set B maps a character to its symbol value by ASCII offset. */
const CODE_B_ASCII_OFFSET = 32;
const CODE_B_MIN_CHAR_CODE = 32;
const CODE_B_MAX_CHAR_CODE = 126;

/** The checksum is the weighted sum of every symbol, modulo this. */
const CHECKSUM_MODULO = 103;

/**
 * Shortest digit run worth switching code sets for. Code set C packs two digits
 * into one symbol, so a run only pays for the switch symbol once it is four
 * digits long — below that, staying in code set B is the same width or narrower.
 */
const MIN_DIGITS_FOR_CODE_C = 4;

const isDigit = (character: string): boolean => character >= '0' && character <= '9';

/** Length of the digit run starting at `start` (0 when that character isn't a digit). */
const digitRunLength = (value: string, start: number): number => {
  let end = start;
  while (end < value.length && isDigit(value[end])) end += 1;
  return end - start;
};

/**
 * The symbol values for `value`, including the start symbol and the checksum but
 * not the stop symbol.
 *
 * Encoding stays in code set B and dips into code set C for each digit run of at
 * least `MIN_DIGITS_FOR_CODE_C`, pairing off as many digits as it can and handing
 * a trailing odd digit back to code set B.
 */
const encodeSymbolValues = (value: string): number[] => {
  // A value that is nothing but an even number of digits never needs code set B,
  // so it can start in C instead of paying for a switch symbol.
  const startsInCodeC = value.length >= MIN_DIGITS_FOR_CODE_C
    && value.length % 2 === 0
    && digitRunLength(value, 0) === value.length;

  const symbols: number[] = [startsInCodeC ? START_C : START_B];
  let inCodeC = startsInCodeC;
  let index = 0;

  while (index < value.length) {
    const runLength = digitRunLength(value, index);

    if (inCodeC) {
      // Code set C can only emit whole pairs, so an odd tail ends the run early.
      if (runLength >= 2) {
        symbols.push(Number(value.slice(index, index + 2)));
        index += 2;
        continue;
      }
      symbols.push(CODE_B);
      inCodeC = false;
      continue;
    }

    if (runLength >= MIN_DIGITS_FOR_CODE_C) {
      symbols.push(CODE_C);
      inCodeC = true;
      continue;
    }

    const characterCode = value.charCodeAt(index);
    if (characterCode < CODE_B_MIN_CHAR_CODE || characterCode > CODE_B_MAX_CHAR_CODE) {
      throw new Error(`Character "${value[index]}" cannot be encoded in Code 128 set B`);
    }
    symbols.push(characterCode - CODE_B_ASCII_OFFSET);
    index += 1;
  }

  // Weighted modulo-103 check symbol: the start symbol counts once, then every
  // following symbol counts by its 1-based position.
  const checksum = symbols.reduce(
    (total, symbol, position) => total + symbol * Math.max(position, 1),
    0,
  ) % CHECKSUM_MODULO;
  symbols.push(checksum);

  return symbols;
};

export type Code128Encoding = {
  /** Element widths in modules, alternating bar/space, starting with a bar. */
  elementWidths: number[];
  /** Total width of the barcode in modules, quiet zones excluded. */
  totalModules: number;
};

/**
 * Encodes `value` as Code 128. Throws if it contains a character outside
 * printable ASCII, which a card number never does.
 */
export const encodeCode128 = (value: string): Code128Encoding => {
  const patterns = encodeSymbolValues(value).map((symbol) => SYMBOL_PATTERNS[symbol]);
  const elementWidths = [...patterns, STOP_PATTERN]
    .join('')
    .split('')
    .map(Number);

  return {
    elementWidths,
    totalModules: elementWidths.reduce((total, width) => total + width, 0),
  };
};
