const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const js = fs.readFileSync('dist/admin.js', 'utf8');
const html = fs.readFileSync('dist/admin.html', 'utf8');
const sql = fs.readFileSync('supabase/migrations/20261117072225_archive_attendance_permission_review.sql', 'utf8');
test('reviewed requests can be archived without removing attendance or evidence', () => {
  assert.match(sql, /auth\.uid\(\) is null or not public\.is_secretariat_admin\(\)/);
  assert.match(sql, /approved_at is not null or rejected_at is not null/);
  assert.doesNotMatch(sql, /\bdelete\b/i);
  assert.match(js, /review_archived_at=is\.null/);
  assert.match(js, /review_archived_at=not\.is\.null/);
  assert.match(js, /reviewed\?` <button type="button" data-permission-archive/);
  assert.match(js, /row\.letter_deleted_at/);
  assert.match(html, /Riwayat pengajuan yang diarsipkan/);
});
