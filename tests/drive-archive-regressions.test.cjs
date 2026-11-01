const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('expired attendance photos are archived before Supabase Storage deletion', () => {
  const source = read('supabase/functions/attendance-checkin/index.ts');
  const cleanup = source.slice(source.indexOf('async function cleanExpiredAttendancePhotos'), source.indexOf('\nasync function archiveAttendancePhoto'));
  assert.ok(cleanup.indexOf('archiveAttendancePhotos(') >= 0);
  assert.ok(cleanup.indexOf('archiveAttendancePhotos(') < cleanup.indexOf('storage.removeMany('));
  assert.match(cleanup, /limit:\s*"5"/);
  assert.match(cleanup, /Foto sumber tetap tersimpan di Supabase/);
});

test('manual attendance deletion archives all proofs before removing files and event rows', () => {
  const source = read('supabase/functions/attendance-checkin/index.ts');
  const deletion = source.slice(source.indexOf('async function deleteAttendanceEvent'), source.indexOf('\nasync function ' , source.indexOf('async function deleteAttendanceEvent') + 10));
  assert.ok(deletion.indexOf('archiveAttendancePhotos(') >= 0);
  assert.ok(deletion.indexOf('archiveAttendancePhotos(') < deletion.indexOf('storage.removeMany('));
  assert.ok(deletion.indexOf('storage.removeMany(') < deletion.indexOf('method: "DELETE"'));
});

test('Drive archive endpoint is server-only and stores permanent archive metadata', () => {
  const source = read('supabase/functions/drive-integration/index.ts');
  assert.match(source, /function requireInternalServiceRole/);
  assert.match(source, /request\.headers\.get\("authorization"\) !== "Bearer " \+ SERVICE_ROLE_KEY/);
  assert.match(source, /action === "archive_attendance_photo"/);
  assert.match(source, /cssmora_drive_archives\?on_conflict=bucket_id,object_path/);
  assert.match(source, /cssmoraAttendanceEventId/);
  assert.match(source, /cssmoraAttendancePathHash/);
});

test('app deletes storage-backed agenda assets before removing their records', () => {
  const source = read('dist/admin.js');
  const deleteProgramStart = source.indexOf("if(button.dataset.programAction==='delete')");
  const deleteProgram = source.slice(deleteProgramStart, source.indexOf('\n});', deleteProgramStart));
  assert.ok(deleteProgram.indexOf('deleteProgramPhoto(') < deleteProgram.indexOf("method:'DELETE'"));
  const deleteAgenda = source.slice(source.indexOf("if(button.dataset.agendaAction==='delete'"), source.indexOf("attendanceEventList.addEventListener", source.indexOf("if(button.dataset.agendaAction==='delete'")));
  assert.ok(deleteAgenda.indexOf('deleteAttendanceEvent(') < deleteAgenda.indexOf("agenda?id=eq."));
});

test('attendance Drive archive records are private and service-role-only', () => {
  const sql = read('supabase/migrations/20261101175943_drive_attendance_photo_archive.sql');
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on public\.cssmora_drive_archives from public, anon, authenticated/i);
  assert.match(sql, /grant all on public\.cssmora_drive_archives to service_role/i);
  assert.match(sql, /check \(bucket_id = 'attendance-proofs'\)/i);
});

test('all app storage buckets, including program documentation, queue Drive upserts and deletes', () => {
  const migration = read('supabase/migrations/20261029170000_proposal_lpj_documents.sql');
  const triggers = read('supabase/migrations/20261029150000_google_drive_mirroring_and_backup.sql');
  for (const bucket of [
    'attendance-proofs',
    'cssmora-achievement-certificates',
    'cssmora-agenda-programs',
    'cssmora-letter-pdfs',
    'cssmora-prestasi-proofs',
    'cssmora-program-documentation',
    'cssmora-signer-assets',
    'posters',
  ]) assert.ok(migration.includes(bucket), `${bucket} should be mirrored`);
  assert.match(triggers, /after insert or update on storage\.objects/i);
  assert.match(triggers, /after delete on storage\.objects/i);
});
