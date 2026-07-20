/** Display-only Israeli local format, e.g. 0543379545. Does not change stored values. */
export function formatPhoneDisplay(number: string): string {
  if (!number?.trim()) return "מספר חסוי";
  const digits = number.replace(/\D/g, "");
  if (!digits) return number.trim();
  if (digits.startsWith("972") && digits.length >= 11) {
    return `0${digits.slice(3)}`;
  }
  if (digits.startsWith("0")) return digits;
  if (digits.length === 9) return `0${digits}`;
  return digits;
}

/** Digits used for search so both +972 and 05x queries match. */
export function phoneSearchText(number: string): string {
  const digits = number.replace(/\D/g, "");
  const local = formatPhoneDisplay(number);
  return `${number} ${digits} ${local}`.toLowerCase();
}
