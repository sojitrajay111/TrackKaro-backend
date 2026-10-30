/**
 * Turning a spoken/typed sentence ("set reminder for tomorrow 4 55 PM for pay bill of pizza")
 * into a planner task. Gemini does the understanding when configured (see
 * GeminiOrchestratorService.callGeminiTaskParse); everything here is the deterministic part:
 * the rule-based fallback, and validation of whatever the model returns.
 */
import { TASK_PRIORITIES, TaskPriority } from '@/modules/tasks/schemas/task.schema';
import { localDateKey } from '@/common/date/local-date.util';

export interface ParsedTask {
  transcript: string;
  title: string;
  /** YYYY-MM-DD */
  dueDate: string;
  /** 24-hour HH:mm (the tasks API format), when a time was said. */
  dueTime?: string;
  priority: TaskPriority;
  /** An amount mentioned in the sentence ("send 1000 to Amiras"), if any. */
  amount?: number;
  /** Which parser produced it, for debugging and tests. */
  source: 'ai' | 'rules';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export { localDateKey };

export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Remind me…", "set a reminder…", "add task…" and the Hindi/Gujarati equivalents. */
export function isTaskIntent(text: string): boolean {
  return /\b(remind\s+me|set\s+(?:a\s+|an\s+)?reminder|reminder\s+(?:for|to|at|on)|add\s+(?:a\s+)?(?:task|to-?do)|create\s+(?:a\s+)?(?:task|reminder)|yaad\s+dila|yaad\s+karav|yaad\s+apav)\b|याद\s*दिला|याद\s*करा|રિમાઇન્ડર|યાદ\s*(?:કરાવ|અપાવ|દેવડાવ)|रिमाइंडर/i.test(
    text,
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A time said without AM/PM: over 12 is 24-hour; otherwise morning/evening words decide, and
 * 1–6 o'clock defaults to the afternoon (nobody plans a bill for 4:30 AM). */
function guessClock(h: number, min: number, lower: string): string | undefined {
  if (h > 12) return to24h(h, min);
  const morning = MORNING_WORDS.test(lower);
  const evening = EVENING_WORDS.test(lower) && !morning;
  const pm = evening || (!morning && h >= 1 && h <= 6);
  return to24h(h === 0 ? 12 : h, min, pm ? 'pm' : 'am');
}

function to24h(h: number, m: number, period?: string): string | undefined {
  if (m > 59) return undefined;
  const p = period?.replace(/\./g, '').toLowerCase();
  if (p) {
    if (h < 1 || h > 12) return undefined;
    if (p === 'pm' && h !== 12) h += 12;
    if (p === 'am' && h === 12) h = 0;
  } else if (h > 23) {
    return undefined;
  }
  return `${pad(h)}:${pad(m)}`;
}

const PERIOD = String.raw`(a\.?\s?m\.?|p\.?\s?m\.?)`;
const EVENING_WORDS =
  /\b(evening|night|tonight|shaam|sham|raat|bapore|dopahar|dupehar)\b|शाम|रात|दोपहर|સાંજે|સાંજ|રાત્રે|રાતે|બપોરે/i;
const MORNING_WORDS = /\b(morning|subah|savare)\b|सुबह|સવારે/i;

/** Finds a time in the sentence: "4:55 pm", "4 55 PM", "4.55pm", "455 pm", "16:55", "5 baje shaam". */
export function extractTime(text: string): { time?: string; match?: string } {
  const lower = text.toLowerCase();
  const tries: [RegExp, (m: RegExpMatchArray) => string | undefined][] = [
    // 4:55 pm · 4.55 pm · 4 55 pm · 4-55 pm
    [
      new RegExp(String.raw`\b(\d{1,2})\s*[:.\s-]\s*(\d{2})\s*${PERIOD}(?![a-z])`, 'i'),
      (m) => to24h(+m[1], +m[2], m[3]),
    ],
    // 455 pm · 1130 am
    [
      new RegExp(String.raw`\b(\d{1,2})(\d{2})\s*${PERIOD}(?![a-z])`, 'i'),
      (m) => to24h(+m[1], +m[2], m[3]),
    ],
    // 5 pm
    [new RegExp(String.raw`\b(\d{1,2})\s*${PERIOD}(?![a-z])`, 'i'), (m) => to24h(+m[1], 0, m[2])],
    // 5 baje / 5:30 vage / 5 બજે
    [
      /\b(\d{1,2})(?:[:.\s](\d{2}))?\s*(?:baje|bje|vage|vagye|o'?clock)\b|(\d{1,2})(?:[:.\s](\d{2}))?\s*(?:बजे|વાગે|વાગ્યે)/i,
      (m) => guessClock(+(m[1] ?? m[3]), +(m[2] ?? m[4] ?? 0), lower),
    ],
    // 16:55 (24-hour) or a bare 4:30 (judged like "baje")
    [/\b(\d{1,2}):([0-5]\d)\b/, (m) => guessClock(+m[1], +m[2], lower)],
  ];
  for (const [re, toTime] of tries) {
    const m = text.match(re);
    if (m) {
      const time = toTime(m);
      if (time) return { time, match: m[0] };
    }
  }
  return {};
}

const WEEKDAYS: [RegExp, number][] = [
  [/\b(sunday|ravivar)\b|रविवार|રવિવાર/i, 0],
  [/\b(monday|somvar)\b|सोमवार|સોમવાર/i, 1],
  [/\b(tuesday|mangalvar)\b|मंगलवार|મંગળવાર/i, 2],
  [/\b(wednesday|budhvar)\b|बुधवार|બુધવાર/i, 3],
  [/\b(thursday|guruvar)\b|गुरुवार|ગુરુવાર/i, 4],
  [/\b(friday|shukravar)\b|शुक्रवार|શુક્રવાર/i, 5],
  [/\b(saturday|shanivar)\b|शनिवार|શનિવાર/i, 6],
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Finds a date relative to `today`: tomorrow / kal / parso / a weekday / "28 oct" / "28/10". */
export function extractDate(text: string, today: string): string {
  const lower = text.toLowerCase();
  if (/\b(day\s+after\s+tomorrow|parso|parson)\b|परसों|પરમ\s*દિવસે/i.test(lower))
    return addDays(today, 2);
  if (/\b(tomorrow|tmrw|tomorow|kal|kaale|kale)\b|कल|કાલે|આવતી\s*કાલે/i.test(lower))
    return addDays(today, 1);
  if (/\b(today|tonight|aaj|aaje)\b|आज|આજે/i.test(lower)) return today;

  const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
  for (const [re, dow] of WEEKDAYS) {
    if (re.test(lower)) {
      let diff = dow - todayDow;
      if (diff <= 0) diff += 7;
      return addDays(today, diff);
    }
  }

  const year = Number(today.slice(0, 4));
  const pick = (y: number, m: number, d: number) => {
    const key = `${y}-${pad(m)}-${pad(d)}`;
    if (!isValidDateKey(key)) return undefined;
    return key < today
      ? isValidDateKey(`${y + 1}-${pad(m)}-${pad(d)}`)
        ? `${y + 1}-${pad(m)}-${pad(d)}`
        : key
      : key;
  };
  // 28 oct · 28th october · oct 28
  const dm = lower.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/,
  );
  const md = lower.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/,
  );
  const named = dm
    ? pick(year, MONTHS.indexOf(dm[2]) + 1, +dm[1])
    : md
      ? pick(year, MONTHS.indexOf(md[1]) + 1, +md[2])
      : undefined;
  if (named) return named;
  // 28/10 · 28-10 (day first, Indian style)
  const num = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (num) {
    const y = num[3] ? (num[3].length === 2 ? 2000 + +num[3] : +num[3]) : year;
    const key = num[3] ? `${y}-${pad(+num[2])}-${pad(+num[1])}` : pick(y, +num[2], +num[1]);
    if (key && isValidDateKey(key)) return key;
  }
  return today;
}

function extractPriority(text: string): TaskPriority {
  if (
    /\b(urgent|urgently|asap|important|critical|high\s+priority|jaruri|jaldi|turant)\b|जरूरी|ज़रूरी|जल्दी|તાત્કાલિક|જરૂરી|અર્જન્ટ/i.test(
      text,
    )
  ) {
    return 'high';
  }
  if (/\b(low\s+priority|whenever|not\s+urgent|no\s+rush)\b/i.test(text)) return 'low';
  return 'medium';
}

/** "send 1000 to Amiras" → 1000; "₹1,500" → 1500. Ignores times and dates. */
function extractAmount(text: string, timeMatch?: string): number | undefined {
  const withoutTime = timeMatch ? text.replace(timeMatch, ' ') : text;
  const m =
    withoutTime.match(/(?:₹|rs\.?|inr|rupees?)\s*([\d,]+(?:\.\d+)?)/i) ??
    withoutTime.match(/\b([\d,]+(?:\.\d+)?)\s*(?:₹|rs\.?|rupees?|rupaye|rupiya|रुपये|રૂપિયા)/i) ??
    withoutTime.match(
      /\b(?:pay|send|give|transfer|bhejo|aapo|dena|देना|આપવા)\s+(?:₹\s*)?([\d,]{2,})\b/i,
    );
  const n = m ? Number(m[1].replace(/,/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function cleanTitle(text: string, timeMatch?: string): string {
  let t = ` ${text} `;
  if (timeMatch) t = t.replace(timeMatch, ' ');
  t = t
    // command phrases
    .replace(/\b(?:please|pls|can\s+you|could\s+you|hey\s+trackkaro)\b/gi, ' ')
    .replace(
      /\b(?:set|create|add|make)\s+(?:a\s+|an\s+|me\s+a\s+)?(?:reminder|task|to-?do)\b/gi,
      ' ',
    )
    .replace(/\bremind\s+me\b/gi, ' ')
    .replace(/\breminder\b/gi, ' ')
    .replace(
      /\b(?:yaad\s+dila(?:na|o|ye|jo)?|yaad\s+karav(?:jo|o)?)\b|(?:का|की|के|को)?\s*(?:याद\s*दिला(?:ना|ओ|एं|एँ|इए)?|रिमाइंडर\s*(?:दें|दो|दीजिए|देना|लगाओ|सेट\s*करो)?)|(?:નું|ની|નો)?\s*(?:યાદ\s*(?:કરાવ|અપાવ)(?:જો|શો|ો)?|રિમાઇન્ડર\s*(?:આપો|મૂકો)?)/gi,
      ' ',
    )
    // dates
    .replace(
      /\b(?:day\s+after\s+tomorrow|tomorrow|tmrw|tomorow|today|tonight|parso|parson|kal|kaale|kale|aaj|aaje)\b|परसों|कल|आज|કાલે|આજે|આવતી\s*કાલે|પરમ\s*દિવસે/gi,
      ' ',
    )
    .replace(
      /\b(?:this|next|on)?\s*(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar|ravivar)\b/gi,
      ' ',
    )
    .replace(
      /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi,
      ' ',
    )
    .replace(
      /\b(?:in\s+the\s+)?(?:morning|evening|night|afternoon|subah|shaam|sham|raat)\b|सुबह|शाम|रात|સવારે|સાંજે|રાત્રે/gi,
      ' ',
    )
    // priority words
    .replace(
      /\b(?:urgent|urgently|asap|important|high\s+priority|low\s+priority|no\s+rush)\b/gi,
      ' ',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Leftover joining words at the edges ("for for pay…", "… at", "to pay").
  for (let i = 0; i < 4; i++) {
    t = t
      .replace(/^(?:for|to|at|on|about|that|of|ki|ke|ko|ne|ke\s+liye|का|की|के|को|ને|માટે)\s+/i, '')
      .replace(/\s+(?:for|to|at|on|by|ko|ne|ke\s+liye|को|ને|માટે|पर|પર)$/i, '')
      .trim();
  }
  t = t
    .replace(/\s+/g, ' ')
    .replace(/[.,!?]+$/, '')
    .trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/** Deterministic parse, used when the AI is unavailable and to fill gaps in what it returns. */
export function ruleBasedTaskParse(text: string, today: string): ParsedTask {
  const raw = (text ?? '').trim();
  const { time, match } = extractTime(raw);
  const title = cleanTitle(raw, match) || raw.charAt(0).toUpperCase() + raw.slice(1);
  return {
    transcript: raw,
    title: title.slice(0, 120),
    dueDate: extractDate(raw, today),
    dueTime: time,
    priority: extractPriority(raw),
    amount: extractAmount(raw, match),
    source: 'rules',
  };
}

/** Accepts the model's JSON only field by field: anything malformed falls back to the rules. */
export function mergeAiTask(ai: unknown, rules: ParsedTask, today: string): ParsedTask {
  const o = (ai && typeof ai === 'object' ? ai : {}) as Record<string, unknown>;
  const title =
    typeof o.title === 'string' ? o.title.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
  const date = isValidDateKey(o.date) && o.date >= addDays(today, -1) ? o.date : rules.dueDate;
  const rawTime = typeof o.time === 'string' ? o.time.trim() : '';
  // A valid model time wins; otherwise keep whatever the rules found (the model sometimes drops it).
  const time = TIME_RE.test(rawTime) ? rawTime : rules.dueTime;
  const priority = TASK_PRIORITIES.includes(o.priority as TaskPriority)
    ? (o.priority as TaskPriority)
    : rules.priority;
  const amountNum = Number(o.amount);
  const amount = Number.isFinite(amountNum) && amountNum > 0 ? amountNum : rules.amount;
  return {
    transcript: rules.transcript,
    title: title ? title.charAt(0).toUpperCase() + title.slice(1) : rules.title,
    dueDate: date,
    dueTime: time,
    priority,
    amount,
    source: title ? 'ai' : 'rules',
  };
}
