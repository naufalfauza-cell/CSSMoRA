const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const test = require('node:test');

test('rekap cetak memakai baris rapat dan mempertahankan kolom jumlah serta persentase izin', () => {
  const css = readFileSync(require.resolve('../dist/admin.css'), 'utf8');
  const html = readFileSync(require.resolve('../dist/admin.html'), 'utf8');
  const js = readFileSync(require.resolve('../dist/admin.js'), 'utf8');
  assert.match(css, /#attendance-recap-printout :is\(th,td\)\{\s*padding:2px 7px;line-height:1\.15/);
  assert.match(css, /#attendance-recap-printout \.attendance-rate-track\{display:none\}/);
  assert.match(html, /<th>Persentase hadir<\/th><th>Jumlah dan % izin<\/th>/);
  assert.match(js, /izinCount\+' kali · '\+izinPercent\+'%/);
});
