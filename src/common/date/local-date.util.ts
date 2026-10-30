/**
 * Today's date in the user's timezone (default India), as YYYY-MM-DD.
 * Not `new Date().toISOString()`: in India the UTC date is still "yesterday" until 5:30 AM.
 */
export function localDateKey(timeZone = 'Asia/Kolkata', now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
