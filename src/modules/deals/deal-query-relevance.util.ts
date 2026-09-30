/** Drop marketplace noise (B2B/shop supplies) unless the user searched for them. */
const IRRELEVANT_TITLE_SNIPPETS = [
  'cash tray',
  'cash box',
  'bill book',
  'billing book',
  'for shops',
  'for shop',
  'shop counter',
  'merchant account',
  'pos machine',
  'billing machine',
  'receipt printer',
  'thermal paper roll',
  'duplicate bill',
];

const STOP_WORDS = new Set([
  'deals',
  'deal',
  'and',
  'or',
  'the',
  'for',
  'with',
  'best',
  'top',
  'online',
  'india',
  'buy',
  'new',
  'latest',
]);

/** Broad category words — need extra title overlap when the query is mostly these. */
const GENERIC_TERMS = new Set([
  'fashion',
  'clothing',
  'accessories',
  'gadgets',
  'electronics',
  'beauty',
  'makeup',
  'skincare',
  'travel',
  'luggage',
  'home',
  'kitchen',
  'appliances',
  'food',
  'snacks',
  'grocery',
  'essentials',
]);

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/([a-zA-Z]+)(\d+)/g, '$1 $2');
}

function termInTitle(term: string, title: string): boolean {
  if (title.includes(term)) return true;
  if (term.length > 3 && term.endsWith('s') && title.includes(term.slice(0, -1))) return true;
  if (term.length > 3 && !term.endsWith('s') && title.includes(`${term}s`)) return true;
  return false;
}

function tokenizeQuery(query: string): { significant: string[]; generic: string[] } {
  const words = normalizeText(query)
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

  const significant = words.filter((w) => !GENERIC_TERMS.has(w) && w.length >= 3);
  const generic = words.filter((w) => GENERIC_TERMS.has(w));
  return { significant, generic };
}

export function isTitleBlockedForQuery(title: string, query: string): boolean {
  const titleNorm = normalizeText(title);
  const queryNorm = normalizeText(query);
  for (const snippet of IRRELEVANT_TITLE_SNIPPETS) {
    if (titleNorm.includes(snippet) && !queryNorm.includes(snippet.split(' ')[0]!)) {
      return true;
    }
  }
  return false;
}

export function titleMatchesSearchQuery(title: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;

  if (isTitleBlockedForQuery(title, q)) return false;

  const titleNorm = normalizeText(title);
  const { significant, generic } = tokenizeQuery(q);

  if (significant.length > 0) {
    const sigHits = significant.filter((t) => termInTitle(t, titleNorm)).length;
    if (sigHits === 0) return false;
    if (significant.length >= 2 && sigHits < 2) {
      const genericHits = generic.filter((t) => termInTitle(t, titleNorm)).length;
      return sigHits + genericHits >= 2;
    }
    return true;
  }

  if (generic.length === 0) return true;

  const genericHits = generic.filter((t) => termInTitle(t, titleNorm)).length;
  const minHits = generic.length >= 3 ? 2 : 1;
  return genericHits >= minHits;
}

export function filterDealsByQueryRelevance<T extends { title: string }>(
  deals: T[],
  query: string,
): T[] {
  const q = query.trim();
  if (!q || deals.length === 0) return deals;

  const filtered = deals.filter((d) => titleMatchesSearchQuery(d.title, q));
  if (filtered.length > 0) return filtered;

  const blockedOnly = deals.filter((d) => !isTitleBlockedForQuery(d.title, q));
  return blockedOnly.length > 0 ? blockedOnly : deals;
}
