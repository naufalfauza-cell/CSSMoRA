const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'dist/program-documents.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'dist/admin.html'), 'utf8');
const submission = client.match(/async function submitDocument\(\)\s*\{([\s\S]*?)\n  \}\n  async function reviewDocument/);

test('program document submission sends the existing generated Google Doc without rebuilding it', () => {
  assert.ok(submission, 'submission handler should exist');
  assert.match(submission[1], /rpc\/submit_cssmora_program_document/);
  assert.doesNotMatch(submission[1], /assistant\(/);
  assert.match(submission[1], /Isi dokumen yang sama akan dikirim tanpa dibuat ulang/);
});

test('submission waits for a current document and blocks after unsaved edits', () => {
  assert.match(client, /function documentReadyForSubmission\(\)\{return Boolean\(current\?\.google_doc_id&&current\?\.google_doc_generated_at&&current\?\.ai_content\?\.generated_at&&!formDirty&&!subrecordsDirty\);\}/);
  assert.match(client, /submitButton\.textContent=submitReady\?'Ajukan saja':current\?\.google_doc_id\?'Perbarui Docs dulu':'Buat Docs dulu'/);
  assert.match(client, /Ada perubahan yang belum masuk ke Google Docs/);
});

test('AI and Google Docs requests get timeouts that match their longer server work', () => {
  assert.match(client, /const timeoutMs=action==='create_doc'\?90000:action==='generate_ai'\?60000:15000/);
  assert.match(client, /Pembuatan Docs belum memberi jawaban\. Muat ulang dokumen/);
});

test('admin UI tells the PIC to create Docs before submission and refreshes the JS asset', () => {
  assert.match(html, /program-documents\.js\?v=20261030-submit-existing-doc-v1/);
  assert.match(html, /id="program-document-submit" type="button" disabled>Buat Docs dulu/);
  assert.match(html, /membuat Google Docs, lalu mengajukan dokumen yang sama/);
});
