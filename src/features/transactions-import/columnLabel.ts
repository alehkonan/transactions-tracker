/** Display label for a CSV column, falling back to its 1-based position. */
export function columnLabel(header: string, index: number) {
  return header || `Column ${index + 1}`;
}
