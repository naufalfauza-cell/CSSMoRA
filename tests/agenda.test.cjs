const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../dist/agenda.js'), 'utf8');

async function run(rows, { now = '2026-11-10T03:00:00Z', fail = false, cache = null } = {}) {
  const instant = Date.parse(now);
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  }
  const timers = [],activeTimers=new Set();
  let requested;
  const fakeNode = () => ({ classList: { toggle() {} }, addEventListener() {}, setAttribute() {}, removeAttribute() {}, dataset: {} });
  const box = {
    innerHTML: '', addEventListener() {},
    querySelector(selector) { return selector === '.event-position' ? { textContent: '' } : null; },
    querySelectorAll(selector) {
      const count = selector === '.event-item' || selector === '.event-photo'
        ? (this.innerHTML.match(/<article class="event-item/g) || []).length
        : selector === '[data-slide]'
          ? (this.innerHTML.match(/data-slide="/g) || []).length
          : selector === '.event-arrow' ? (this.innerHTML.match(/class="event-arrow"/g) || []).length : 0;
      return Array.from({ length: count }, fakeNode);
    }
  };
  const context = {
    document: { getElementById: () => box, querySelector: () => null },
    window: { CSSMORA_SUPABASE: { url: 'https://example.invalid', publishableKey: 'test' } },
    Date: FixedDate, Intl, URLSearchParams,
    localStorage: { getItem: () => cache ? JSON.stringify(cache) : null, setItem() {} },
    console: { error() {} },
    setInterval: (callback, interval) => { timers.push(interval); activeTimers.add(timers.length); return timers.length; },
    clearInterval(id) {activeTimers.delete(id);},
    fetch: async url => {
      const requestUrl = new URL(url);
      if (requestUrl.pathname.endsWith('/agenda')) requested = requestUrl;
      if (requestUrl.pathname.endsWith('/agenda_programs')) return { ok: !fail, status: fail ? 503 : 200, json: async () => [] };
      const params = requestUrl.searchParams;
      const query = params.get('or');
      const endCutoff = Date.parse(query.match(/ends_at\.gte\.([^)]+)/)[1]);
      const startCutoff = Date.parse(query.match(/starts_at\.gte\.([^,)]+)/)[1]);
      // Emulate the predicates sent to PostgREST, including server-side limit.
      const selected = rows.filter(row => row.status === 'published' &&
        (row.ends_at ? Date.parse(row.ends_at) >= endCutoff : Date.parse(row.starts_at) >= startCutoff))
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
        .slice(0, Number(params.get('limit')));
      return { ok: !fail, status: fail ? 503 : 200, json: async () => selected };
    }
  };
  vm.runInNewContext(source, context, { timeout: 1000 });
  await new Promise(setImmediate);
  return { html: box.innerHTML, requested, timers, activeTimers: [...activeTimers] };
}

(async () => {
  const event = (title, starts_at, ends_at = null) => ({ title, starts_at, ends_at, status: 'published' });
  const multi = await run([event('Acara lintas hari', '2026-11-08T02:00:00Z', '2026-11-11T10:00:00Z')]);
  assert.match(multi.html, /Acara lintas hari/);
  assert.match(multi.html, /8 Nov/);
  assert.match(multi.html, /11 Nov/);
  assert.match(multi.html, /sampai/);

  const expired = Array.from({ length: 20 }, (_, i) => event(`Kemarin ${i}`, '2026-11-09T03:00:00Z'));
  const upcoming = await run([...expired, event('Agenda berikutnya', '2026-11-11T03:00:00Z')]);
  assert.match(upcoming.html, /Agenda berikutnya/);
  assert.doesNotMatch(upcoming.html, /Kemarin/);
  assert.equal(upcoming.requested.searchParams.get('limit'), '6');
  assert.equal(upcoming.requested.pathname, '/rest/v1/agenda');
  assert.match(upcoming.requested.searchParams.get('or'), /starts_at\.gte\.2026-11-10T00:00:00[+]07:00/);

  const sameDay = await run([event('Tanpa jam selesai', '2026-11-10T04:00:00Z')]);
  assert.match(sameDay.html, /Tanpa jam selesai/);
  const midnight = await run([event('Sudah kemarin', '2026-11-10T03:00:00Z')], { now: '2026-11-10T17:00:00Z' });
  assert.match(midnight.html, /Belum ada agenda mendatang/);

  const escaped = await run([{ ...event('<script>alert(1)</script>', '2026-11-11T03:00:00Z'), location: '<img src=x>' }]);
  assert.match(escaped.html, /&lt;script&gt;/);
  assert.match(escaped.html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(escaped.html, /<script>/);

  const empty = await run([{ ...event('Draf tersembunyi', '2026-11-11T03:00:00Z'), status: 'draft' }]);
  assert.match(empty.html, /Belum ada agenda mendatang/);
  const error = await run([], { fail: true });
  assert.match(error.html, /Agenda belum tersedia/);
  const staleCache = await run([], { fail: true, cache: { items: [event('Agenda kedaluwarsa', '2026-11-09T03:00:00Z')] } });
  assert.doesNotMatch(staleCache.html, /Agenda kedaluwarsa/);
  assert.match(staleCache.html, /Agenda belum tersedia/);
  const withdrawnCache=await run([], {fail:true,cache:{items:[event('Agenda ditarik','2026-11-11T03:00:00Z')]}});
  assert.doesNotMatch(withdrawnCache.html,/Agenda ditarik/);

  const slides = [1, 2, 3, 4, 5, 6, 7, 8].map(n => event(`Agenda ${n}`, `2026-11-${10+n}T03:00:00Z`));
  const carousel = await run(slides);
  assert.equal((carousel.html.match(/<article /g) || []).length, 6);
  assert.deepEqual(carousel.timers, [3000]);
  const ongoingNoEnd=await run([event('Masih berlangsung','2026-11-10T02:00:00Z')]);
  assert.match(ongoingNoEnd.html,/Masih berlangsung/);
  const cached=await run(slides,{cache:{items:slides}});
  assert.equal(cached.activeTimers.length,1);

  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const attendanceMigration=read('supabase/migrations/20261022181500_attendance_agenda_sync_recap_delete.sql');
  const attendanceAdmin=read('dist/admin.js');
  const attendanceHtml=read('dist/admin.html');
  const attendanceFunction=read('supabase/functions/attendance-checkin/index.ts');
  assert.match(attendanceMigration,/unique index if not exists secretariat_attendance_events_agenda_id_key/);
  assert.match(attendanceMigration,/agenda_sync_secretariat_attendance/);
  assert.match(attendanceMigration,/if v_agenda_status <> 'published' then\s+new\.status := 'closed'/);
  assert.match(attendanceMigration,/coalesce\(a\.ends_at, a\.starts_at\) <= statement_timestamp\(\)/);
  assert.match(attendanceMigration,/public\.is_secretariat_admin\(\)/);
  assert.doesNotMatch(attendanceHtml,/attendance-event-form|Buat daftar hadir/);
  assert.match(attendanceHtml,/attendance-recap-filter/);
  assert.match(attendanceHtml,/attendance-roster-filter/);
  assert.match(attendanceAdmin,/data-delete-event/);
  assert.match(attendanceAdmin,/Number\(b\.status==='hadir'\)-Number\(a\.status==='hadir'\)/);
  assert.match(attendanceAdmin,/setInterval\(\(\)=>\{if\(!\$\('#attendance-tools-panel'\)\.hidden\)void refreshOpenAttendanceRoster\(\);\},5000\)/);
  assert.match(attendanceFunction,/mode === "delete-event"/);
  assert.match(attendanceFunction,/status: "eq\.published"/);
  assert.match(attendanceFunction,/event\.agenda_id/);
  console.log('PASS: agenda carousel and attendance source, recap, delete, search, live refresh, and arrival ordering');
})().catch(error => { console.error(error); process.exitCode = 1; });
