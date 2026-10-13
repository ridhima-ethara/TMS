// Ticket SLA calculations use Indian Standard Time and count only business time.
// IST has no daylight-saving transitions, so an explicit offset keeps this module
// deterministic on both the server and browser regardless of their local timezone.

export const SLA_TIMEZONE = "Asia/Kolkata";
// Defaults. Super Admin can change these in Settings → SLA & hours; the saved
// rules are applied with configureSla() on the server at startup/after a save
// and in the browser after sign-in, so both sides compute identical deadlines.
export const DEFAULT_BUSINESS_HOURS = Object.freeze({
  start: 10,
  end: 19,
  weekdays: Object.freeze([1, 2, 3, 4, 5]),
});
// [response, resolution] in business hours (Mon–Fri, 10:00–19:00 IST).
// Resolution targets (Oct 2026): Critical 2h, High 8h, Medium 24h, Low 3
// working days (3 × 9h = 27h). Same targets for both desks.
export const LOW_RESOLUTION_HOURS = 27;
const PRIORITY_TARGETS = Object.freeze({
  Critical: Object.freeze([1, 2]),
  High: Object.freeze([2, 8]),
  Medium: Object.freeze([4, 24]),
  Low: Object.freeze([8, LOW_RESOLUTION_HOURS]),
});
export const DEFAULT_SLA_POLICY = Object.freeze({
  IT: PRIORITY_TARGETS,
  Admin: PRIORITY_TARGETS,
});

export const BUSINESS_HOURS = {
  start: DEFAULT_BUSINESS_HOURS.start,
  end: DEFAULT_BUSINESS_HOURS.end,
  weekdays: [...DEFAULT_BUSINESS_HOURS.weekdays],
};
export const SLA_POLICY = JSON.parse(JSON.stringify(DEFAULT_SLA_POLICY));
// "Department|Category" → resolution hours overriding the priority target.
const CATEGORY_RESOLUTION_HOURS = new Map();
let workingHoursOnly = true;

