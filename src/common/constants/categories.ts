// Mirrors CategoryName in TrackKaro/src/store/types.ts — keep in sync with the frontend.
export const CATEGORY_NAMES = [
  'Food',
  'Shopping',
  'Travel',
  'Bills',
  'Entertainment',
  'Health',
  'Education',
  'Rent',
  'EMI',
  'Fuel',
  'Groceries',
  'Subscriptions',
  'Other',
] as const;

export type CategoryName = (typeof CATEGORY_NAMES)[number];
