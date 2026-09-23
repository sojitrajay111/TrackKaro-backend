/**
 * Builds a same-platform search URL to use as a last-resort link when a provider doesn't give us
 * a direct product URL. Extracted out of `deals.service.ts` so both the service and any provider
 * (e.g. the legacy Gemini provider) can reuse it without a circular import.
 */
export function getPlatformSearchUrl(platform: string, title: string): string {
  const p = (platform || '').toLowerCase().trim();
  const encoded = encodeURIComponent(title || '');
  if (p.includes('amazon')) return `https://www.amazon.in/s?k=${encoded}`;
  if (p.includes('flipkart')) return `https://www.flipkart.com/search?q=${encoded}`;
  if (p.includes('myntra'))
    return `https://www.myntra.com/${encodeURIComponent((title || '').replace(/\s+/g, '-'))}`;
  if (p.includes('swiggy')) return `https://www.swiggy.com/search?query=${encoded}`;
  if (p.includes('zomato')) return `https://www.zomato.com/india`;
  if (p.includes('blinkit')) return `https://www.blinkit.com/s/?q=${encoded}`;
  if (p.includes('zepto')) return `https://www.zeptonow.com/search?q=${encoded}`;
  if (p.includes('nykaa')) return `https://www.nykaa.com/search/result/?q=${encoded}`;
  if (p.includes('tata') || p.includes('cliq'))
    return `https://www.tatacliq.com/search/?searchCategory=all&text=${encoded}`;
  if (p.includes('croma')) return `https://www.croma.com/searchB?q=${encoded}`;
  if (p.includes('makemytrip') || p.includes('mmt')) return `https://www.makemytrip.com/`;
  if (p.includes('lenskart')) return `https://www.lenskart.com/search?q=${encoded}`;
  if (p.includes('ajio')) return `https://www.ajio.com/search/?text=${encoded}`;
  if (p.includes('nike')) return `https://www.nike.com/in/w?q=${encoded}`;
  return `https://www.google.com/search?q=${encodeURIComponent(`${platform} ${title} buy offer`)}`;
}