const hourLabel = (value) => {
  const h = Math.floor(value);
  const m = Math.round((value - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Applies saved SLA rules. Unknown or invalid values keep the defaults. */
export function configureSla(config = {}) {
  const hours = config.business_hours || {};
  const start = Number(hours.start);
  const end = Number(hours.end);
  const weekdays = Array.isArray(hours.weekdays)
    ? [...new Set(hours.weekdays.map(Number).filter((d) => d >= 0 && d <= 6))]
    : null;
  BUSINESS_HOURS.start = Number.isFinite(start) && start >= 0 && start < 24 ? start : DEFAULT_BUSINESS_HOURS.start;
  BUSINESS_HOURS.end = Number.isFinite(end) && end > BUSINESS_HOURS.start && end <= 24 ? end : DEFAULT_BUSINESS_HOURS.end;
  BUSINESS_HOURS.weekdays = weekdays && weekdays.length ? weekdays.sort() : [...DEFAULT_BUSINESS_HOURS.weekdays];
  workingHoursOnly = config.working_hours_only !== false;
  for (const department of Object.keys(DEFAULT_SLA_POLICY)) {
    for (const priority of Object.keys(DEFAULT_SLA_POLICY[department])) {
      const saved = config.policy?.[department]?.[priority];
      const valid = Array.isArray(saved) && saved.length === 2 && saved.every((v) => Number.isFinite(Number(v)) && Number(v) > 0);
      SLA_POLICY[department][priority] = valid ? saved.map(Number) : [...DEFAULT_SLA_POLICY[department][priority]];
    }
  }
  CATEGORY_RESOLUTION_HOURS.clear();
  for (const [key, value] of Object.entries(config.category_resolution_hours || {})) {
    const hoursValue = Number(value);
    if (Number.isFinite(hoursValue) && hoursValue > 0) CATEGORY_RESOLUTION_HOURS.set(key, hoursValue);
  }
}

export function slaConfigSnapshot() {
  return {
    business_hours: { start: BUSINESS_HOURS.start, end: BUSINESS_HOURS.end, weekdays: [...BUSINESS_HOURS.weekdays] },
    working_hours_only: workingHoursOnly,
    policy: JSON.parse(JSON.stringify(SLA_POLICY)),
    category_resolution_hours: Object.fromEntries(CATEGORY_RESOLUTION_HOURS),
  };
}

// With "working hours only" switched off the clock runs around the clock.
const openStart = () => (workingHoursOnly ? BUSINESS_HOURS.start : 0);
const openEnd = () => (workingHoursOnly ? BUSINESS_HOURS.end : 24);
const openDays = () => (workingHoursOnly ? BUSINESS_HOURS.weekdays : [0, 1, 2, 3, 4, 5, 6]);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const IST_OFFSET = 330 * MINUTE;

const asDate = (value) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const localMillis = (date) => date.getTime() + IST_OFFSET;
const instantFromLocalMillis = (value) => new Date(value - IST_OFFSET);
const dayStart = (value) => Math.floor(value / DAY) * DAY;
const isBusinessDay = (localDay) => {
  const weekday = new Date(localDay).getUTCDay();
  return openDays().includes(weekday);
};

function nextBusinessDayStart(localDay) {
  let candidate = localDay + DAY;
  while (!isBusinessDay(candidate)) candidate += DAY;
  return candidate + openStart() * HOUR;
}

function normalizeBusinessStart(value) {
  let local = localMillis(value);
  let localDay = dayStart(local);
  if (!isBusinessDay(localDay)) {
    while (!isBusinessDay(localDay)) localDay += DAY;
    return localDay + openStart() * HOUR;
  }
  const start = localDay + openStart() * HOUR;
  const end = localDay + openEnd() * HOUR;
  if (local < start) return start;
  if (local >= end) return nextBusinessDayStart(localDay);
  return local;
}

export function isBusinessTime(value = new Date()) {
  const date = asDate(value);
  if (!date) return false;
  const local = localMillis(date);
  const localDay = dayStart(local);
  if (!isBusinessDay(localDay)) return false;
  return (
    local >= localDay + openStart() * HOUR &&
    local < localDay + openEnd() * HOUR
  );
}

export function nextBusinessTime(value = new Date()) {
  const date = asDate(value);
  return date ? instantFromLocalMillis(normalizeBusinessStart(date)) : null;
}

export function getSlaPolicy(department, priority, category) {
  const [responseHours, priorityResolutionHours] =
    SLA_POLICY[department]?.[priority] || [8, 48];
  const categoryHours = category
    ? CATEGORY_RESOLUTION_HOURS.get(`${department}|${category}`)
    : undefined;
  const days = openDays();
  return {
    department: SLA_POLICY[department] ? department : "Default",
    priority,
    response_hours: responseHours,
    resolution_hours: categoryHours || priorityResolutionHours,
    ...(categoryHours ? { category, category_override: true } : {}),
    timezone: SLA_TIMEZONE,
    working_hours: `${hourLabel(openStart())}-${hourLabel(openEnd() === 24 ? 24 : openEnd())}`,
    working_days:
      days.length === 7
        ? "Every day"
        : days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))
          ? "Monday-Friday"
          : days.map((d) => DAY_NAMES[d].slice(0, 3)).join(", "),
  };
}

export function addWorkingHours(start, hours) {
  const date = asDate(start);
  const amount = Number(hours);
  if (!date || !Number.isFinite(amount) || amount < 0) return null;
  let remaining = amount * HOUR;
  let cursor = normalizeBusinessStart(date);
  if (remaining === 0) return instantFromLocalMillis(cursor);

  while (remaining > 0) {
    const localDay = dayStart(cursor);
    const end = localDay + openEnd() * HOUR;
    const available = Math.max(0, end - cursor);
    if (remaining <= available)
      return instantFromLocalMillis(cursor + remaining);
    remaining -= available;
    cursor = nextBusinessDayStart(localDay);
  }
  return instantFromLocalMillis(cursor);
}

export function workingMillisecondsBetween(start, end) {
  const from = asDate(start);
  const to = asDate(end);
  if (!from || !to || to <= from) return 0;
  const startLocal = localMillis(from);
  const endLocal = localMillis(to);
  let localDay = dayStart(startLocal);
  const lastDay = dayStart(endLocal);
  let elapsed = 0;

  while (localDay <= lastDay) {
    if (isBusinessDay(localDay)) {
      const opening = localDay + openStart() * HOUR;
      const closing = localDay + openEnd() * HOUR;
      const overlapStart = Math.max(startLocal, opening);
      const overlapEnd = Math.min(endLocal, closing);
      if (overlapEnd > overlapStart) elapsed += overlapEnd - overlapStart;
    }
    localDay += DAY;
  }
  return elapsed;
}

export function workingMinutesBetween(start, end) {
  return Math.round(workingMillisecondsBetween(start, end) / MINUTE);
}

export function workingHoursBetween(start, end) {
  return workingMillisecondsBetween(start, end) / HOUR;
}

export function slaDates(department, priority, start = new Date(), category) {
  const policy = getSlaPolicy(department, priority, category);
  return {
    sla_response_due: addWorkingHours(start, policy.response_hours),
    sla_resolution_due: addWorkingHours(start, policy.resolution_hours),
    sla_clock_started_at: asDate(start),
    sla_policy: policy,
  };
}

export function workingTimeRemaining(due, now = new Date()) {
  const deadline = asDate(due);
  const current = asDate(now);
  if (!deadline || !current)
    return { milliseconds: 0, minutes: 0, breached: false };
  const breached = current > deadline;
  const milliseconds = breached
    ? workingMillisecondsBetween(deadline, current)
    : workingMillisecondsBetween(current, deadline);
  return {
    milliseconds,
    minutes: Math.ceil(milliseconds / MINUTE),
    breached,
  };
}
