export const DEFAULT_CHECK_TIME = '17:00';
export const DEFAULT_TIMEZONE = 'local';
export const SUPPORTED_TIMEZONES = ['local', 'UTC'];
export const FAILURE_RETRY_MINUTES = 60;

const CHECK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

export function resolveUpdatePolicy(updates = {}) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new Error('The manifest updates field must be an object when present.');
  }
  const checkTime = updates.check_after_local_time ?? DEFAULT_CHECK_TIME;
  const timezone = updates.timezone ?? DEFAULT_TIMEZONE;
  const match = typeof checkTime === 'string' ? checkTime.match(CHECK_TIME_PATTERN) : null;
  if (!match) {
    throw new Error(`Unsupported updates.check_after_local_time "${checkTime}". Use 24-hour HH:MM.`);
  }
  if (!SUPPORTED_TIMEZONES.includes(timezone)) {
    throw new Error(`Unsupported updates.timezone "${timezone}". Supported values: ${SUPPORTED_TIMEZONES.join(', ')}.`);
  }
  if (updates.check_on_startup !== undefined && typeof updates.check_on_startup !== 'boolean') {
    throw new Error('updates.check_on_startup must be a boolean when present.');
  }
  return {
    enabled: updates.check_on_startup !== false,
    hour: Number(match[1]),
    minute: Number(match[2]),
    timezone
  };
}

function slotOnSameDay(now, policy) {
  const slot = new Date(now.getTime());
  if (policy.timezone === 'UTC') {
    slot.setUTCHours(policy.hour, policy.minute, 0, 0);
  } else {
    slot.setHours(policy.hour, policy.minute, 0, 0);
  }
  return slot;
}

function shiftDays(date, days, policy) {
  const shifted = new Date(date.getTime());
  if (policy.timezone === 'UTC') {
    shifted.setUTCDate(shifted.getUTCDate() + days);
  } else {
    // Calendar arithmetic keeps the wall-clock slot stable across DST changes.
    shifted.setDate(shifted.getDate() + days);
    shifted.setHours(policy.hour, policy.minute, 0, 0);
  }
  return shifted;
}

// The most recent scheduled slot at or before `now`.
export function latestScheduledSlot(now, policy) {
  const today = slotOnSameDay(now, policy);
  return today.getTime() <= now.getTime() ? today : shiftDays(today, -1, policy);
}

function parseTimestamp(value) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

// Decides whether a release check should run now. A check is due when no
// successful check happened since the latest scheduled slot, so a slot missed
// while Claude Code was closed is caught up once on the next evaluation rather
// than repeatedly. Recent failures back off to avoid retrying on every start.
export function evaluateUpdateCheck(record, policy, now = new Date()) {
  const nowTime = now.getTime();
  const lastSuccess = parseTimestamp(record?.last_success_at);
  const lastAttempt = parseTimestamp(record?.last_attempt_at);
  const slot = latestScheduledSlot(now, policy);

  if (!policy.enabled) {
    return { due: false, reason: 'DISABLED' };
  }

  if (record?.last_result === 'FAILED' && lastAttempt !== null && lastAttempt <= nowTime + CLOCK_SKEW_TOLERANCE_MS) {
    const retryAt = lastAttempt + FAILURE_RETRY_MINUTES * 60 * 1000;
    if (nowTime < retryAt && (lastSuccess === null || lastSuccess < slot.getTime())) {
      return { due: false, reason: 'BACKOFF', nextCheckAt: new Date(retryAt) };
    }
  }

  if (lastSuccess === null) {
    return { due: true, reason: 'NEVER_CHECKED' };
  }
  if (lastSuccess > nowTime + CLOCK_SKEW_TOLERANCE_MS) {
    // A timestamp from the future cannot be trusted to suppress checks.
    return { due: true, reason: 'CLOCK_SKEW' };
  }
  if (lastSuccess < slot.getTime()) {
    return { due: true, reason: 'SLOT_ELAPSED' };
  }
  return { due: false, reason: 'NOT_DUE', nextCheckAt: shiftDays(slot, 1, policy) };
}
