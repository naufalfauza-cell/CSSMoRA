const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../dist/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(__dirname, '../dist/admin.js'), 'utf8');
const signatureJs = fs.readFileSync(path.join(__dirname, '../dist/letter-signatures.js'), 'utf8');

test('letter number register and signature requests use separate accessible tabs', () => {
  assert.match(html, /id="tab-letter-register"[^>]*aria-controls="letter-register-panel"/);
  assert.match(html, /id="tab-letter-signatures"[^>]*aria-controls="letter-signature-panel"/);
  assert.match(html, /id="letter-register-panel"[^>]*role="tabpanel"/);
  assert.match(html, /id="letter-signature-panel"[^>]*role="tabpanel"[^>]*hidden/);
  assert.match(adminJs, /document\.querySelectorAll\('\.letter-work-tab'\)/);
  assert.doesNotMatch(adminJs, /data-request-letter/);
});

test('signature save immediately places the freshly uploaded mark and allows larger sizing', () => {
  assert.match(html, /id="letter-sign-size"[^>]*max="70"[^>]*value="38"/);
  assert.match(signatureJs, /await useLocalMark\('signature',blob\);\s*if\(pdfDocument\)place\('signature'\)/);
  assert.match(signatureJs, /await upload\(assetBucket,assetPath\('signature'\),blob,true\)/);
});

test('raw signature drawing and asset controls remain inside the designated signer dialog', () => {
  const dialogStart = html.indexOf('<dialog id="letter-sign-dialog"');
  const dialogEnd = html.indexOf('</dialog>', dialogStart);
  assert.ok(dialogStart >= 0 && dialogEnd > dialogStart);
  const dialog = html.slice(dialogStart, dialogEnd);
  assert.match(dialog, /id="letter-sign-pad"/);
  assert.match(dialog, /id="letter-sign-image-file"/);
  assert.match(signatureJs, /if \(!isLeadership \|\| item\.signer_id!==userId \|\| item\.status!=='pending'\) return/);
});
