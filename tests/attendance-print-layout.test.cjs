const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = file => fs.readFileSync(require.resolve('../dist/' + file), 'utf8');

test('cetak dari browser hanya menyiapkan laporan saat akumulasi terlihat', () => {
  const js = read('admin.js');
  const handler = js.slice(js.indexOf("window.addEventListener('beforeprint'"), js.indexOf('function prepareAttendanceRecapPrint'));
  let beforePrint;
  let hiddenAncestor = {};
  let count = 0;
  vm.runInNewContext(handler, {
    window: { addEventListener: (_, fn) => { beforePrint = fn; } },
    $: () => ({ closest: selector => { assert.equal(selector, '[hidden]'); return hiddenAncestor; } }),
    prepareAttendanceRecapPrint: () => count++
  });
  beforePrint();
  assert.equal(count, 0);
  hiddenAncestor = null;
  beforePrint();
  assert.equal(count, 1);
});

test('cetak rekap memakai ukuran contoh dan menyembunyikan panel lain', () => {
  const css = read('admin.css');
  assert.match(css, /@page attendance-recap\s*\{\s*size:\s*letter landscape/i);
  assert.match(css, /:not\(#attendance-recap-printout\)\{display:none!important\}/);
});
