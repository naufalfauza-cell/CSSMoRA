const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('permission window includes H-7 and closes exactly at H-1, unless reopened', () => {
  const source = fs.readFileSync('supabase/functions/attendance-checkin/index.ts', 'utf8');
  const condition = source.match(/return row\.permission_reopened \|\| \(startsAt > now \+ 24 \* 60 \* 60 \* 1000 && startsAt <= now \+ permissionWindowMs\);/);
  assert.ok(condition);
  const predicate = new Function('row', 'startsAt', 'now', 'permissionWindowMs', condition[0]);
  const day = 86400000;
  assert.equal(predicate({}, 7 * day, 0, 7 * day), true);
  assert.equal(predicate({}, 7 * day + 1, 0, 7 * day), false);
  assert.equal(predicate({}, day + 1, 0, 7 * day), true);
  assert.equal(predicate({}, day, 0, 7 * day), false);
  assert.equal(predicate({permission_reopened:true}, -day, 0, 7 * day), true);
  const sql = fs.readFileSync('supabase/migrations/20261117024157_permission_window.sql', 'utf8');
  assert.match(sql, /e\.permission_reopened or \(a\.starts_at > clock_timestamp\(\) \+ interval '1 day'/);
  assert.match(sql, /a\.status = 'published'/);
});
