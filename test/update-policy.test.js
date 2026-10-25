import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateUpdateCheck, latestScheduledSlot, resolveUpdatePolicy } from '../src/update-policy.js';

const utcPolicy = resolveUpdatePolicy({ check_after_local_time: '17:00', timezone: 'UTC' });

test('resolves the default policy when the manifest has no update settings', () => {
  assert.deepEqual(resolveUpdatePolicy({}), { enabled: true, hour: 17, minute: 0, timezone: 'local' });
});

test('rejects unsupported check times and timezones instead of guessing', () => {
  assert.throws(() => resolveUpdatePolicy({ check_after_local_time: '5pm' }), /HH:MM/);
  assert.throws(() => resolveUpdatePolicy({ check_after_local_time: '24:00' }), /HH:MM/);
  assert.throws(() => resolveUpdatePolicy({ timezone: 'Asia/Ho_Chi_Minh' }), /Unsupported updates\.timezone/);
  assert.throws(() => resolveUpdatePolicy({ check_on_startup: 'yes' }), /must be a boolean/);
});

test('rejects a non-object updates block instead of falling back to defaults', () => {
  assert.throws(() => resolveUpdatePolicy('yes'), /updates field must be an object/);
  assert.throws(() => resolveUpdatePolicy([]), /updates field must be an object/);
});

test('a check is due when no successful check was ever recorded', () => {
  const decision = evaluateUpdateCheck(undefined, utcPolicy, new Date('2026-10-26T09:00:00.000Z'));
  assert.equal(decision.due, true);
  assert.equal(decision.reason, 'NEVER_CHECKED');
});

test('a check is not due again after succeeding since the latest slot', () => {
  const decision = evaluateUpdateCheck(
    { last_result: 'UP_TO_DATE', last_success_at: '2026-10-26T17:30:00.000Z' },
    utcPolicy,
    new Date('2026-10-26T18:00:00.000Z')
  );
  assert.equal(decision.due, false);
  assert.equal(decision.reason, 'NOT_DUE');
  assert.equal(decision.nextCheckAt.toISOString(), '2026-10-27T17:00:00.000Z');
});

test('a check before today\'s slot uses the previous day\'s slot', () => {
  const now = new Date('2026-10-26T16:00:00.000Z');
  assert.equal(latestScheduledSlot(now, utcPolicy).toISOString(), '2026-10-25T17:00:00.000Z');
  const decision = evaluateUpdateCheck({ last_success_at: '2026-10-25T17:30:00.000Z' }, utcPolicy, now);
  assert.equal(decision.due, false);
  assert.equal(decision.nextCheckAt.toISOString(), '2026-10-26T17:00:00.000Z');
});

test('a check becomes due exactly at the scheduled slot', () => {
  const decision = evaluateUpdateCheck(
    { last_success_at: '2026-10-26T16:59:00.000Z' },
    utcPolicy,
    new Date('2026-10-26T17:00:00.000Z')
  );
  assert.equal(decision.due, true);
  assert.equal(decision.reason, 'SLOT_ELAPSED');
});

test('several missed slots produce one due check, not one per missed day', () => {
  const now = new Date('2026-10-26T09:00:00.000Z');
  const missed = evaluateUpdateCheck({ last_success_at: '2026-10-20T17:30:00.000Z' }, utcPolicy, now);
  assert.equal(missed.due, true);

  const afterCatchUp = evaluateUpdateCheck({ last_success_at: now.toISOString() }, utcPolicy, new Date('2026-10-26T09:01:00.000Z'));
  assert.equal(afterCatchUp.due, false);
  assert.equal(afterCatchUp.nextCheckAt.toISOString(), '2026-10-26T17:00:00.000Z');
});

test('a recent failure backs off and retries only after the retry interval', () => {
  const record = { last_result: 'FAILED', last_attempt_at: '2026-10-26T18:00:00.000Z' };
  const during = evaluateUpdateCheck(record, utcPolicy, new Date('2026-10-26T18:30:00.000Z'));
  assert.equal(during.due, false);
  assert.equal(during.reason, 'BACKOFF');
  assert.equal(during.nextCheckAt.toISOString(), '2026-10-26T19:00:00.000Z');

  const after = evaluateUpdateCheck(record, utcPolicy, new Date('2026-10-26T19:01:00.000Z'));
  assert.equal(after.due, true);
});

test('a recent failure still backs off when the success timestamp is from the future', () => {
  const decision = evaluateUpdateCheck(
    { last_result: 'FAILED', last_attempt_at: '2026-10-26T18:00:00.000Z', last_success_at: '2026-10-28T00:00:00.000Z' },
    utcPolicy,
    new Date('2026-10-26T18:10:00.000Z')
  );
  assert.equal(decision.due, false);
  assert.equal(decision.reason, 'BACKOFF');
});

test('a success timestamp from the future does not suppress checks', () => {
  const decision = evaluateUpdateCheck(
    { last_success_at: '2026-10-28T00:00:00.000Z' },
    utcPolicy,
    new Date('2026-10-26T18:00:00.000Z')
  );
  assert.equal(decision.due, true);
  assert.equal(decision.reason, 'CLOCK_SKEW');
});

test('a disabled policy never reports a due check', () => {
  const policy = resolveUpdatePolicy({ check_on_startup: false });
  assert.equal(evaluateUpdateCheck(undefined, policy, new Date()).reason, 'DISABLED');
});

test('the local timezone policy schedules the slot at local wall-clock time', () => {
  const policy = resolveUpdatePolicy({ check_after_local_time: '17:00', timezone: 'local' });
  const decision = evaluateUpdateCheck(
    { last_success_at: new Date(2026, 9, 26, 17, 30).toISOString() },
    policy,
    new Date(2026, 9, 26, 18, 0)
  );
  assert.equal(decision.due, false);
  assert.equal(decision.nextCheckAt.getTime(), new Date(2026, 9, 27, 17, 0).getTime());
});

test('the local timezone policy keeps the wall-clock slot across a DST change', (t) => {
  // Runs in a subprocess because TZ must be set before the process starts.
  const script = `
    const { evaluateUpdateCheck, latestScheduledSlot, resolveUpdatePolicy } = await import(${JSON.stringify(new URL('../src/update-policy.js', import.meta.url).href)});
    const policy = resolveUpdatePolicy({ check_after_local_time: '17:00', timezone: 'local' });
    const offsets = [new Date('2026-07-01T12:00:00Z').getTimezoneOffset(), new Date('2026-12-01T12:00:00Z').getTimezoneOffset()];
    // 2026-11-01 10:00 EST: the latest slot is 2026-10-31 17:00 EDT.
    const slot = latestScheduledSlot(new Date('2026-11-01T15:00:00Z'), policy).toISOString();
    const next = evaluateUpdateCheck({ last_success_at: '2026-10-31T21:30:00.000Z' }, policy, new Date('2026-11-01T15:00:00Z')).nextCheckAt.toISOString();
    process.stdout.write(JSON.stringify({ offsets, slot, next }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'America/New_York' }
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  if (output.offsets[0] !== 240 || output.offsets[1] !== 300) {
    t.skip('The TZ environment variable is not honored on this platform.');
    return;
  }
  assert.equal(output.slot, '2026-10-31T21:00:00.000Z');
  assert.equal(output.next, '2026-11-01T22:00:00.000Z');
});
