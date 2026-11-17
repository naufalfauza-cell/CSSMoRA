const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('permission window includes H-7 and closes exactly at H-1', () => {
  const source = fs.readFileSync('supabase/functions/attendance-checkin/index.ts', 'utf8');
  const condition = source.match(/return startsAt > now \+ 24 \* 60 \* 60 \* 1000 && startsAt <= now \+ permissionWindowMs;/);
  assert.ok(condition);
  const predicate = new Function('startsAt', 'now', 'permissionWindowMs', condition[0]);
  const day = 86400000;
  assert.equal(predicate(7 * day, 0, 7 * day), true);
  assert.equal(predicate(7 * day + 1, 0, 7 * day), false);
  assert.equal(predicate(day + 1, 0, 7 * day), true);
  assert.equal(predicate(day, 0, 7 * day), false);
  assert.equal(predicate(-day, 0, 7 * day), false);
  const sql = fs.readFileSync('supabase/migrations/20261117031031_attendance_permission_decisions.sql', 'utf8');
  assert.match(sql, /a\.starts_at > clock_timestamp\(\) \+ interval '1 day'/);
  assert.match(sql, /a\.status='published'/);
});
