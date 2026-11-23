/** A deliberately restricted, auditable subset of RFC 5545 recurrence rules.
 * No arbitrary COUNT, UNTIL, EXDATE or offset-by-subminute intervals. */
type Frequency = 'HOURLY' | 'DAILY' | 'WEEKLY';
type Rule = { frequency: Frequency; interval: number;
  days: number[] | null; hour: number | null; minute: number | null };

const weekdayCodes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function parseTaskRrule(value: string): Rule {
  if (typeof value !== 'string' || !value.length || value.length > 160) {
    throw new Error('INVALID_RRULE');
  }
  const fields = new Map<string, string>();
  for (const segment of value.toUpperCase().split(';')) {
    const match = /^([A-Z]+)=([A-Z0-9,]+)$/.exec(segment);
    if (!match || !['FREQ', 'INTERVAL', 'BYDAY', 'BYHOUR', 'BYMINUTE'].includes(match[1]) ||
        fields.has(match[1])) throw new Error('INVALID_RRULE');
    fields.set(match[1], match[2]);
  }
  const freq = fields.get('FREQ');
  if (freq !== 'HOURLY' && freq !== 'DAILY' && freq !== 'WEEKLY') throw new Error('INVALID_RRULE');
  const intervalText = fields.get('INTERVAL') ?? '1';
  const interval = Number(intervalText);
  const maximum = freq === 'HOURLY' ? 24 : freq === 'DAILY' ? 14 : 4;
  if (!/^\d{1,2}$/.test(intervalText) || interval < 1 || interval > maximum) {
    throw new Error('INVALID_RRULE');
  }
  const hourText = fields.get('BYHOUR');
  const minuteText = fields.get('BYMINUTE');
  if (freq === 'HOURLY' && hourText !== undefined) throw new Error('INVALID_RRULE');
  if (hourText !== undefined && (!/^\d{1,2}$/.test(hourText) || Number(hourText) > 23)) {
    throw new Error('INVALID_RRULE');
  }
  if (minuteText !== undefined && (!/^\d{1,2}$/.test(minuteText) || Number(minuteText) > 59)) {
    throw new Error('INVALID_RRULE');
  }
  const byday = fields.get('BYDAY');
  if (byday && freq !== 'WEEKLY') throw new Error('INVALID_RRULE');
  let days: number[] | null = null;
  if (byday) {
    const codes = byday.split(',');
    if (!codes.length || codes.length > 7 || new Set(codes).size !== codes.length ||
        codes.some((code) => !weekdayCodes.includes(code))) throw new Error('INVALID_RRULE');
    days = codes.map((code) => weekdayCodes.indexOf(code));
  }
  return { frequency: freq, interval, days,
    hour: hourText === undefined ? null : Number(hourText),
    minute: minuteText === undefined ? null : Number(minuteText) };
}

export function nextCustomOccurrence(ruleText: string, startAt: string,
  timeZone: string, after: Date): string | null {
  const rule = parseTaskRrule(ruleText);
  const anchorMs = Date.parse(startAt);
  if (!Number.isFinite(anchorMs) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(startAt)) {
    throw new Error('INVALID_RRULE');
  }
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit',
    day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = (date: Date) => Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const anchor = parts(new Date(anchorMs));
  const anchorDay = Date.UTC(Number(anchor.year), Number(anchor.month) - 1, Number(anchor.day));
  const anchorWeekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(anchor.weekday);
  const startWeek = anchorDay - ((anchorWeekday + 6) % 7) * 86_400_000;
  const targetHour = rule.hour ?? Number(anchor.hour) % 24;
  const targetMinute = rule.minute ?? Number(anchor.minute);
  const targetDays = rule.days ?? [anchorWeekday];
  const first = Math.max(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000,
    Math.ceil(anchorMs / 60_000) * 60_000);
  const boundMinutes = (rule.frequency === 'WEEKLY' ? 7 * (rule.interval + 1)
    : rule.frequency === 'DAILY' ? rule.interval + 1 : 2) * 1440;
  for (let i = 0; i < boundMinutes; i++) {
    const candidate = new Date(first + i * 60_000);
    const p = parts(candidate);
    const hour = Number(p.hour) % 24;
    const minute = Number(p.minute);
    if (minute !== targetMinute || rule.frequency !== 'HOURLY' && hour !== targetHour) continue;
    const day = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
    const diffDays = Math.round((day - anchorDay) / 86_400_000);
    if (diffDays < 0) continue;
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
    if (rule.frequency === 'HOURLY') {
      if ((diffDays * 24 + hour - Number(anchor.hour) % 24) % rule.interval !== 0) continue;
    } else if (rule.frequency === 'DAILY') {
      if (diffDays % rule.interval !== 0) continue;
    } else {
      const week = Math.floor((day - startWeek) / (7 * 86_400_000));
      if (week % rule.interval !== 0 || !targetDays.includes(weekday)) continue;
    }
    return candidate.toISOString();
  }
  return null;
}
