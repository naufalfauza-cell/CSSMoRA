const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('rekap proker menghitung hadir, izin, dan gabungannya dari total roster', () => {
  const source = fs.readFileSync(path.join(__dirname, '../dist/program-workflow.js'), 'utf8');
  const recapList = {};
  const document = {
    querySelector: selector => selector === '#program-cycle-recap-list'
      ? recapList
      : { addEventListener() {} },
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const context = vm.createContext({ document, window: {} });
  const harness = `
    window.renderAttendanceRecap = rows => {
      currentCycle = {};
      recap = rows;
      renderRecap();
    };
  `;
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, harness + '})();'), context);

  const row = { agenda_title: 'Pelantikan', eligible_count: 3, present_count: 1, permission_count: 1 };
  context.window.renderAttendanceRecap([row]);
  assert.match(recapList.innerHTML, /3 data absensi/);
  assert.match(recapList.innerHTML, /Hadir 1 · 33%/);
  assert.match(recapList.innerHTML, /Izin 1 · 33%/);
  assert.match(recapList.innerHTML, /Hadir \+ Izin 67%/);

  context.window.renderAttendanceRecap([{ ...row, permission_count: 0 }]);
  assert.match(recapList.innerHTML, /Izin 0 · 0%/);
  assert.match(recapList.innerHTML, /Hadir \+ Izin 33%/);

  context.window.renderAttendanceRecap([{ ...row, permission_count: undefined }]);
  assert.match(recapList.innerHTML, /Hadir \+ Izin —/);

  context.window.renderAttendanceRecap([{ ...row, eligible_count: 0, present_count: 0, permission_count: 0 }]);
  assert.match(recapList.innerHTML, /Belum ada data absensi/);
});
