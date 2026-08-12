// Ticket SLA calculations use Indian Standard Time and count only business time.
// IST has no daylight-saving transitions, so an explicit offset keeps this module
// deterministic on both the server and browser regardless of their local timezone.

export const SLA_TIMEZONE = "Asia/Kolkata";
export const BUSINESS_HOURS = Object.freeze({
  start: 10,
  end: 19,
  weekdays: Object.freeze([1, 2, 3, 4, 5]),
});

export const SLA_POLICY = Object.freeze({
  IT: Object.freeze({
    Critical: Object.freeze([1, 4]),
    High: Object.freeze([2, 8]),
    Medium: Object.freeze([4, 24]),
    Low: Object.freeze([8, 48]),
  }),
  Admin: Object.freeze({
    Critical: Object.freeze([2, 8]),
    High: Object.freeze([4, 24]),
    Medium: Object.freeze([8, 48]),
    Low: Object.freeze([24, 72]),
  }),
});

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
  return BUSINESS_HOURS.weekdays.includes(weekday);
};

function nextBusinessDayStart(localDay) {
  let candidate = localDay + DAY;
  while (!isBusinessDay(candidate)) candidate += DAY;
  return candidate + BUSINESS_HOURS.start * HOUR;
}

function normalizeBusinessStart(value) {
  let local = localMillis(value);
  let localDay = dayStart(local);
  if (!isBusinessDay(localDay)) {
    while (!isBusinessDay(localDay)) localDay += DAY;
    return localDay + BUSINESS_HOURS.start * HOUR;
  }
  const start = localDay + BUSINESS_HOURS.start * HOUR;
  const end = localDay + BUSINESS_HOURS.end * HOUR;
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
    local >= localDay + BUSINESS_HOURS.start * HOUR &&
    local < localDay + BUSINESS_HOURS.end * HOUR
  );
}

export function nextBusinessTime(value = new Date()) {
  const date = asDate(value);
  return date ? instantFromLocalMillis(normalizeBusinessStart(date)) : null;
}

export function getSlaPolicy(department, priority) {
  const [responseHours, resolutionHours] =
    SLA_POLICY[department]?.[priority] || [8, 48];
  return {
    department: SLA_POLICY[department] ? department : "Default",
    priority,
    response_hours: responseHours,
    resolution_hours: resolutionHours,
    timezone: SLA_TIMEZONE,
    working_hours: "10:00-19:00",
    working_days: "Monday-Friday",
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
    const end = localDay + BUSINESS_HOURS.end * HOUR;
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
      const opening = localDay + BUSINESS_HOURS.start * HOUR;
      const closing = localDay + BUSINESS_HOURS.end * HOUR;
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

export function slaDates(department, priority, start = new Date()) {
  const policy = getSlaPolicy(department, priority);
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
