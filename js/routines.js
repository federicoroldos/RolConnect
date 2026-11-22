// Routine schedules. Shared by the pages, the agent tools and the background worker (no DOM here).
//
// A routine: { id, name, instructions, kind: 'cron' | 'heartbeat', chatId?, schedule, active,
//              created, nextRun, runs: [{ ts, status, chatId?, note? }] }
// cron      = starts a new chat on every run
// heartbeat = wakes an existing chat and continues it
// schedule  = { type: 'interval', minutes } | { type: 'daily' | 'weekdays', time: 'HH:MM' }
//           | { type: 'weekly', day: 0-6 (0 = Sunday), time: 'HH:MM' }

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MIN_INTERVAL = 5;

export function normalizeSchedule(s = {}) {
  const type = ['interval', 'daily', 'weekdays', 'weekly'].includes(s.type) ? s.type : 'daily';
  if (type === 'interval') return { type, minutes: Math.max(MIN_INTERVAL, Math.round(Number(s.minutes) || 60)) };
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s.time || '').trim());
  const time = m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : '09:00';
  if (type === 'weekly') return { type, day: Math.min(6, Math.max(0, Math.round(Number(s.day ?? 1)) || 0)), time };
  return { type, time };
}

function dayMatches(s, day) {
  if (s.type === 'weekdays') return day >= 1 && day <= 5;
  if (s.type === 'weekly') return day === s.day;
  return true;
}

// The next time the schedule fires after `from`.
export function nextRunTime(schedule, from = Date.now()) {
  const s = normalizeSchedule(schedule);
  if (s.type === 'interval') return from + s.minutes * 60000;
  const [h, m] = s.time.split(':').map(Number);
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  for (let i = 0; i < 9; i++) {
    if (d.getTime() > from + 1000 && dayMatches(s, d.getDay())) return d.getTime();
    d.setDate(d.getDate() + 1);
    d.setHours(h, m, 0, 0);
  }
  return from + 86400000;
}

export function describeSchedule(schedule) {
  const s = normalizeSchedule(schedule);
  if (s.type === 'interval') {
    const m = s.minutes;
    return m % 1440 === 0 ? `Every ${m / 1440 === 1 ? 'day' : `${m / 1440} days`}`
      : m % 60 === 0 ? `Every ${m / 60 === 1 ? 'hour' : `${m / 60} hours`}`
      : `Every ${m} minutes`;
  }
  if (s.type === 'daily') return `Daily at ${s.time}`;
  if (s.type === 'weekdays') return `Weekdays at ${s.time}`;
  return `${DAYS[s.day]}s at ${s.time}`;
}

export function addRun(routine, run) {
  routine.runs = [{ ts: Date.now(), ...run }, ...(routine.runs || [])].slice(0, 20);
}
