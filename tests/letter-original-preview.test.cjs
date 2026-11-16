const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', 'dist', name), 'utf8');
test('original PDF opens the read-only canvas and only signed PDFs trigger a download', () => {
  const js = read('letter-signatures.js');
  assert.match(js, /data-preview-original="1"/);
  assert.doesNotMatch(js, /data-download="original"/);
  assert.match(js, /button\.dataset\.previewOriginal\) await showViewer\(item,true\)/);
  assert.match(js, /button\.dataset\.download==='signed'[\s\S]*anchor\.download/);
  assert.match(js, /if \(readOnly\) \{\s*await renderPage\(\);[\s\S]*?return;\s*\}\s*await Promise\.all\(\[loadMark/);
  assert.match(js, /if \(\$\('#letter-sign-dialog'\)\.classList\.contains\('is-read-only'\)\) return/);
  assert.match(read('letter-signatures.css'), /\.letter-sign-controls\[hidden\]\{display:none\}/);
});
