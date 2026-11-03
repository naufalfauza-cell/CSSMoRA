const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('incoming letter records and internal Drive metadata have separate RLS boundaries', () => {
  const sql = read('supabase/migrations/20261103050000_secretariat_incoming_letters.sql');
  assert.match(sql, /create table public\.secretariat_incoming_letters/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /Secretariat roles read incoming letters/i);
  assert.match(sql, /Secretary manages incoming letters/i);
  assert.match(sql, /revoke all on public\.cssmora_drive_incoming_letter_sync from public, anon, authenticated/i);
  assert.match(sql, /grant all on public\.cssmora_drive_incoming_letter_sync to service_role/i);
  assert.match(sql, /require_incoming_letter_pdf_removed_before_delete/i);
});

test('the incoming letter table is backed up without dropping previous proposal and LPJ tables', () => {
  const sql = read('supabase/migrations/20261103050000_secretariat_incoming_letters.sql');
  for (const table of [
    'secretariat_incoming_letters',
    'cssmora_program_document_budget_items',
    'cssmora_program_document_committee',
    'cssmora_program_document_finance',
    'cssmora_program_document_photos',
    'cssmora_program_document_reviews',
    'cssmora_program_documents',
  ]) assert.match(sql, new RegExp(`'${table}'\\s*,\\s*coalesce`, 'i'));
});

test('incoming PDF upload stays private and storage is deleted before its record', () => {
  const sql = read('supabase/migrations/20261103050000_secretariat_incoming_letters.sql');
  const app = read('dist/admin.js');
  assert.match(sql, /bucket_id = 'cssmora-letter-pdfs'/i);
  assert.match(sql, /storage_path ~ \('\^incoming\/' \|\| id::text \|\| '\/original\\.pdf\$'\)/i);
  const deletion = app.slice(app.indexOf("const remove=event.target.closest('[data-incoming-delete]')"), app.indexOf("$('#incoming-letter-list').addEventListener('submit'"));
  assert.ok(deletion.indexOf("method:'DELETE'") < deletion.lastIndexOf("method:'DELETE'"));
  assert.ok(deletion.includes('/storage/v1/object/cssmora-letter-pdfs/'));
  assert.ok(deletion.indexOf('/storage/v1/object/cssmora-letter-pdfs/') < deletion.lastIndexOf("method:'DELETE'"));
});

test('AI OCR is secretary-only, deletes its temporary Google Doc, and rejects invalid dates', () => {
  const assistant = read('supabase/functions/program-document-assistant/index.ts');
  const drive = read('supabase/functions/drive-integration/index.ts');
  const actionStart = assistant.indexOf('if(action==="analyze_incoming_letter")');
  const action = assistant.slice(actionStart, assistant.indexOf('\n    if(!["generate_ai"', actionStart));
  assert.match(action, /roles\.includes\("sekretaris"\)/);
  assert.match(action, /extract_incoming_letter_text/);
  assert.match(action, /parsed\.toISOString\(\)\.slice\(0,10\)===raw/);
  const extraction = drive.slice(drive.indexOf('async function extractIncomingLetterText'), drive.indexOf('\nasync function archiveAttendancePhoto'));
  assert.match(extraction, /ocrLanguage/);
  assert.match(extraction, /attempt < 8/);
  assert.match(extraction, /finally\s*\{\s*await deleteDriveFile\(accessToken, temporaryDocId\)/);
});

test('Drive synchronization updates the incoming PDF links and complete sheet in date order', () => {
  const drive = read('supabase/functions/drive-integration/index.ts');
  const sync = drive.slice(drive.indexOf('async function syncIncomingLettersSpreadsheet'), drive.indexOf('\nasync function findDriveArchiveFile'));
  assert.match(sync, /Range-Unit.*items/);
  assert.match(sync, /received_on\.desc,created_at\.desc,id\.desc/);
  assert.match(sync, /values\//);
  assert.match(sync, /original_filename/);
  assert.ok(drive.includes(String.raw`objectPath.match(/^incoming\/([0-9a-f-]{36})\/original\.pdf$/i)`));
  assert.match(drive, /drive_url: "https:\/\/drive\.google\.com\/file\/d\//);
});

test('only Secretary sees incoming-letter correction actions, with a responsive card layout on phones', () => {
  const app = read('dist/admin.js');
  const html = read('dist/admin.html');
  const css = read('dist/letter-inbox.css');
  assert.match(app, /const editControls=isSecretariatAdmin\?/);
  assert.match(app, /const editForm=isSecretariatAdmin\?/);
  assert.match(app, /!data\.connected\?'Drive belum tersambung/);
  assert.match(html, /id="letter-incoming-panel"/);
  assert.match(css, /@media\(max-width:560px\)/);
  assert.match(css, /data-label/);
});
