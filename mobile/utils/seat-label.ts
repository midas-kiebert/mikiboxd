export const formatSeatLabel = (
  seatRow: string | null | undefined,
  seatNumber: string | null | undefined
): string | null => {
  const normalizedSeatRow = seatRow?.trim();
  const normalizedSeatNumber = seatNumber?.trim();

  if (!normalizedSeatRow && !normalizedSeatNumber) {
    return null;
  }
  if (!normalizedSeatRow) {
    return normalizedSeatNumber ?? null;
  }
  if (!normalizedSeatNumber) {
    return normalizedSeatRow;
  }

  const isNumericRow = /^\d+$/.test(normalizedSeatRow);
  const isNumericSeat = /^\d+$/.test(normalizedSeatNumber);
  const isLetterRow = /^[A-Za-z]+$/.test(normalizedSeatRow);

  if (isNumericRow && isNumericSeat) {
    return `${normalizedSeatRow}-${normalizedSeatNumber}`;
  }
  if (isLetterRow && isNumericSeat) {
    return `${normalizedSeatRow}${normalizedSeatNumber}`;
  }
  return `${normalizedSeatRow}-${normalizedSeatNumber}`;
};
