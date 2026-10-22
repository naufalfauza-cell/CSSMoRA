const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { File } = require('node:buffer');
const crypto = require('node:crypto');
const root=path.join(__dirname,'..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const admin = read('dist/admin.js');
const findings = [];
const assert=require('node:assert/strict');
const record = (name,e)=>{
  if(name==='CSV import/export'){assert.equal(e.actualRows,2);assert.equal(e.exportHasRealLineBreak,true);assert.equal(e.exportStartsWithLiteralEscape,false);assert.equal(e.normalizedHeader,'program studi');}
  if(name==='Attendance stale save overwrites fresh check-in'){assert.equal(e.after.status,'hadir');assert.equal(e.after.proof_path,e.before.proof_path);}
  if(name==='Closed attendance blocks proof review')assert.equal(e.disabled,false);
  if(name==='Team selection remains in individual submission')assert.equal(e.teamIds.length,0);
  if(name==='Countdown across midnight')assert.equal(e.displayed,'2 jam 0 menit lagi');
  if(name==='No-end agenda disappears after start')assert.equal(e.renderedAsEmpty,false);
  if(name==='Cached carousel installs two intervals')assert.equal(e.active,1);
  if(name.endsWith('rejects Netlify origin'))assert.equal(e.allowed,true);
  if(name==='Attendance CORS only allows production')assert.equal(e.hardcoded,false);
  if(name==='Announcement timeouts differ')assert.ok(e.clientMs>e.upstreamGroqMs);
  if(name==='Application reference formats differ')assert.equal(e.publicNumberPrefix,e.adminPrefix);
  if(name==='Competition ID becomes an executable HTML attribute')assert.equal(e.injectedEventHandler,false);
  findings.push(name);
};
(async () => {
  let csvBlob;
  const csv = vm.createContext({
    Blob, URL: { createObjectURL(blob) { csvBlob = blob; return 'blob:audit'; }, revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }) }, setTimeout() {}
  });
  vm.runInContext(admin.slice(admin.indexOf('const csvCell='), admin.indexOf('function showSecretaryTab')), csv);
  const parsed = csv.parseCSV('NIA,Nama,Angkatan\r\n001,Anggota Contoh,2024\r\n');
  csv.downloadCSV('audit.csv', [['NIA', 'Nama'], ['001', 'Contoh']]);
  const exportText = await csvBlob.text();
  record('CSV import/export', {
    expectedRows: 2, actualRows: parsed.length,
    exportHasRealLineBreak: exportText.includes('\n'),
    exportStartsWithLiteralEscape: exportText.startsWith(String.fromCharCode(92) + 'ufeff'),
    normalizedHeader: vm.runInContext("normHeader('Program Studi')", csv)
  });
  let saveHandler;
  let database = { event_id: 'event', member_id: 'member', status: 'hadir', proof_path: 'event/member/proof.jpg', proof_uploaded_at: '2026-10-22T12:00:00Z' };
  const before = { ...database };
  const saveNode = { addEventListener(_, callback) { saveHandler = callback; } };
  const save = vm.createContext({
    attendanceRosterLoading:false,attendanceRosterRequest:0,attendanceRosterDirty:true,attendanceRosterDrafts:new Map([['member',{status:'hadir',reason:''}]]), $: () => saveNode, currentAttendanceEvent: { id: 'event', status: 'open', agenda:{status:'published'} },
    currentAttendanceRows: [{ event_id: 'event', member_id: 'member', status: 'belum', proof_path: null }],
    document: { querySelector: selector => selector.includes('status') ? { value: 'belum' } : { value: '' } },
    CSS: { escape: value => value }, session: { user: { id: 'admin' } }, Date,
    showMessage() {}, renderAttendanceRoster() {},loadAttendanceRecap:async()=>{},
    api: async (_, options) => {
      if (options?.method === 'POST') { database = { ...database, ...options.body.p_changes[0] }; return null; }
      return [database];
    }
  });
  vm.runInContext(admin.slice(admin.indexOf("$('#attendance-save').addEventListener"), admin.indexOf("$('#attendance-export').addEventListener")), save);
  await saveHandler();
  record('Attendance stale save overwrites fresh check-in', { before, after: database });
  const proofButton = { disabled: false }, nodes = new Map();
  const node = key => { if (!nodes.has(key)) nodes.set(key, {addEventListener(){}}); return nodes.get(key); };
  const render = vm.createContext({
    $: node, currentAttendanceEvent: { status: 'closed',agenda:{status:'published'} },attendanceRosterDirty:false,attendanceRosterDrafts:new Map(),attendanceEventIsPublished:()=>true,
    currentAttendanceRows: [{ member_id: 'member', status: 'hadir', proof_path: 'p', proof_uploaded_at: 'date' }],
    memberById: () => ({ full_name: 'Contoh', cohort: 2024, nia: '001' }),
    escapeHTML: value => String(value ?? ''), attendanceStatusLabel: value => value,
    setInterval() {},
    document: { querySelectorAll: selector => selector.includes('[data-attendance-proof]') ? [proofButton] : [] }
  });
  vm.runInContext(admin.slice(admin.indexOf('function renderAttendanceRoster'), admin.indexOf('async function getAttendanceProofUrl')), render);
  render.renderAttendanceRoster();
  record('Closed attendance blocks proof review', { disabled: proofButton.disabled });
  const pnodes = new Map();
  const get = key => {
    if (!pnodes.has(key)) pnodes.set(key, { value: '', hidden: false, textContent: '', innerHTML: '', dataset: {}, files: [], addEventListener(type, cb) { this[type] = cb; } });
    return pnodes.get(key);
  };
  const form = get('#achievement-form');
  form.elements = Object.fromEntries(Object.entries({
    participation_type: 'individu', competition_name: 'Contoh Lomba', competition_type: 'Esai',
    leader_phone: '081234567890', official_email: 'audit@example.invalid',
    fee_amount: '20000', information_url: 'https://example.invalid', bank_name: 'Bank Contoh',
    account_number: '123456789', account_name: 'Anggota Contoh'
  }).map(([key, value]) => [key, { value }]));
  form.elements.return_agreement = { checked: true };
  form.reportValidity = () => true; form.reset = () => {};
  get('#leader-member').value = 'leader'; get('#fee-amount').value = '20000';
  get('#proof-file').files = [new File([new Uint8Array([255, 216, 255])], 'proof.jpg', { type: 'image/jpeg' })];
  let submitted;
  const prestasi = vm.createContext({
    window: { CSSMORA_SUPABASE: { url: 'https://example.invalid', publishableKey: 'test' }, CSSMoRAUpload: { compressImage: async file => file } },
    document: { querySelector: get, querySelectorAll: () => [] }, Intl, FormData, crypto, console,
    fetch: async (url, options) => {
      if (url.includes('member_roster')) return { ok: true, json: async () => [{ id: 'leader', full_name: 'Contoh', cohort: 2024 }] };
      submitted = JSON.parse(options.body.get('payload'));
      return { ok: true, json: async () => ({ request_number: 'AUDIT', requested_amount: 10000 }) };
    }
  });
  vm.runInContext(read('dist/prestasi.js'), prestasi);
  await new Promise(setImmediate);
  vm.runInContext("selectedTeamIds.add('member-2')", prestasi);
  await form.submit({ preventDefault() {} });
  record('Team selection remains in individual submission', { participation: submitted.p_participation_type, teamIds: submitted.p_team_member_ids });
  const page = read('dist/agenda-page.js');
  const helper = page.slice(page.indexOf('const dayKey='), page.indexOf('const todayLabel='));
  const countdown = page.slice(page.indexOf('const countdown=event=>'), page.indexOf('const dateRange=event=>'));
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-22T16:00:00Z'])); }
    static now() { return Date.parse('2026-10-22T16:00:00Z'); }
  }
  const clock = vm.createContext({ Date: FixedDate, Intl });
  vm.runInContext("const tz='Asia/Jakarta';const eventEnd=e=>e.ends_at?new Date(e.ends_at):new Date(e.starts_at);" + helper + countdown + ";globalThis.countdownResult=countdown({starts_at:'2026-10-22T18:00:00Z',ends_at:null});", clock);
  record('Countdown across midnight', { actualDurationHours: 2, displayed: clock.countdownResult.time });
  const agendaTest = read('tests/agenda.test.cjs');
  const runner = vm.createContext({ require, __dirname: path.join(root, 'tests'), setImmediate, console, URL, URLSearchParams });
  vm.runInContext(agendaTest.slice(0, agendaTest.indexOf('(async () => {')), runner);
  const event = { title: 'Kegiatan tanpa jam selesai', starts_at: '2026-11-10T02:00:00Z', ends_at: null, status: 'published' };
  const noEnd = await runner.run([event], { now: '2026-11-10T03:00:00Z' });
  record('No-end agenda disappears after start', { eventAt09WIB: true, checkedAt10WIB: true, renderedAsEmpty: noEnd.html.includes('Belum ada agenda mendatang') });
  const upcoming = [11, 12].map(day => ({ title: 'Agenda', starts_at: '2026-11-' + day + 'T03:00:00Z', ends_at: null, status: 'published' }));
  const cached = await runner.run(upcoming, { cache: { items: upcoming } });
  record('Cached carousel installs two intervals', { timers: cached.timers, active:cached.activeTimers.length });
  for (const slug of ['submit-achievement', 'generate-announcement']) {
    const ts = read('supabase/functions/' + slug + '/index.ts');
    const js = stripTypeScriptTypes(ts, { mode: 'strip' }).replace(/^import .+;\s*$/gm, '');
    const ctx = vm.createContext({
      Deno: { env: { get: () => '' }, serve() {} },
      Response, Request, URL, TextDecoder, TextEncoder, File, crypto, console
    });
    vm.runInContext(js + ';globalThis.netlifyAllowed=allowedOrigin("https://cssmora.netlify.app");', ctx);
    record(slug + ' rejects Netlify origin', { allowed: ctx.netlifyAllowed });
  }
  const attendance = read('supabase/functions/attendance-checkin/index.ts');
  record('Attendance CORS only allows production', { hardcoded: attendance.includes('"Access-Control-Allow-Origin": "https://cssmora.vercel.app"') });
  record('Announcement timeouts differ', { clientMs: /timeoutMs:35000/.test(admin)?35000:15000, upstreamGroqMs: 25000 });
  record('Application reference formats differ', {
    publicNumberPrefix: 'CSS-PR-2610',
    adminPrefix: (()=>{const c=vm.createContext({Intl,Date});vm.runInContext(admin.slice(admin.indexOf('function achievementRequestNumber'),admin.indexOf('function achievementDetailMarkup')),c);return c.achievementRequestNumber({created_at:'2026-10-22T10:00:00Z',id:'12345678-0000'}).slice(0,11);})()
  });
  const catalogNodes = new Map();
  const catalogNode = selector => {
    if (!catalogNodes.has(selector)) catalogNodes.set(selector, {
      value: ['#category', '#status'].includes(selector) ? 'all' : '',
      innerHTML: '', textContent: '', hidden: false
    });
    return catalogNodes.get(selector);
  };
  const catalog = vm.createContext({
    document: { querySelector: catalogNode, querySelectorAll: () => [] }, Date, Intl
  });
  const catalogSource = read('dist/app.js');
  vm.runInContext(catalogSource.slice(0, catalogSource.indexOf('function detail')), catalog);
  vm.runInContext('competitions=[{id:\'audit" onclick="globalThis.auditMarker=1\',title:"Contoh",organizer:"Contoh",category:"Esai",subtitle:"",deadline:"2027-01-01T00:00:00Z"}];render();', catalog);
  const catalogMarkup = catalogNode('#competition-grid').innerHTML;
  record('Competition ID becomes an executable HTML attribute', {
    injectedEventHandler: catalogMarkup.includes('data-id="audit" onclick="globalThis.auditMarker=1"')
  });
  console.log('PASS: '+findings.length+' focused regression checks.');
})().catch(error => { console.error(error); process.exitCode = 1; });
