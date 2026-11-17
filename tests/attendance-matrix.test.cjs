const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('rekap shows event-specific statuses, a compact permission count, and visual accumulation',()=>{
  const source=fs.readFileSync('dist/admin.js','utf8');
  const render=source.slice(source.indexOf('function renderAttendanceRecap(){'),source.indexOf("$('#attendance-recap-filter').addEventListener"));
  const nodes=new Map();
  const $=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',value:''});return nodes.get(id)};
  const ctx={$,Map,Set,attendanceRecapRows:[{member_id:'m',full_name:'Nama',cohort:2026,attended_count:1,eligible_count:2,attendance_percent:50,permission_count:1,permission_percent:50,completed_event_count:2}],members:[{id:'m',nim:'123'}],attendanceRecapEvents:[{id:'e',agenda_id:'a',event_date:'2026-11-17',agenda:{title:'Kegiatan A'}},{id:'e2',agenda_id:'a2',event_date:'2026-11-18',agenda:{title:'Kegiatan B'}}],attendanceRecapDetails:new Map([['e:m','izin'],['e2:m','hadir']]),attendanceRecapApproved:new Set(['a:m']),attendanceRecapPending:new Set(),attendanceRecapRejected:new Set(),escapeHTML:x=>String(x??''),programScheduleLabel:x=>x,attendanceStatusLabel:s=>({izin:'Izin',hadir:'Hadir'})[s]};
  vm.runInNewContext(render+'\nrenderAttendanceRecap();',ctx);
  assert.match($('#attendance-recap-head').innerHTML,/Kegiatan A/);
  assert.match($('#attendance-recap-head').innerHTML,/Kegiatan B/);
  assert.match($('#attendance-recap').innerHTML,/<td>Izin<\/td><td>Hadir<\/td>/);
  assert.match($('#attendance-recap-head').innerHTML,/Izin \(kali\)/);
  assert.match($('#attendance-recap-head').innerHTML,/Izin \(%\)/);
  assert.match($('#attendance-recap').innerHTML,/attendance-rate-track/);
  assert.match($('#attendance-recap').innerHTML,/<td>1<\/td><td>50%<\/td>/);
  assert.doesNotMatch($('#attendance-recap-summary').innerHTML,/25%|batas/);
});
test('rekap distinguishes pending and rejected event permissions',()=>{
  const source=fs.readFileSync('dist/admin.js','utf8');
  const render=source.slice(source.indexOf('function renderAttendanceRecap(){'),source.indexOf("$('#attendance-recap-filter').addEventListener"));
  const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',value:''});return nodes.get(id)};
  const ctx={$,Map,Set,attendanceRecapRows:[{member_id:'m1',full_name:'Menunggu',cohort:2026},{member_id:'m2',full_name:'Ditolak',cohort:2026}],members:[],attendanceRecapEvents:[{id:'e',agenda_id:'a',event_date:'2026-11-17',agenda:{title:'Kegiatan'}}],attendanceRecapDetails:new Map(),attendanceRecapApproved:new Set(),attendanceRecapPending:new Set(['a:m1']),attendanceRecapRejected:new Set(['a:m2']),escapeHTML:x=>String(x??''),programScheduleLabel:x=>x,attendanceStatusLabel:s=>s};
  vm.runInNewContext(render+'\nrenderAttendanceRecap();',ctx);
  assert.match($('#attendance-recap').innerHTML,/<td>Menunggu izin<\/td>/);
  assert.match($('#attendance-recap').innerHTML,/<td>Izin ditolak<\/td>/);
});
