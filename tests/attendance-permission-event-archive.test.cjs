const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const js = fs.readFileSync('dist/admin.js', 'utf8');
const sql = fs.readFileSync('supabase/migrations/20261117072621_archive_attendance_permissions_by_event.sql', 'utf8');
test('archive groups requests by agenda and requires every request to be reviewed', () => {
  assert.match(js, /groups\.get\(key\)\.push\(row\)/);
  assert.match(js, /group\.every\(row=>row\.approved_at\|\|row\.rejected_at\)/);
  assert.match(js, /p_agenda_id:archive\.dataset\.permissionArchive/);
  assert.match(sql, /where agenda_id = p_agenda_id and review_archived_at is null/);
  assert.match(sql, /approved_at is null and rejected_at is null/);
  assert.match(sql, /not public\.is_secretariat_admin\(\)/);
  assert.doesNotMatch(sql, /\bdelete\b/i);
});
