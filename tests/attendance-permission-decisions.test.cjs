const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('secretary can approve or reject and submission closes H-1', () => {
  const js=fs.readFileSync('dist/admin.js','utf8');
  const sql=fs.readFileSync('supabase/migrations/20261117031031_attendance_permission_decisions.sql','utf8');
  const edge=fs.readFileSync('supabase/functions/attendance-checkin/index.ts','utf8');
  assert.match(js,/data-permission-decision="approve"/);
  assert.match(js,/data-permission-decision="reject"/);
  assert.doesNotMatch(js,/data-toggle-permission/);
  assert.match(sql,/not public\.is_secretariat_admin\(\)/);
  assert.match(sql,/v_permission\.rejected_at is not null/);
  assert.match(sql,/v_permission\.approved_at is not null/);
  assert.match(edge,/return startsAt > now \+ 24 \* 60 \* 60 \* 1000 && startsAt <= now \+ permissionWindowMs/);
});
