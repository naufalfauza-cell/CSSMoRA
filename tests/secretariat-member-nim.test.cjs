const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('the member list displays and searches NIM while allowing members without a NIM', () => {
  const html = readFileSync(join(__dirname, '../dist/admin.html'), 'utf8');
  const js = readFileSync(join(__dirname, '../dist/admin.js'), 'utf8');
  assert.match(html, /id="member-search"[^>]*placeholder="Cari nama, NIA, atau NIM…"/);
  assert.match(js, /queryMatches=!query\|\|\[member\.nia,member\.nim,/);
  assert.match(js, /member\.nim\?'<small>NIM '\+escapeHTML\(member\.nim\)/);
});
