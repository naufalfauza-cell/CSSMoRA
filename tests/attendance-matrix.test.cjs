const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('rekap shows event-specific statuses without changing accumulated values',()=>{
  const source=fs.readFileSync('dist/admin.js','utf8');
  const render=source.slice(source.indexOf('function renderAttendanceRecap(){'),source.indexOf("$('#attendance-recap-filter').addEventListener"));
  const nodes=new Map();
  const $=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',value:''});return nodes.get(id)};
  const ctx={$,Map,Set,attendanceRecapRows:[{member_id:'m',full_name:'Nama',nia:'N1',cohort:2026,attended_count:1,eligible_count:2,attendance_percent:50,permission_count:1,permission_percent:50,completed_event_count:2}],members:[{id:'m',nim:'123'}],attendanceRecapEvents:[{id:'e',agenda_id:'a',event_date:'2026-11-17',agenda:{title:'Kegiatan A'}},{id:'e2',agenda_id:'a2',event_date:'2026-11-18',agenda:{title:'Kegiatan B'}}],attendanceRecapDetails:new Map([['e:m','izin'],['e2:m','hadir']]),attendanceRecapApproved:new Set(['a:m']),escapeHTML:x=>String(x??''),programScheduleLabel:x=>x,attendanceStatusLabel:s=>({izin:'Izin',hadir:'Hadir'})[s]};
  vm.runInNewContext(render+'\nrenderAttendanceRecap();',ctx);
  assert.match($('#attendance-recap-head').innerHTML,/Kegiatan A/);
  assert.match($('#attendance-recap-head').innerHTML,/Kegiatan B/);
  assert.match($('#attendance-recap').innerHTML,/<td>Izin<\/td><td>Hadir<\/td>/);
  assert.match($('#attendance-recap').innerHTML,/<td>50%<\/td>/);
  assert.match($('#attendance-recap').innerHTML,/1 kali · 50%/);
});
