import {
  filterDealsByQueryRelevance,
  isTitleBlockedForQuery,
  titleMatchesSearchQuery,
} from './deal-query-relevance.util';

describe('deal-query-relevance', () => {
  it('blocks shop supply items for fashion queries', () => {
    expect(
      isTitleBlockedForQuery(
        'Cash Tray Organizer for Shops, Portable cash box',
        'men formal shirts',
      ),
    ).toBe(true);
    expect(titleMatchesSearchQuery('Cash Tray Organizer for Shops', 'men formal shirts')).toBe(
      false,
    );
  });

  it('keeps shirts for men formal shirts query', () => {
    expect(titleMatchesSearchQuery("Men's Solid Cotton Formal Shirt", 'men formal shirts')).toBe(
      true,
    );
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

  it('strict mode (page 2+) drops off-topic products instead of falling back to all of them', () => {
    const offTopic = [
      { title: 'Travel Backpack 30L Laptop Bag' },
      { title: 'Steel Water Bottle 1L' },
      { title: 'Gel Pen Set of 10' },
    ];
    const query = 'wireless earbuds bluetooth headphones';
    // Default (page 1) keeps the old safety net: something rather than nothing.
    expect(filterDealsByQueryRelevance(offTopic, query)).toHaveLength(3);
    // Strict: nothing matches, so nothing is shown.
    expect(filterDealsByQueryRelevance(offTopic, query, true)).toEqual([]);
    // Strict keeps real matches.
    const mixed = [...offTopic, { title: 'boAt Airdopes Wireless Earbuds Bluetooth 5.3' }];
    expect(filterDealsByQueryRelevance(mixed, query, true).map((d) => d.title)).toEqual([
      'boAt Airdopes Wireless Earbuds Bluetooth 5.3',
    ]);
  });
});
