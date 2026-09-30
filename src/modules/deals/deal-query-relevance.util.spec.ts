import {
  filterDealsByQueryRelevance,
  isTitleBlockedForQuery,
  titleMatchesSearchQuery,
} from './deal-query-relevance.util';

describe('deal-query-relevance', () => {
  it('blocks shop supply items for fashion queries', () => {
    expect(
      isTitleBlockedForQuery('Cash Tray Organizer for Shops, Portable cash box', 'men formal shirts'),
    ).toBe(true);
    expect(titleMatchesSearchQuery('Cash Tray Organizer for Shops', 'men formal shirts')).toBe(false);
  });

  it('keeps shirts for men formal shirts query', () => {
    expect(
      titleMatchesSearchQuery("Men's Solid Cotton Formal Shirt", 'men formal shirts'),
    ).toBe(true);
  });

  it('filters unrelated travel soap case for shirt search', () => {
    expect(
      titleMatchesSearchQuery('Travel Soap Case With Toothbrush Holder', 'men formal shirts'),
    ).toBe(false);
  });

  it('filterDealsByQueryRelevance removes noise but keeps matches', () => {
    const deals = [
      { title: "Men's Formal Shirt" },
      { title: 'Cash Tray Organizer for Shops' },
      { title: 'Travel Soap Case With Toothbrush Holder' },
    ];
    const out = filterDealsByQueryRelevance(deals, 'men formal shirts');
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toContain('Shirt');
  });
});
