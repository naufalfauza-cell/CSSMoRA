const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = file => readFileSync(join(__dirname, '..', file), 'utf8');
const admin = read('dist/admin.js');

test('daftar hadir dan CSV hanya menggunakan catatan anggota aktif', () => {
  const rows = [{ member_id: 'active' }, { member_id: 'inactive' }, { member_id: 'missing' }];
  const members = { active: { is_active: true }, inactive: { is_active: false } };
  const start = admin.indexOf('function activeAttendanceRoster()');
  const end = admin.indexOf("$('#attendance-roster').addEventListener('input'", start);
  const result = vm.runInNewContext(admin.slice(start, end) + 'activeAttendanceRoster()', {
    currentAttendanceRows: rows,
    memberById: id => members[id]
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].member_id, 'active');
  assert.equal(rows.length, 3);
  assert.match(admin, /const allRows=activeAttendanceRoster\(\)/);
  assert.match(admin, /#attendance-export[^]*?const rows=activeAttendanceRoster\(\)/);
});

test('cetak PDF memakai ringkasan, kolom, dan semua baris rekap aktif', () => {
  const recapRows = [{ full_name: 'Satu' }, { full_name: 'Dua' }];
  const summary = { innerHTML: '2 anggota aktif', removeAttribute() {} };
  const printRows = { innerHTML: '', removeAttribute() {} };
  const table = { tBodies: [printRows] };
  const select = {
    '#attendance-recap-card': { hidden: false },
    '#attendance-recap-summary': { cloneNode: () => summary },
    '#attendance-recap': { closest: () => ({ cloneNode: () => table }) }
  };
  let print;
  let cleanup;
  let isPrinted = false;
  let removed = false;
  const report = { append(...nodes) { this.nodes = nodes; }, remove() { removed = true; } };
  const start = admin.indexOf("attendanceRecapPrintButton.addEventListener('click'");
  const end = admin.indexOf('function attendanceStatusLabel(', start);
  vm.runInNewContext(admin.slice(start, end), {
    $: selector => select[selector],
    attendanceRecapRows: recapRows,
    attendanceRecapPrintButton: { disabled: false, addEventListener: (_, listener) => { print = listener; } },
    attendanceRecapTableRows: rows => rows.map(row => row.full_name).join(', '),
    escapeHTML: String,
    document: { createElement: () => report, body: { append: node => assert.equal(node, report) } },
    window: { print: () => { isPrinted = true; }, addEventListener: (_, listener) => { cleanup = listener; } }
  });
  print();
  assert.equal(isPrinted, true);
  assert.deepEqual(report.nodes, [summary, table]);
  assert.equal(printRows.innerHTML, 'Satu, Dua');
  assert.match(report.innerHTML, /Akumulasi kehadiran.*WIB/);
  cleanup();
  assert.equal(removed, true);
  assert.match(read('dist/admin.html'), /id="attendance-recap-print"[^>]*>Cetak PDF/);
  assert.match(read('dist/admin.css'), /@media print[\s\S]*#attendance-recap-printout thead\{display:table-header-group\}/);
});
