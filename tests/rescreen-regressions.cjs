const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..','dist',f),'utf8');
const admin=read('admin.js'),absen=read('absen.js');
(async()=>{
  // Later responses from an older activity may not replace the selected roster.
  const waits={},nodes={};let displayed;
  const c=vm.createContext({attendanceEvents:[{id:'A',title:'A'},{id:'B',title:'B'}],currentAttendanceEvent:null,currentAttendanceRows:[],attendanceRosterPanel:{},$:s=>nodes[s]??={},api:p=>new Promise(r=>waits[p.split('eq.')[1]]=r),renderAttendanceRoster(){displayed=c.currentAttendanceRows[0].event_id;},escapeHTML:String});
  vm.runInContext(admin.slice(admin.indexOf('let attendanceRosterRequest='),admin.indexOf('function renderAttendanceRoster(')),c);
  const first=c.loadAttendanceRoster('A'),second=c.loadAttendanceRoster('B');
  assert.equal(c.currentAttendanceRows.length,0);assert.equal(nodes['#attendance-save'].disabled,true);
  waits.B([{event_id:'B'}]);await second;waits.A([{event_id:'A'}]);await first;
  assert.equal(c.currentAttendanceEvent.id,'B');assert.equal(displayed,'B');

  // A network error keeps the refresh token; rejected credentials clear it.
  for(const status of [undefined,503,400,401,403]){
    let wiped=false;
    const c=vm.createContext({config:{url:'test',publishableKey:'test'},localStorage:{getItem:()=>JSON.stringify({expires_at:Date.now()+3600000})},sessionStorage:{getItem:()=>null},session:null,saveSession:v=>{if(v===null)wiped=true},checkAdmin:async()=>{throw Object.assign(new Error('failure'),{status})},refreshSession:async()=>{},authView:{},adminView:{},showMessage(){},document:{documentElement:{classList:{remove(){}}}}});
    vm.runInContext(admin.slice(admin.indexOf('async function initialize(){'),admin.lastIndexOf('initialize();')),c);await c.initialize();
    assert.equal(wiped,[401,403].includes(status));
  }
  // Older public roster requests must not override a newer cohort selection.
  let callback;const nodes2={'#checkin-program':{},'#checkin-member':{}};const pending={};let shown;
  const p=vm.createContext({rosterOptionsRequest:0,$:id=>id==='#checkin-cohort'?{addEventListener:(e,fn)=>callback=fn}:nodes2[id],fillSelect:(node,items)=>{if(node===nodes2['#checkin-program'])shown=items},loadRosterOptions:(level,{cohort})=>new Promise(r=>pending[cohort]=r),setMessage(){}});
  vm.runInContext(absen.slice(absen.indexOf('$("#checkin-cohort").addEventListener'),absen.indexOf('$("#checkin-program").addEventListener')),p);
  const p1=callback({target:{value:'2024'}}),p2=callback({target:{value:'2025'}});pending['2025'](['Prodi 2025']);await p2;pending['2024'](['Prodi 2024']);await p1;assert.equal(shown[0],'Prodi 2025');
  // Delete only unreferenced files in our own posters bucket.
  const removed=[];let refs=[];
  const storage=vm.createContext({URL,config:{url:'https://example.test'},api:async()=>refs,removeCompetitionPoster:async path=>removed.push(path)});
  vm.runInContext(admin.slice(admin.indexOf('async function cleanupCompetitionPoster('),admin.indexOf('async function removeCompetitionPoster(')),storage);
  const url='https://example.test/storage/v1/object/public/posters/a/b.jpg';
  refs=[{id:'shared'}];assert.equal(await storage.cleanupCompetitionPoster(url),true);assert.equal(removed.length,0);
  refs=[];assert.equal(await storage.cleanupCompetitionPoster(url),true);assert.equal(removed[0],'a/b.jpg');
  await storage.cleanupCompetitionPoster('https://external.test/image.jpg');assert.equal(removed.length,1);
  // Cached withdrawn events must never be rendered before a fresh publication check.
  const rendered=[];let storedRead=false;
  const box={set innerHTML(v){rendered.push(v)},querySelectorAll:()=>[]};
  vm.runInNewContext(read('agenda.js'),{document:{getElementById:()=>box,querySelector:()=>null},window:{CSSMORA_SUPABASE:{url:'https://example.test',publishableKey:'test'}},Date,Intl,URLSearchParams,localStorage:{getItem(){storedRead=true;return JSON.stringify({items:[{title:'Withdrawn'}]})},removeItem(){}},console:{error(){}},clearInterval(){},fetch:async()=>{throw new Error('offline')}});
  await new Promise(setImmediate);assert.equal(storedRead,false);assert.ok(rendered.every(html=>!html.includes('Withdrawn')));
  console.log('PASS: session retention, activity-switch race, cohort-switch race, safe poster cleanup, withdrawn cache suppression');
})().catch(e=>{console.error(e);process.exitCode=1});
