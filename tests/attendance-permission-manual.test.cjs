const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('leave requests require secretary decisions before attendance changes', () => {
  const previous = fs.readFileSync('supabase/migrations/20261117030252_permission_without_auto_attendance.sql', 'utf8');
  const sql = fs.readFileSync('supabase/migrations/20261117031031_attendance_permission_decisions.sql', 'utf8');
  const js = fs.readFileSync('dist/admin.js', 'utf8');
  assert.match(previous, /drop trigger if exists record_permission_in_attendance/);
  assert.match(sql, /not public\.is_secretariat_admin\(\)/);
  assert.match(sql, /set status='izin',reason=v_permission\.reason/);
  assert.match(sql, /create function public\.reject_cssmora_attendance_permission/);
  assert.match(js, /data-permission-decision="approve"/);
  assert.match(js, /data-permission-decision="reject"/);
});
