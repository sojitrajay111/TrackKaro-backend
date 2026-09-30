import { UserFinancialProfile } from './types';

export type DealUserGender = 'male' | 'female' | 'other' | 'unspecified';

const MALE_DEFAULTS = [
  'men formal shirts',
  'men jeans pants',
  'smartwatch for men',
  'wireless earbuds',
  'men running shoes',
  'men grooming trimmer',
];

const FEMALE_DEFAULTS = [
  'makeup kit',
  'lipstick set',
  'women kurti',
  'handbags for women',
  'skincare serum',
  'women running shoes',
];

const NEUTRAL_DEFAULTS = [
  'wireless earbuds',
  'smartphones',
  'power bank',
  'home appliances',
  'running shoes',
  'bluetooth headphones',
];

const CATEGORY_SEARCH: Record<string, string> = {
  Food: 'snacks and groceries',
  Shopping: 'fashion accessories',
  Groceries: 'grocery essentials',
  Bills: 'home essentials',
  Travel: 'travel accessories',
  Fuel: 'car accessories',
  Entertainment: 'gaming accessories',
  Health: 'fitness band',
  Subscriptions: 'electronics deals',
  Rent: 'home storage organizers',
  EMI: 'budget smartphones',
  Education: 'books and stationery',
  Other: 'best deals india',
};

/** Default Amazon/Cuelinks search when the user has not typed a query. */
export function resolveDefaultDealSearchQuery(profile?: Pick<UserFinancialProfile, 'gender' | 'topCategories'>): string {
  const topCat = profile?.topCategories?.[0]?.category;
  if (topCat && topCat !== 'Other' && CATEGORY_SEARCH[topCat]) {
    return CATEGORY_SEARCH[topCat];
  }

  const gender = profile?.gender ?? 'unspecified';
  if (gender === 'female') return FEMALE_DEFAULTS[0];
  if (gender === 'male') return MALE_DEFAULTS[0];
  return NEUTRAL_DEFAULTS[0];
}

export function listDefaultDealSearchQueries(
  profile?: Pick<UserFinancialProfile, 'gender' | 'topCategories'>,
  limit = 6,
): string[] {
  const gender = profile?.gender ?? 'unspecified';
  const pool =
    gender === 'female' ? FEMALE_DEFAULTS : gender === 'male' ? MALE_DEFAULTS : NEUTRAL_DEFAULTS;

  const fromCategories = (profile?.topCategories ?? [])
    .map((c) => CATEGORY_SEARCH[c.category])
    .filter(Boolean) as string[];

  const merged: string[] = [];
  for (const q of [...fromCategories, ...pool]) {
    const key = q.toLowerCase();
    if (!merged.some((existing) => existing.toLowerCase() === key)) {
      merged.push(q);
    }
    if (merged.length >= limit) break;
  }
  return merged.slice(0, limit);
}
