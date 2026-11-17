const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('leave requests remain available without automatic attendance or approval button', () => {
  const sql = fs.readFileSync('supabase/migrations/20261117030252_permission_without_auto_attendance.sql', 'utf8');
  const js = fs.readFileSync('dist/admin.js', 'utf8');
  assert.match(sql, /drop trigger if exists record_permission_in_attendance/);
  assert.match(sql, /r\.reason = p\.reason and r\.proof_path is null/);
  assert.match(js, /Surat diterima/);
  assert.doesNotMatch(js, /data-permission-approve/);
});
