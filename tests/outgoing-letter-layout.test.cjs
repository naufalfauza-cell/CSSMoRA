const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const read = name => readFileSync(join(__dirname, '../dist', name), 'utf8');

test('outgoing letters show the composer and drafts before the register and collapse manual numbering', () => {
  const html = read('admin.html');
  const panel = html.slice(html.indexOf('id="letter-register-panel"'), html.indexOf('id="letter-signature-panel"'));
  assert.match(panel, /id="outgoing-letter-composer"[\s\S]+id="outgoing-draft-form"[\s\S]+id="outgoing-draft-list"[\s\S]+id="letter-record-list"[\s\S]+<details class="editor-card letter-editor-card"[\s\S]+id="letter-form"/);
  assert.match(panel, /class="secretariat-record-list letter-record-list" id="letter-record-list"/);
  assert.match(read('admin.css'), /@media \(max-width: 920px\)\s*\{\s*#outgoing-letter-composer \{ grid-template-columns: minmax\(0, 1fr\)/);
});

test('the wallet theme overrides the legacy active sidebar icon with equal specificity', () => {
  assert.match(read('wallet-theme.css'), /body\.admin-page \.admin-sidebar \.admin-tabs\.module-grid \.admin-tab\.is-active \.module-icon\{\s*background:#b8eef4/);
});
