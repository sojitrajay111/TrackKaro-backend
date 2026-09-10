/**
 * The frontend and API boundary speak rupee floats (matching the existing `amount: number`
 * client type); everything stored in Mongo is an integer count of paise to avoid float
 * rounding drift, especially in group-expense splits that must sum exactly to a total.
 */
export function toMinorUnits(rupees: number): number {
  return Math.round(rupees * 100);
}

export function toMajorUnits(paise: number): number {
  return paise / 100;
}

/** Mirrors TrackKaro/src/lib/money.ts#formatINR — used when composing notification text. */
export function formatINR(rupees: number): string {
  if (Number.isNaN(rupees)) return '₹0';
  return '₹' + Math.round(rupees).toLocaleString('en-IN');
}
