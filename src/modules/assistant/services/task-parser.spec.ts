import {
  addDays,
  extractDate,
  extractTime,
  isTaskIntent,
  localDateKey,
  mergeAiTask,
  ruleBasedTaskParse,
} from './task-parser';

// A Monday, so weekday maths is easy to check.
const TODAY = '2026-10-26';

describe('ruleBasedTaskParse — the sentence from the report', () => {
  it('set reminder for tomorrow 4 55 PM for pay bill of pizza', () => {
    const t = ruleBasedTaskParse('set reminder for tomorrow 4 55 PM for pay bill of pizza', TODAY);
    expect(t).toMatchObject({
      title: 'Pay bill of pizza',
      dueDate: '2026-10-27',
      dueTime: '16:55',
      priority: 'medium',
    });
  });

  it('remind me tomorrow at 6:10 PM to send 1000 to Amiras', () => {
    const t = ruleBasedTaskParse('remind me tomorrow at 6:10 PM to send 1000 to Amiras', TODAY);
    expect(t).toMatchObject({
      title: 'Send 1000 to Amiras',
      dueDate: '2026-10-27',
      dueTime: '18:10',
      amount: 1000,
    });
  });
});

describe('extractTime', () => {
  it.each([
    ['4 55 PM', '16:55'],
    ['4:55 pm', '16:55'],
    ['4.55pm', '16:55'],
    ['455 pm', '16:55'],
    ['at 5 pm', '17:00'],
    ['12:30 a.m.', '00:30'],
    ['12 pm', '12:00'],
    ['call at 16:55', '16:55'],
    ['kal shaam 5 baje', '17:00'],
    ['subah 9 baje', '09:00'],
    ['kal 4:30 baje', '16:30'],
    ['5 વાગે સાંજે', '17:00'],
    ['शाम 6 बजे', '18:00'],
  ])('%s → %s', (text, expected) => {
    expect(extractTime(text).time).toBe(expected);
  });

  it.each(['pay 1000 to ramesh', '13 pm', 'no time here'])('no time in %p', (text) => {
    expect(extractTime(text).time).toBeUndefined();
  });

  it('does not read an amount as a time', () => {
    expect(ruleBasedTaskParse('send 1000 to Amiras at 5 pm', TODAY)).toMatchObject({
      dueTime: '17:00',
      amount: 1000,
    });
  });
});

describe('extractDate', () => {
  it.each([
    ['tomorrow', '2026-10-27'],
    ['kal', '2026-10-27'],
    ['कल', '2026-10-27'],
    ['આવતી કાલે', '2026-10-27'],
    ['day after tomorrow', '2026-10-28'],
    ['parso', '2026-10-28'],
    ['today', TODAY],
    ['friday', '2026-10-30'],
    ['monday', '2026-11-02'], // today is Monday → next Monday
    ['on 28 oct', '2026-10-28'],
    ['nov 3rd', '2026-11-03'],
    ['5 jan', '2027-01-05'], // already passed this year → next year
    ['nothing said', TODAY],
  ])('%s → %s', (text, expected) => {
    expect(extractDate(text, TODAY)).toBe(expected);
  });

  it('crosses month and year ends', () => {
    expect(extractDate('tomorrow', '2026-12-31')).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('titles drop the command words, date and time', () => {
  it.each([
    ['add task pay electricity bill friday', 'Pay electricity bill'],
    ['remind me to call mom tonight at 9 pm', 'Call mom'],
    ['please set a reminder to renew insurance on 28 oct', 'Renew insurance'],
    ['urgent remind me to pay rent tomorrow', 'Pay rent'],
  ])('%s → %s', (text, title) => {
    expect(ruleBasedTaskParse(text, TODAY).title).toBe(title);
  });

  it('keeps the whole sentence when nothing is left', () => {
    expect(ruleBasedTaskParse('remind me tomorrow', TODAY).title).toBe('Remind me tomorrow');
  });

  it('marks urgent ones high priority', () => {
    expect(ruleBasedTaskParse('urgent remind me to pay rent tomorrow', TODAY).priority).toBe(
      'high',
    );
  });
});

describe('isTaskIntent', () => {
  it.each([
    'set reminder for tomorrow 4 55 PM for pay bill of pizza',
    'Remind me to pay electricity bill',
    'add task call plumber',
    'kal shaam yaad dila dena',
    'मुझे कल याद दिलाना',
    'કાલે યાદ કરાવજો',
  ])('recognises %p', (text) => expect(isTaskIntent(text)).toBe(true));

  it.each([
    'show my upcoming bills',
    'how much did I spend this month',
    'can I afford a 20000 phone',
  ])('ignores %p', (text) => expect(isTaskIntent(text)).toBe(false));
});

describe('mergeAiTask — model output is checked field by field', () => {
  const rules = ruleBasedTaskParse(
    'set reminder for tomorrow 4 55 PM for pay bill of pizza',
    TODAY,
  );

  it('uses good model output', () => {
    const t = mergeAiTask(
      {
        title: 'pay pizza bill',
        date: '2026-10-27',
        time: '16:55',
        priority: 'medium',
        amount: null,
      },
      rules,
      TODAY,
    );
    expect(t).toMatchObject({
      title: 'Pay pizza bill',
      dueDate: '2026-10-27',
      dueTime: '16:55',
      source: 'ai',
    });
  });

  it('falls back per field when the model returns junk', () => {
    const t = mergeAiTask(
      { title: 'Pay pizza bill', date: '27/10/2026', time: '4:55 PM', priority: 'URGENT!!' },
      rules,
      TODAY,
    );
    expect(t).toMatchObject({
      title: 'Pay pizza bill',
      dueDate: '2026-10-27',
      dueTime: '16:55',
      priority: 'medium',
    });
  });

  it('rejects impossible or past dates', () => {
    expect(mergeAiTask({ title: 'x', date: '2026-02-30' }, rules, TODAY).dueDate).toBe(
      '2026-10-27',
    );
    expect(mergeAiTask({ title: 'x', date: '2025-01-01' }, rules, TODAY).dueDate).toBe(
      '2026-10-27',
    );
  });

  it('keeps the rules result when the model sends nothing usable', () => {
    expect(mergeAiTask(null, rules, TODAY)).toMatchObject({ ...rules, source: 'rules' });
  });
});

describe('localDateKey', () => {
  it('uses India time, not UTC (00:30 IST is still the previous day in UTC)', () => {
    const justAfterMidnightIST = new Date('2026-10-26T19:00:00Z'); // 00:30 on the 27th in India
    expect(localDateKey('Asia/Kolkata', justAfterMidnightIST)).toBe('2026-10-27');
    expect(justAfterMidnightIST.toISOString().slice(0, 10)).toBe('2026-10-26');
  });
});
