const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const root = path.join(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'supabase/functions/drive-integration/index.ts'), 'utf8');

function loadWorkerFunction(name, following, globals) {
  const start = workerSource.indexOf(name);
  const end = workerSource.indexOf(following, start);
  assert.ok(start >= 0 && end > start, `Unable to locate ${name}`);
  return vm.runInNewContext(stripTypeScriptTypes('(' + workerSource.slice(start, end).trim() + ')', { mode: 'strip' }), globals);
}

test('attendance sheet adds one column per event and mirrors approved and pending permissions', async () => {
  const updateRequests = [];
  let clearedRanges = [];
  let syncError = '';
  let syncState = { spreadsheet_id: 'sheet-id', generation: 4, pending: true, attempts: 0 };
  const grid = {
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id/edit',
    sheets: [{ properties: { sheetId: 42, title: 'Rekap Presensi', gridProperties: { rowCount: 30, columnCount: 38 } } }],
  };
  const tables = {
    secretariat_members: [
      { id: 'm1', full_name: 'A Member', nim: '001', cohort: 2026 },
      { id: 'm2', full_name: 'B Member', nim: '002', cohort: 2025 },
      { id: 'm3', full_name: 'C Member', nim: '003', cohort: 2024 },
    ],
    secretariat_attendance_events: [
      { id: 'e1', agenda_id: 'a1', event_date: '2026-11-14', title: 'Agenda lalu' },
      { id: 'e2', agenda_id: 'a2', event_date: '2026-11-21', title: 'Agenda berikutnya' },
    ],
    agenda: [
      { id: 'a1', title: 'Agenda lalu', starts_at: '2026-11-14T01:00:00Z', ends_at: null, status: 'published' },
      { id: 'a2', title: 'Agenda berikutnya', starts_at: '2026-11-21T01:00:00Z', ends_at: null, status: 'published' },
    ],
    secretariat_attendance_records: [
      { event_id: 'e1', member_id: 'm1', status: 'hadir' },
      { event_id: 'e2', member_id: 'm1', status: 'izin' },
      { event_id: 'e1', member_id: 'm2', status: 'alpa' },
      { event_id: 'e2', member_id: 'm2', status: 'belum' },
    ],
    secretariat_attendance_permissions: [
      { agenda_id: 'a2', member_id: 'm1', approved_at: '2026-11-16T00:00:00Z', rejected_at: null },
      { agenda_id: 'a2', member_id: 'm2', approved_at: null, rejected_at: null },
    ],
  };
  class FixedDate extends Date {
    static now() { return Date.parse('2026-11-17T00:00:00Z'); }
  }
  const context = {
    AppError: class AppError extends Error { constructor(status, message) { super(message); this.status = status; } },
    Date: FixedDate,
    loadAllServiceRows: async table => tables[table] || [],
    serviceRequest: async (url, options = {}) => {
      if (url.startsWith('cssmora_drive_attendance_recap_sync?select=')) return { data: [{ ...syncState }] };
      if (options.method === 'PATCH') { syncState = { ...syncState, ...options.body }; return { data: [syncState] }; }
      throw new Error(`Unexpected service request: ${url}`);
    },
    googleJson: async (_token, url, options = {}) => {
      if (url.includes('?fields=')) return { data: grid };
      if (url.includes('/values:batchClear')) { clearedRanges = options.body.ranges; return { data: {} }; }
      if (url.endsWith(':batchUpdate')) { updateRequests.push(...options.body.requests); return { data: {} }; }
      throw new Error(`Unexpected Sheets request: ${url}`);
    },
    safeSyncError: error => { syncError = String(error); return 'sync error'; },
  };
  context.attendanceSheetColumn = loadWorkerFunction('function attendanceSheetColumn(', 'function attendanceSheetDateSerial(', context);
  context.attendanceSheetDateSerial = loadWorkerFunction('function attendanceSheetDateSerial(', 'async function syncAttendanceRecapSpreadsheet(', context);
  const sync = loadWorkerFunction('async function syncAttendanceRecapSpreadsheet(', 'async function findDriveArchiveFile(', context);
  const result = await sync('access-token');

  assert.equal(result.pending, false, syncError);
  assert.equal(result.rows, 3);
  assert.equal(result.events, 2);
  assert.equal(result.completedEventCount, 1);
  assert.equal(syncState.pending, false);
  assert.deepEqual(Array.from(clearedRanges), ["'Rekap Presensi'!A1:AL30"]);

  const header = updateRequests.find(request => request.updateCells?.range?.startRowIndex === 2).updateCells.rows[0].values;
  assert.deepEqual(Array.from(header, cell => cell.userEnteredValue?.stringValue || ''), [
    'NO', 'NAMA', 'NIM', 'ANGKATAN', 'Agenda lalu', 'Agenda berikutnya', '', 'Akumulasi', 'Izin (kali)', 'Izin (%)',
  ]);
  const body = updateRequests.find(request => request.updateCells?.range?.startRowIndex === 4).updateCells.rows;
  const value = cell => cell.userEnteredValue?.stringValue ?? cell.userEnteredValue?.numberValue ?? null;
  assert.deepEqual(Array.from(body[0].values, value), [1, 'A Member', '001', 2026, 'Hadir', 'Izin', null, 1, 1, 0.5]);
  assert.deepEqual(Array.from(body[1].values, value), [2, 'B Member', '002', 2025, 'Tanpa Keterangan', 'Menunggu izin', null, 0, 0, 0]);
  assert.deepEqual(Array.from(body[2].values.slice(4, 7), value), ['—', '—', null]);
  assert.ok(updateRequests.some(request => request.repeatCell?.cell?.userEnteredFormat?.numberFormat?.pattern === '0.00%'));
});

test('attendance sheet sync queue covers members, events, attendance, and permission decisions', () => {
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261117091931_attendance_recap_sheet_sync.sql'), 'utf8');
  for (const table of [
    'secretariat_attendance_records',
    'secretariat_attendance_permissions',
    'secretariat_attendance_events',
    'public.agenda',
    'secretariat_members',
  ]) {
    assert.match(migration, new RegExp(`after insert or update or delete on public\\.${table.replace('public.', '')}`));
  }
  assert.match(migration, /enable row level security/);
  assert.match(migration, /grant all on public\.cssmora_drive_attendance_recap_sync to service_role/);
});
