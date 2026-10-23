const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('shared browser requests fail promptly when the service stops responding', async () => {
  const context = {
    window: {},
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: (_input, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })
  };
  vm.runInNewContext(read('dist/supabase-config.js'), context);
  await assert.rejects(
    context.window.cssmoraFetch('/slow', {}, 5),
    /Layanan terlalu lama merespons/
  );
});

test('public agenda requests are month-bounded and fetch proker details through the agenda relation', () => {
  const page = read('dist/agenda-page.js');
  const home = read('dist/agenda.js');
  assert.match(page, /starts_at:'lt\.'\+nextMonthStart/);
  assert.match(page, /ends_at\.gte\.\'\+monthStart/);
  assert.match(page, /program:agenda_programs\(id,name,photo_url\)/);
  assert.match(page, /limit:'250'/);
  assert.doesNotMatch(page, /limit:'1000'/);
  assert.match(home, /program:agenda_programs\(id,name,photo_url\)/);
  assert.doesNotMatch(home, /programsQuery/);
});

test('active attendance uses one bounded agenda join and returns a retryable service error', () => {
  const source = read('supabase/functions/attendance-checkin/index.ts');
  const activeLookup = source.slice(source.indexOf('async function getActiveEvents'), source.indexOf('\nasync function deleteAttendanceEvent'));
  assert.match(activeLookup, /agenda!inner\(id\)/);
  assert.match(activeLookup, /"agenda\.status": "eq\.published"/);
  assert.match(activeLookup, /AbortSignal\.timeout\(8000\)/);
  assert.doesNotMatch(activeLookup, /\/rest\/v1\/agenda\?/);
  assert.match(activeLookup, /}, 503\)/);
});

test('attendance refreshes pause in hidden tabs and the admin roster does not poll every five seconds', () => {
  const admin = read('dist/admin.js');
  const checkin = read('dist/absen.js');
  const dashboard = read('dist/attendance-dashboard.js');
  assert.match(admin, /setInterval\(\(\)=>\{if\(!document\.hidden&&!\$\('#attendance-tools-panel'\)\.hidden\)void refreshOpenAttendanceRoster\(\);\},15000\)/);
  assert.doesNotMatch(admin, /refreshOpenAttendanceRoster\(\);\},5000\)/);
  assert.match(checkin, /if \(!document\.hidden\) void refreshActiveEvents\(true\)/);
  assert.match(dashboard, /if \(!document\.hidden\) void refreshAttendanceEntry\(\)/);
});

test('large first-screen assets stay within the performance budgets', () => {
  const size = file => fs.statSync(path.join(root, file)).size;
  assert.ok(size('dist/assets/unair-campus-loop.mp4') < 1_600_000);
  assert.ok(size('dist/assets/cssmora-logo.png') < 70_000);
  assert.ok(size('dist/assets/cssmora-logo.webp') < 150_000);
  assert.ok(size('dist/assets/kemenag-lpdp-logo.png') < 50_000);
});
