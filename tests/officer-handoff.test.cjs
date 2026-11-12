const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const documents = fs.readFileSync(require.resolve('../dist/program-documents.js'), 'utf8');
const workflow = fs.readFileSync(require.resolve('../dist/program-workflow.js'), 'utf8');
const migration = fs.readFileSync(require.resolve('../supabase/migrations/20261112100000_approve_attendance_permission.sql'), 'utf8');

test('finance task advances only after Docs includes the saved verification', () => {
  const financeConfirmedAt = new Map();
  const context = () => ({userId: 'treasurer', roles: ['bendahara']});
  const src = documents.slice(documents.indexOf('  function nextDocumentAction('), documents.indexOf('  function renderDocumentTasks('));
  const next = vm.runInNewContext(src + '\nnextDocumentAction', {context, financeConfirmedAt, Date});
  const doc = {id:'lpj', created_by:'pic', status:'secretary_review', document_type:'lpj', optional_sections:{finance:true}, google_doc_generated_at:'2026-11-12T01:00:00Z'};
  assert.equal(next(doc).mine, true);
  financeConfirmedAt.set(doc.id, '2026-11-12T02:00:00Z');
  assert.match(next(doc).text, /Perbarui Google Docs/);
  assert.equal(next({...doc,google_doc_generated_at:'2026-11-12T03:00:00Z'}).mine, false);
});

test('new LPJs go through the document editor and legacy reviews can still finish', () => {
  assert.match(workflow, /editor\.openCycleLpj\(cycle\)/);
  assert.doesNotMatch(workflow, /data-cycle-submit/);
  assert.match(workflow, /rpc\/review_cssmora_program_lpj/);
  assert.match(migration, /new\.status = 'lpj_review' and old\.status is distinct/);
});

test('permission approval is role-checked and does not overwrite attendance evidence', () => {
  assert.match(migration, /not public\.is_secretariat_admin\(\)/);
  assert.match(migration, /where id = p_permission_id for update/);
  assert.match(migration, /status in \('belum', 'alpa'\) and proof_path is null/);
  assert.match(migration, /if not found then[\s\S]+update public\.secretariat_attendance_permissions/);
});
