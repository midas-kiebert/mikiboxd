/**
 * A seat written the way the ticket prints it.
 *
 * Row and seat are free text from whatever the cinema told the person, so the
 * join has to read the shape rather than assume one: "F" + "12" is "F12", but
 * "3" + "12" needs the dash or it becomes a different seat entirely.
 */
export const formatSeatLabel = (
  seatRow: string | null | undefined,
  seatNumber: string | null | undefined,
): string | null => {
  const row = seatRow?.trim();
  const number = seatNumber?.trim();

  if (!row && !number) return null;
  if (!row) return number ?? null;
  if (!number) return row;

  const isNumericRow = /^\d+$/.test(row);
  const isNumericSeat = /^\d+$/.test(number);
  const isLetterRow = /^[A-Za-z]+$/.test(row);

  if (isNumericRow && isNumericSeat) return `${row}-${number}`;
  if (isLetterRow && isNumericSeat) return `${row}${number}`;
  return `${row}-${number}`;
};
