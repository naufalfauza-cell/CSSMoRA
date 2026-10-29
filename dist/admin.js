const $ = selector => document.querySelector(selector);
const config = window.CSSMORA_SUPABASE;
const authView = $('#auth-view');
const adminView = $('#admin-view');
const authForm = $('#auth-form');
const competitionForm = $('#competition-form');
const recordList = $('#record-list');
let session = null;
let isCompetitionAdmin = false;
let isSecretariatAdmin = false;
let achievementRoles = [];
let canReviewAchievementApplications = false;
let canVerifyAchievementRecords = false;
let canManageProgramCycles = false;
let isLeadership = false;
let canManageRoles = false;
let assignedRoles = [];
const roleForm = $('#role-form');
const roleList = $('#role-list');
let achievementApplications = [];
let achievementMembers = [];
let achievementFilter = 'all';
const expandedAchievementIds=new Set();
let competitions = [];
let agendas = [];
let programs = [];
let programDetails = new Map();
const programForm = $('#program-form');
const programRecordList = $('#program-record-list');
const programPhotoInput = $('#program-photo');
const agendaForm = $('#agenda-form');
const agendaRecordList = $('#agenda-record-list');
const agendaTimeZone = 'Asia/Jakarta';
const loadedAdminData = new Set();
const loadingAdminData = new Map();

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const programDateInputValue = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value||'')) ? String(value) : '';
const programScheduleLabel = value => {
  const date=programDateInputValue(value);
  return date?new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Jakarta'}).format(new Date(`${date}T00:00:00+07:00`)):String(value||'—');
};
const baseHeaders = () => ({apikey:config.publishableKey,'Content-Type':'application/json'});
const showMessage = (selector,message,kind='') => {
  const node=$(selector);
  node.textContent=message;
  node.dataset.kind=kind;
};
const saveSession = value => {
  session=value;
  if(value){
    localStorage.setItem('cssmora-admin-session',JSON.stringify(value));
    sessionStorage.removeItem('cssmora-admin-session');
  }else{
    localStorage.removeItem('cssmora-admin-session');
    sessionStorage.removeItem('cssmora-admin-session');
  }
};

async function fetchTimed(url, options={}) {
  const {timeoutMs=15000,...requestOptions}=options;
  const timeoutOptions=typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?{signal:AbortSignal.timeout(timeoutMs)}:{};
  try {
    return await fetch(url,{...requestOptions,...timeoutOptions});
  } catch(error) {
    if(error?.name==='TimeoutError'||error?.name==='AbortError') {
      throw new Error('Permintaan melewati batas waktu. Periksa koneksi lalu coba lagi.');
    }
    throw error;
  }
}

async function authRequest(path,body) {
  const response=await fetchTimed(`${config.url}/auth/v1/${path}`,{
    method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.msg||data.message||data.error_description||'Autentikasi gagal. Periksa email dan kata sandi.');error.status=response.status;error.authFailure=[400,401,403].includes(response.status);throw error;}
  return data;
}

let refreshingSession = null;
async function refreshSession() {
  if(refreshingSession)return refreshingSession;
  refreshingSession=performRefreshSession().finally(()=>{refreshingSession=null;});
  return refreshingSession;
}
async function performRefreshSession() {
  if(!session?.refresh_token)throw new Error('Sesi berakhir. Silakan login kembali.');
  const refreshed=await authRequest('token?grant_type=refresh_token',{refresh_token:session.refresh_token});
  saveSession({...refreshed,expires_at:Date.now()+Number(refreshed.expires_in||3600)*1000});
}

async function authenticatedFetch(url,options={}) {
  if(session?.refresh_token&&Number(session.expires_at||0)<=Date.now()+60000)await refreshSession();
  const send=()=>fetchTimed(url,{...options,headers:{...options.headers,...(session?.access_token?{Authorization:'Bearer '+session.access_token}:{})}});
  let response=await send();
  if(response.status===401&&session?.refresh_token){await refreshSession();response=await send();}
  return response;
}
function apiError(result) {
  if(result?.code==='23514')return 'Data belum sesuai ketentuan. Periksa isian lalu coba lagi.';
  if(result?.code==='23505')return 'Data atau nomor tersebut sudah digunakan. Muat ulang lalu coba lagi.';
  if(result?.code==='42501')return 'Akun ini tidak memiliki akses untuk tindakan tersebut.';
  return result?.message||'Permintaan gagal. Coba lagi.';
}
async function api(path,{method='GET',body,extraHeaders={}}={}) {
  const response=await authenticatedFetch(config.url+'/rest/v1/'+path,{
    method,headers:{...baseHeaders(),...extraHeaders},body:body===undefined?undefined:JSON.stringify(body)
  });
  const raw=await response.text();
  let result=null;
  try{result=raw?JSON.parse(raw):null;}catch{throw new Error('Respons layanan tidak dapat dibaca. Coba lagi.');}
  if(!response.ok){const error=new Error(apiError(result));error.status=response.status;throw error;}
  return result;
}
window.CSSMoRAAdmin={
  api,
  showMessage,
  request: authenticatedFetch,
  context:()=>({isLeadership,isSecretariatAdmin,canViewSecretariat:isLeadership||isSecretariatAdmin,isCompetitionAdmin,userId:session?.user?.id,canManageProgramCycles})
};

async function ensureAdminData(key, loader) {
  if(loadedAdminData.has(key))return;
  if(loadingAdminData.has(key))return loadingAdminData.get(key);
  const pending=Promise.resolve().then(loader).finally(()=>loadingAdminData.delete(key));
  loadingAdminData.set(key,pending);
  return pending;
}

async function loadAdminPanel(panelId) {
  if(panelId==='agenda-panel') {
    await ensureAdminData('programs',loadPrograms);
    await ensureAdminData('agenda',loadAgenda);
    return;
  }
  if(panelId==='secretariat-panel') {
    initializeSecretaryForms();
    const selected=document.querySelector('.secretariat-tab.is-active')||document.querySelector('.secretariat-tab');
    await loadSecretarySection(selected);
    return;
  }
  if(panelId==='achievements-panel') {
    const section=document.querySelector('.achievement-admin-tab.is-active')?.dataset.prestasiSection;
    if(section==='competitions')await ensureAdminData('competitions',loadRecords);
    else if(section==='verification')await window.CSSMoRAWorkflows?.loadAchievementRecords();
    else await loadAchievementDashboard();
    return;
  }
  if(panelId==='access-panel'&&canManageRoles) {
    await Promise.all([loadRoleAssignments(), loadDriveIntegrationStatus()]);
  }
}

function selectAchievementAdminSection(section,{load=false}={}) {
  const tab=document.querySelector(`.achievement-admin-tab[data-prestasi-section="${section}"]`);
  if(!tab||tab.hidden)return;
  document.querySelectorAll('.achievement-admin-tab').forEach(item=>{
    const selected=item===tab;
    item.classList.toggle('is-active',selected);
    item.setAttribute('aria-selected',String(selected));
  });
  document.querySelectorAll('.achievement-admin-subpanel').forEach(panel=>{
    panel.hidden=panel.id!==tab.getAttribute('aria-controls');
  });
  try{localStorage.setItem('cssmora-admin-prestasi-section',section);}catch{}
  if(load&&document.querySelector('#tab-achievements.is-active'))void loadAdminPanel('achievements-panel');
}

document.querySelectorAll('.achievement-admin-tab').forEach(tab=>tab.addEventListener('click',()=>{
  selectAchievementAdminSection(tab.dataset.prestasiSection,{load:true});
}));

async function checkAdmin() {
  const user=session?.user;
  if(!user?.email)throw Object.assign(new Error('Akun tidak memiliki alamat email yang terverifikasi.'),{status:401});
  const email=user.email.toLowerCase();
  const rows=await api(`cssmora_user_roles?select=role&email=eq.${encodeURIComponent(email)}&is_active=eq.true`);
  const roleSet=new Set((rows||[]).map(row=>row.role));
  isLeadership=roleSet.has('ketua')||roleSet.has('wakil');
  canManageRoles=isLeadership;
  canManageProgramCycles=isLeadership||roleSet.has('bph_departemen');
  isCompetitionAdmin=isLeadership||roleSet.has('bph_departemen')||roleSet.has('sekretaris')||roleSet.has('bendahara');
  isSecretariatAdmin=roleSet.has('sekretaris');
  achievementRoles=isLeadership?['ketua']:(roleSet.has('bendahara')?['bendahara']:[]);
  canReviewAchievementApplications=isLeadership||roleSet.has('bendahara');
  canVerifyAchievementRecords=isLeadership||roleSet.has('bph_departemen')||roleSet.has('sekretaris')||roleSet.has('bendahara');
  if(!roleSet.size)throw Object.assign(new Error('Akun ini belum diberi akses pengelolaan CSSMoRA. Hubungi Ketua CSSMoRA.'),{status:403});

  $('#signed-in-as').textContent=user.email;
  authView.hidden=true;
  adminView.hidden=false;

  const allowed=new Set();
  if(isCompetitionAdmin)allowed.add('tab-agenda');
  if(isLeadership||roleSet.has('bendahara'))allowed.add('tab-finance');
  if(isCompetitionAdmin||canReviewAchievementApplications||canVerifyAchievementRecords)allowed.add('tab-achievements');
  if(isLeadership||isSecretariatAdmin)allowed.add('tab-secretariat');
  if(canManageRoles)allowed.add('tab-access');
  document.querySelectorAll('.admin-tab').forEach(tab=>{tab.hidden=!allowed.has(tab.id);});
  $('#secretariat-panel')?.classList.toggle('secretariat-readonly',isLeadership&&!isSecretariatAdmin);

  document.querySelectorAll('.achievement-admin-tab').forEach(tab=>{
    tab.hidden=tab.dataset.prestasiSection==='competitions'?!isCompetitionAdmin:
      tab.dataset.prestasiSection==='funding'?!canReviewAchievementApplications:!canVerifyAchievementRecords;
  });
  const storedPrestasiSection=(()=>{try{return localStorage.getItem('cssmora-admin-prestasi-section');}catch{return null;}})();
  const preferredPrestasiSection=isCompetitionAdmin?'competitions':canReviewAchievementApplications?'funding':'verification';
  const availablePrestasiSection=section=>section==='competitions'?isCompetitionAdmin:
    section==='funding'?canReviewAchievementApplications:section==='verification'&&canVerifyAchievementRecords;
  const prestasiSection=availablePrestasiSection(storedPrestasiSection)?storedPrestasiSection:preferredPrestasiSection;
  selectAchievementAdminSection(prestasiSection);

  const savedTab=(()=>{try{return localStorage.getItem('cssmora-admin-active-tab');}catch{return null;}})();
  const preferred=isCompetitionAdmin?'tab-achievements':isLeadership?'tab-finance':roleSet.has('bendahara')?'tab-achievements':isSecretariatAdmin?'tab-secretariat':'tab-access';
  const restoredTab=['tab-achievement-recap','tab-competitions'].includes(savedTab)?'tab-achievements':savedTab;
  const target=Array.from(document.querySelectorAll('.admin-tab')).find(tab=>tab.id===restoredTab&&!tab.hidden)
    ||Array.from(document.querySelectorAll('.admin-tab')).find(tab=>tab.id===preferred&&!tab.hidden)
    ||Array.from(document.querySelectorAll('.admin-tab')).find(tab=>!tab.hidden);
  if(target)target.click();
  void loadDriveIntegrationStatus();
}
async function signIn(email,password) {
  const result=await authRequest('token?grant_type=password',{email,password});
  saveSession({...result,expires_at:Date.now()+Number(result.expires_in||3600)*1000});
  await checkAdmin();
}

authForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const submit=$('#auth-submit');
  const email=authForm.elements.email.value.trim().toLowerCase();
  const password=authForm.elements.password.value;
  submit.disabled=true;
  showMessage('#auth-message','Memeriksa akun…');
  try{
    await signIn(email,password);
    showMessage('#auth-message','Login berhasil.','success');
  }catch(error){
    saveSession(null);
    authView.hidden=false;
    adminView.hidden=true;
    showMessage('#auth-message',error.message,'error');
  }finally{submit.disabled=false;}
});

$('#logout').addEventListener('click',async()=>{
  try{if(session?.access_token)await fetchTimed(`${config.url}/auth/v1/logout`,{method:'POST',headers:{apikey:config.publishableKey,Authorization:`Bearer ${session.access_token}`}});}catch{}
  saveSession(null);
  window.CSSMoRALetterSignatures?.reset();
  adminView.hidden=true;
  authView.hidden=false;
  authForm.reset();
  showMessage('#auth-message','Kamu sudah keluar.','success');
});

async function loadRecords(){
  loadedAdminData.delete('competitions');
  recordList.innerHTML='<p class="records-empty">Memuat data…</p>';
  try{
    competitions=await api('competitions?select=*&order=createdAt.desc,deadline.desc');
    renderRecords();
    recordList.scrollTop=0;
    loadedAdminData.add('competitions');
  }catch(error){
    recordList.innerHTML=`<p class="records-empty">${escapeHTML(error.message)}</p>`;
  }
}

function renderRecords(){
  $('#record-count').textContent=String(competitions.length);
  if(!competitions.length){recordList.innerHTML='<p class="records-empty">Belum ada lomba. Tambahkan dari form di samping.</p>';return;}
  recordList.innerHTML=competitions.map(item=>`<article class="record-row">
    <div><h4>${escapeHTML(item.title)}</h4><p>${escapeHTML(item.organizer)} · Tenggat ${escapeHTML(new Date(item.deadline).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Jakarta'}))}</p><span class="record-status ${item.status==='published'?'published':''}">${item.status==='published'?'TERBIT':'DRAF'}</span></div>
    <div class="record-actions"><button type="button" data-action="edit" data-id="${escapeHTML(item.id)}">Edit</button><button type="button" class="delete" data-action="delete" data-id="${escapeHTML(item.id)}">Hapus</button></div>
  </article>`).join('');
}

function clearEditor(){
  competitionForm.reset();
  $('#record-id').value='';
  $('#editor-title').textContent='Tambah lomba';
  $('#save-competition').innerHTML='Simpan lomba <span aria-hidden="true">↗</span>';
  showMessage('#editor-message','');
}
$('#form-reset').addEventListener('click',clearEditor);

recordList.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');
  if(!button)return;
  const item=competitions.find(row=>row.id===button.dataset.id);
  if(!item)return;
  if(button.dataset.action==='edit'){
    $('#record-id').value=item.id;
    competitionForm.elements.title.value=item.title||'';
    competitionForm.elements.subtitle.value=item.subtitle||'';
    competitionForm.elements.category.value=item.category||'Esai & Riset';
    competitionForm.elements.organizer.value=item.organizer||'';
    competitionForm.elements.deadline.value=new Date(item.deadline).toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'});
    competitionForm.elements.fee.value=item.fee||'Gratis';
    competitionForm.elements.poster.value=item.posterImage||'';
    $('#competition-poster-file').value='';
    competitionForm.elements.registration.value=item.registrationUrl||'';
    competitionForm.elements.description.value=item.description||'';
    competitionForm.elements.published.checked=item.status==='published';
    $('#editor-title').textContent='Edit lomba';
    $('#save-competition').innerHTML='Simpan perubahan <span aria-hidden="true">↗</span>';
    $('#title').focus();
    return;
  }
  if(button.dataset.action==='delete'&&confirm(`Hapus lomba “${item.title}”?`)){
    button.disabled=true;
    try{
      await api(`competitions?id=eq.${encodeURIComponent(item.id)}`,{method:'DELETE'});
      const cleaned=await cleanupCompetitionPoster(item.posterImage);
      competitions=competitions.filter(row=>row.id!==item.id);
      renderRecords();
      if($('#record-id').value===item.id)clearEditor();
      if(!cleaned)showMessage('#editor-message','Lomba terhapus. Poster lama belum dapat dibersihkan; coba lagi saat koneksi stabil.','error');
    }catch(error){alert(`Lomba belum terhapus: ${error.message}`);button.disabled=false;}
  }
});

competitionForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const submit=$('#save-competition');
  const title=competitionForm.elements.title.value.trim();
  const deadline=competitionForm.elements.deadline.value;
  const poster=competitionForm.elements.poster.value.trim();
  const registration=competitionForm.elements.registration.value.trim();
  if((poster&&!poster.startsWith('https://'))||(registration&&!registration.startsWith('https://'))){showMessage('#editor-message','Tautan poster dan pendaftaran harus memakai https://.','error');return;}
  const slug=title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90)||'lomba';
  const existingId=$('#record-id').value;
  const oldPoster=competitions.find(item=>item.id===existingId)?.posterImage;
  const id=existingId||`${slug}-${Date.now()}`;
  let uploadedPosterPath=null;
  const payload={
    id,
    title,
    subtitle:competitionForm.elements.subtitle.value.trim(),
    category:competitionForm.elements.category.value,
    organizer:competitionForm.elements.organizer.value.trim(),
    deadline:`${deadline}T23:59:00+07:00`,
    fee:competitionForm.elements.fee.value.trim(),
    palette:'purple',
    mark:title.split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase(),
    year:deadline.slice(0,4),
    posterImage:poster,
    registrationUrl:registration,
    description:competitionForm.elements.description.value.trim(),
    status:competitionForm.elements.published.checked?'published':'draft',
    updatedAt:new Date().toISOString()
  };
  submit.disabled=true;
  showMessage('#editor-message','Menyimpan…');
  try{
    const file=$('#competition-poster-file').files[0];
    if(file){
      const upload=await uploadCompetitionPoster(file,id);
      payload.posterImage=upload.url;uploadedPosterPath=upload.path;
    }
    if(existingId){
      await api(`competitions?id=eq.${encodeURIComponent(existingId)}`,{method:'PATCH',body:payload});
      showMessage('#editor-message','Perubahan berhasil disimpan.','success');
    }else{
      await api('competitions',{method:'POST',body:payload});
      showMessage('#editor-message','Lomba berhasil ditambahkan.','success');
    }
    uploadedPosterPath=null; // The database now owns this upload.
    const cleaned=oldPoster&&oldPoster!==payload.posterImage?await cleanupCompetitionPoster(oldPoster):true;
    await loadRecords();
    clearEditor();
    if(!cleaned)showMessage('#editor-message','Lomba tersimpan. Poster lama belum dapat dibersihkan.','error');
  }catch(error){if(uploadedPosterPath)await removeCompetitionPoster(uploadedPosterPath).catch(()=>{});showMessage('#editor-message',error.message,'error');}
  finally{submit.disabled=false;}
});


const programBucket='cssmora-agenda-programs';
const storageHeaders=contentType=>({
  apikey:config.publishableKey,
  Authorization:`Bearer ${session?.access_token||config.publishableKey}`,
  ...(contentType?{'Content-Type':contentType}:{})
});
const objectUrl=path=>`${config.url}/storage/v1/object/public/${programBucket}/${path.split('/').map(encodeURIComponent).join('/')}`;

async function cleanupCompetitionPoster(url){
  if(!url)return true;
  try{
    const base=new URL(config.url+'/storage/v1/object/public/posters/');
    const candidate=new URL(url);
    if(candidate.origin!==base.origin||!candidate.pathname.startsWith(base.pathname))return true;
    const path=decodeURIComponent(candidate.pathname.slice(base.pathname.length));
    if(!path||path.split('/').some(part=>!part||part==='.'||part==='..'))return true;
    const references=await api('competitions?select=id&posterImage=eq.'+encodeURIComponent(url)+'&limit=1');
    if(!references.length)await removeCompetitionPoster(path);
    return true;
  }catch{return false;}
}
async function removeCompetitionPoster(path){
  const response=await authenticatedFetch(config.url+'/storage/v1/object/posters',{method:'DELETE',headers:baseHeaders(),body:JSON.stringify({prefixes:[path]})});
  if(!response.ok)throw new Error('Poster belum dapat dihapus.');
}
async function uploadCompetitionPoster(file,id){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Poster harus berupa JPG, PNG, atau WebP.');
  const image=await window.CSSMoRAUpload.compressImage(file,{maxBytes:2*1024*1024});
  const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[image.type];
  const path=id+'/'+crypto.randomUUID()+'.'+ext;
  const response=await authenticatedFetch(config.url+'/storage/v1/object/posters/'+path,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':image.type,'x-upsert':'false'},body:image});
  if(!response.ok)throw new Error('Poster gagal diunggah. Periksa ukuran dan akses akun.');
  return {path,url:config.url+'/storage/v1/object/public/posters/'+path};
}
async function uploadProgramPhoto(file,path) {
  const response=await authenticatedFetch(`${config.url}/storage/v1/object/${programBucket}/${path.split('/').map(encodeURIComponent).join('/')}`,{
    method:'POST',headers:{...storageHeaders(file.type),'x-upsert':'false'},body:file
  });
  if(!response.ok) {
    const data=await response.json().catch(()=>({}));
    throw new Error(data.message||data.error||'Foto proker gagal diunggah.');
  }
}
async function deleteProgramPhoto(path) {
  if(!path)return;
  const response=await authenticatedFetch(`${config.url}/storage/v1/object/${programBucket}/${path.split('/').map(encodeURIComponent).join('/')}`,{
    method:'DELETE',headers:storageHeaders()
  });
  if(!response.ok)throw new Error('Foto lama belum dapat dihapus dari penyimpanan.');
}
async function loadPrograms() {
  loadedAdminData.delete('programs');
  programRecordList.innerHTML='<p class="records-empty">Memuat proker…</p>';
  try {
    const [rows,details]=await Promise.all([
      api('agenda_programs?select=*&order=name.asc'),
      api('cssmora_program_details?select=*&order=updated_at.desc')
    ]);
    programs=rows;
    programDetails=new Map(details.map(detail=>[detail.program_id,detail]));
    renderPrograms();
    loadedAdminData.add('programs');
    renderProgramOptions();
  } catch(error) {
    programRecordList.innerHTML=`<p class="records-empty">${escapeHTML(error.message)}</p>`;
  }
}
function renderPrograms() {
  $('#program-record-count').textContent=String(programs.length);
  if(!programs.length) {
    programRecordList.innerHTML='<p class="records-empty">Belum ada proker. Tambahkan nama dan foto terlebih dahulu.</p>';
    return;
  }
  const divisionLabels={BPH:'BPH',PSDM:'PSDM',P3M:'P3M',ADVO:'Advokasi',MEDINFO:'Medinfo'};
  const money=value=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value)||0);
  programRecordList.innerHTML=programs.map(program=>{const detail=programDetails.get(program.id)||{};return `<article class="program-record">
    <img src="${escapeHTML(program.photo_url)}" alt="" loading="lazy">
    <div class="program-record-copy"><strong>${escapeHTML(program.name)}</strong><div class="program-record-meta"><span class="program-division">${escapeHTML(divisionLabels[program.division]||'Divisi belum diatur')}</span><span class="record-status ${program.is_active?'published':''}">${program.is_active?'AKTIF':'NONAKTIF'}</span><span class="program-cycle-pill">${escapeHTML(detail.cycle||'Siklus belum diisi')}</span>${detail.period_label?`<span class="program-period-pill">${escapeHTML(detail.period_label)}</span>`:''}</div><small class="program-record-summary">${escapeHTML(detail.description||'Belum ada deskripsi')}${detail.pic?` · PIC ${escapeHTML(detail.pic)}`:''}${detail.budget_amount!==null&&detail.budget_amount!==undefined?` · ${escapeHTML(money(detail.budget_amount))}`:''}</small></div>
    <div class="program-record-actions"><button type="button" data-program-action="edit" data-id="${escapeHTML(program.id)}">Edit</button><button type="button" data-program-action="toggle" data-id="${escapeHTML(program.id)}">${program.is_active?'Nonaktifkan':'Aktifkan'}</button><button type="button" class="program-delete-button" data-program-action="delete" data-id="${escapeHTML(program.id)}" aria-label="Hapus proker ${escapeHTML(program.name)}" title="Hapus proker"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v6m4-6v6"/></svg></button></div>
    <details class="program-record-details"><summary>Rincian database</summary><div><span><small>Tujuan</small>${escapeHTML(detail.goals||'—')}</span><span><small>Sasaran</small>${escapeHTML(detail.target||'—')}</span><span><small>Rencana waktu</small>${escapeHTML(programScheduleLabel(detail.planned_schedule))}</span></div></details>
  </article>`;}).join('');
  programRecordList.querySelectorAll('img').forEach(image=>image.addEventListener('error',()=>{image.src='./assets/cssmora-logo.webp?v=20261023-perf-assets';},{once:true}));
}
function renderProgramOptions(selected='') {
  const select=$('#agenda-program');
  const divisionLabels={BPH:'BPH',PSDM:'PSDM',P3M:'P3M',ADVO:'Advokasi',MEDINFO:'Medinfo'};
  select.innerHTML='<option value="">Pilih proker aktif…</option>'+programs.filter(program=>program.is_active).map(program=>`<option value="${escapeHTML(program.id)}">${escapeHTML(program.name)}${program.division?` · ${escapeHTML(divisionLabels[program.division]||program.division)}`:''}</option>`).join('');
  if(selected&&programs.some(program=>program.id===selected))select.value=selected;
  select.disabled=!programs.some(program=>program.is_active);
}
$('#agenda-program').addEventListener('change',()=>{
  const selectedProgram=programs.find(program=>program.id===$('#agenda-program').value);
  agendaForm.elements.title.value=selectedProgram?.name||'';
});
function clearProgramEditor() {
  if(!programForm)return;
  programForm.reset();
  $('#program-record-id').value='';
  programPhotoInput.required=true;
  $('#program-active').checked=true;
  programForm.elements.cycle.value='Tahunan';
  programForm.elements.planned_schedule.dataset.legacyValue='';
  programForm.elements.planned_schedule.dataset.clearLegacy='false';
  $('#program-schedule-legacy').hidden=true;
  $('#program-schedule-clear').hidden=true;
  $('#program-editor-title').textContent='Tambah proker';
  $('#save-program').innerHTML='Simpan proker <span aria-hidden="true">↗</span>';
  $('#program-photo-preview').hidden=true;
  showMessage('#program-editor-message','');
}
$('#program-form-reset').addEventListener('click',clearProgramEditor);
$('#program-refresh').addEventListener('click',loadPrograms);
programForm.elements.planned_schedule.addEventListener('input',()=>{
  const input=programForm.elements.planned_schedule;
  input.dataset.legacyValue='';
  input.dataset.clearLegacy='false';
  $('#program-schedule-legacy').hidden=true;
  $('#program-schedule-clear').hidden=true;
});
$('#program-schedule-clear').addEventListener('click',()=>{
  const input=programForm.elements.planned_schedule;
  input.value='';
  input.dataset.legacyValue='';
  input.dataset.clearLegacy='true';
  $('#program-schedule-legacy').hidden=true;
  $('#program-schedule-clear').hidden=true;
});
programPhotoInput.addEventListener('change',()=>{
  const file=programPhotoInput.files[0];
  const preview=$('#program-photo-preview');
  if(!file){preview.hidden=true;return;}
  const image=$('#program-photo-preview-image');
  if(image.dataset.objectUrl)URL.revokeObjectURL(image.dataset.objectUrl);
  const url=URL.createObjectURL(file);image.src=url;image.dataset.objectUrl=url;
  $('#program-photo-preview-label').textContent=file.name;
  preview.hidden=false;
});
programRecordList.addEventListener('click',async event=>{
  const button=event.target.closest('[data-program-action]');
  if(!button)return;
  const program=programs.find(item=>item.id===button.dataset.id);
  if(!program)return;
  if(button.dataset.programAction==='edit') {
    const detail=programDetails.get(program.id)||{};
    $('#program-record-id').value=program.id;
    programForm.elements.name.value=program.name;
    programForm.elements.division.value=program.division||'';
    programForm.elements.cycle.value=detail.cycle||'Tahunan';
    programForm.elements.period_label.value=detail.period_label||'';
    programForm.elements.description.value=detail.description||'';
    programForm.elements.goals.value=detail.goals||'';
    programForm.elements.target.value=detail.target||'';
    const schedule=String(detail.planned_schedule||'');
    const scheduleInput=programForm.elements.planned_schedule;
    scheduleInput.value=programDateInputValue(schedule);
    scheduleInput.dataset.legacyValue=schedule&&!scheduleInput.value?schedule:'';
    scheduleInput.dataset.clearLegacy='false';
    $('#program-schedule-legacy').textContent=scheduleInput.dataset.legacyValue?`Jadwal lama: ${schedule}`:'';
    $('#program-schedule-legacy').hidden=!scheduleInput.dataset.legacyValue;
    $('#program-schedule-clear').hidden=!scheduleInput.dataset.legacyValue;
    programForm.elements.pic.value=detail.pic||'';
    programForm.elements.budget_amount.value=detail.budget_amount??'';
    $('#program-active').checked=program.is_active;
    programPhotoInput.value='';
    programPhotoInput.required=false;
    $('#program-editor-title').textContent='Edit proker';
    $('#save-program').innerHTML='Simpan perubahan <span aria-hidden="true">↗</span>';
    $('#program-photo-preview-image').src=program.photo_url;
    $('#program-photo-preview-label').textContent='Foto yang tersimpan · pilih file baru untuk mengganti';
    $('#program-photo-preview').hidden=false;
    document.getElementById('program-name').focus();
    return;
  }
  if(button.dataset.programAction==='delete') {
    button.disabled=true;
    showMessage('#program-editor-message','Memeriksa agenda yang memakai proker ini…');
    try {
      const linkedAgendas=await api(`agenda?select=id,title,status&program_id=eq.${encodeURIComponent(program.id)}`);
      if(linkedAgendas.length) {
        const titles=linkedAgendas.map(item=>item.title).filter(Boolean).slice(0,2).join(' dan ');
        showMessage('#program-editor-message',`Proker masih terhubung ke ${linkedAgendas.length} agenda${titles?` (“${titles}”)`:''}. Hapus atau ganti proker pada agenda terkait terlebih dahulu agar histori agenda dan fotonya tetap utuh.`,'error');
        button.disabled=false;
        return;
      }
      if(!window.confirm(`Hapus proker “${program.name}” beserta foto dokumentasinya?`)) {
        showMessage('#program-editor-message','');
        button.disabled=false;
        return;
      }
      showMessage('#program-editor-message','Menghapus proker dan foto…');
      const removed=await api(`agenda_programs?id=eq.${encodeURIComponent(program.id)}`,{method:'DELETE',extraHeaders:{Prefer:'return=representation'}});
      if(!Array.isArray(removed)||!removed.some(item=>item.id===program.id))throw new Error('Proker tidak terhapus. Periksa akses akun lalu muat ulang.');
      let photoWarning='';
      try { await deleteProgramPhoto(program.photo_path); }
      catch { photoWarning='Proker terhapus, tetapi foto belum dapat dibersihkan dari penyimpanan.'; }
      const editingDeletedProgram=$('#program-record-id').value===program.id;
      if(editingDeletedProgram)clearProgramEditor();
      await Promise.all([loadPrograms(),loadAgenda()]);
      showMessage('#program-editor-message',photoWarning||'Proker dan foto berhasil dihapus.',photoWarning?'error':'success');
    } catch(error) {
      showMessage('#program-editor-message',`Proker belum terhapus: ${error.message}`,'error');
      button.disabled=false;
    }
    return;
  }
  button.disabled=true;
  try {
    await api(`agenda_programs?id=eq.${encodeURIComponent(program.id)}`,{method:'PATCH',body:{is_active:!program.is_active}});
    await loadPrograms();
    await loadAgenda();
  } catch(error) {
    alert(`Status proker belum berubah: ${error.message}`);
    button.disabled=false;
  }
});
programForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const submit=$('#save-program');
  const existingId=$('#program-record-id').value;
  const old=programs.find(item=>item.id===existingId);
  const file=programPhotoInput.files[0];
  const division=programForm.elements.division.value;
  if(!['BPH','PSDM','P3M','ADVO','MEDINFO'].includes(division)) {
    showMessage('#program-editor-message','Pilih divisi proker terlebih dahulu.','error');
    return;
  }
  if(!existingId&&!file) {
    showMessage('#program-editor-message','Pilih foto untuk proker ini.','error');
    return;
  }
  if(file&&!['image/jpeg','image/png','image/webp'].includes(file.type)) {
    showMessage('#program-editor-message','Gunakan file JPG, PNG, atau WebP.','error');
    return;
  }
  if(file&&file.size>8*1024*1024) {
    showMessage('#program-editor-message','Ukuran foto maksimal 8 MB.','error');
    return;
  }
  const id=existingId||crypto.randomUUID();
  let uploadedPath=null;
  submit.disabled=true;
  showMessage('#program-editor-message',file?'Mengunggah foto dan menyimpan proker…':'Menyimpan perubahan…');
  try {
    let photoPath=old?.photo_path,photoUrl=old?.photo_url;
    if(file) {
      const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
      uploadedPath=`${id}/${crypto.randomUUID()}.${extension}`;
      await uploadProgramPhoto(file,uploadedPath);
      photoPath=uploadedPath;photoUrl=objectUrl(uploadedPath);
    }
    const payload={name:programForm.elements.name.value.trim(),division,is_active:$('#program-active').checked};
    if(file){payload.photo_path=photoPath;payload.photo_url=photoUrl;}
    const rawBudget=programForm.elements.budget_amount.value;
    const detailPayload={program_id:id,cycle:programForm.elements.cycle.value.trim(),period_label:programForm.elements.period_label.value.trim()||null,
      description:programForm.elements.description.value.trim(),goals:programForm.elements.goals.value.trim(),target:programForm.elements.target.value.trim(),
      planned_schedule:programForm.elements.planned_schedule.value||(
        programForm.elements.planned_schedule.dataset.clearLegacy==='true'?'':programForm.elements.planned_schedule.dataset.legacyValue||''
      ),pic:programForm.elements.pic.value.trim(),budget_amount:rawBudget?Number(rawBudget):null};
    const saveDetails=()=>api('cssmora_program_details?on_conflict=program_id',{method:'POST',body:detailPayload,extraHeaders:{Prefer:'resolution=merge-duplicates,return=representation'}});
    if(existingId){
      await saveDetails();
      await api(`agenda_programs?id=eq.${encodeURIComponent(existingId)}`,{method:'PATCH',body:payload});
    }else{
      await api('agenda_programs',{method:'POST',body:{id,...payload,photo_path:photoPath,photo_url:photoUrl}});
      await saveDetails();
    }
    if(file&&old?.photo_path)await deleteProgramPhoto(old.photo_path).catch(()=>{});
    await loadPrograms();
    await loadAgenda();
    clearProgramEditor();
    showMessage('#program-editor-message',existingId?'Perubahan proker berhasil disimpan.':'Proker dan fotonya berhasil ditambahkan.','success');
  } catch(error) {
    if(!existingId&&uploadedPath)await api(`agenda_programs?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'}).catch(()=>{});
    if(uploadedPath)await deleteProgramPhoto(uploadedPath).catch(()=>{});
    showMessage('#program-editor-message',error.message,'error');
  } finally {
    submit.disabled=false;
  }
});

document.querySelectorAll('.agenda-admin-tab').forEach(tab=>tab.addEventListener('click',()=>{
  document.querySelectorAll('.agenda-admin-tab').forEach(item=>{
    const selected=item===tab;
    item.classList.toggle('is-active',selected);
    item.setAttribute('aria-selected',String(selected));
  });
  document.querySelectorAll('.agenda-admin-subpanel').forEach(panel=>{
    panel.hidden=panel.id!==tab.getAttribute('aria-controls');
  });
  $('#dashboard-title').textContent='Kegiatan · '+tab.textContent.replace(/^\d+\s*·\s*/,'').trim();
  if(tab.id==='tab-program-workflow')void window.CSSMoRAProgramWorkflow?.load();
}));
document.querySelector('[data-open-schedule]').addEventListener('click',()=>$('#tab-schedule').click());

const formatAgendaInput = value => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: agendaTimeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value)).filter(part => part.type !== 'literal').map(part => [part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
const formatAgendaDate = value => new Intl.DateTimeFormat('id-ID', {
  timeZone: agendaTimeZone, weekday: 'short', day: 'numeric', month: 'short',
  year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).format(new Date(value));
const agendaIso = value => value ? `${value}:00+07:00` : null;

async function loadAgenda() {
  loadedAdminData.delete('agenda');
  agendaRecordList.innerHTML='<p class="records-empty">Memuat agenda…</p>';
  try {
    const rows=await api('agenda?select=*&order=starts_at.asc');
    agendas=rows.map(item=>({...item,program:programs.find(program=>program.id===item.program_id)||null}));
    renderAgendas();
    loadedAdminData.add('agenda');
  } catch(error) {
    agendaRecordList.innerHTML=`<p class="records-empty">${escapeHTML(error.message)}</p>`;
  }
}

function renderAgendas() {
  $('#agenda-record-count').textContent=String(agendas.length);
  if(!agendas.length) {
    agendaRecordList.innerHTML='<p class="records-empty">Belum ada agenda. Tambahkan melalui formulir ini.</p>';
    return;
  }
  agendaRecordList.innerHTML=agendas.map(item=>`<article class="record-row agenda-record-row">
    <div><h4>${escapeHTML(item.title)}</h4><p>${item.program?`<strong>${escapeHTML(item.program.name)}</strong><br>`:''}${escapeHTML(formatAgendaDate(item.starts_at))} WIB${item.ends_at? ` – ${escapeHTML(formatAgendaDate(item.ends_at))} WIB`:''}${item.location?`<br>${escapeHTML(item.location)}`:''}</p><span class="record-status ${item.status==='published'?'published':''}">${item.status==='published'?'TERBIT':'DRAF'}</span></div>
    <div class="record-actions"><button type="button" data-agenda-action="edit" data-id="${escapeHTML(item.id)}">Edit</button><button type="button" class="delete" data-agenda-action="delete" data-id="${escapeHTML(item.id)}">Hapus</button></div>
  </article>`).join('');
}

function clearAgendaEditor() {
  agendaForm.reset();
  $('#agenda-record-id').value='';
  $('#agenda-editor-title').textContent='Tambah agenda';
  $('#save-agenda').innerHTML='Simpan agenda <span aria-hidden="true">↗</span>';
  showMessage('#agenda-editor-message','');
}

const adminShell=document.querySelector('.admin-app-shell');
const sidebarToggle=$('#sidebar-toggle');
const sidebarScrim=$('#sidebar-scrim');
const isNarrowAdmin=()=>window.matchMedia('(max-width:900px)').matches;
sidebarToggle.setAttribute('aria-expanded',String(!isNarrowAdmin()));
window.addEventListener('resize',()=>{
  if(isNarrowAdmin()){
    adminShell.classList.remove('is-sidebar-collapsed');
    sidebarToggle.setAttribute('aria-expanded',String(adminShell.classList.contains('is-sidebar-open')));
  }else{
    adminShell.classList.remove('is-sidebar-open');
    sidebarToggle.setAttribute('aria-expanded',String(!adminShell.classList.contains('is-sidebar-collapsed')));
  }
});
sidebarToggle.addEventListener('click',()=>{
  if(isNarrowAdmin()){
    const open=adminShell.classList.toggle('is-sidebar-open');
    sidebarToggle.setAttribute('aria-expanded',String(open));
  }else{
    const collapsed=adminShell.classList.toggle('is-sidebar-collapsed');
    sidebarToggle.setAttribute('aria-expanded',String(!collapsed));
  }
});
const closeMobileSidebar=()=>{
  if(!isNarrowAdmin())return;
  adminShell.classList.remove('is-sidebar-open');
  sidebarToggle.setAttribute('aria-expanded','false');
};
sidebarScrim.addEventListener('click',closeMobileSidebar);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape')closeMobileSidebar();
});

document.querySelectorAll('.admin-tab').forEach(tab=>tab.addEventListener('click',()=>{
  const previousTab=document.querySelector('.admin-tab.is-active');
  if(previousTab?.id==='tab-achievements'&&tab.id!=='tab-achievements')expandedAchievementIds.clear();
  document.querySelectorAll('.admin-tab').forEach(item=>{
    const selected=item===tab;
    item.classList.toggle('is-active',selected);
    item.setAttribute('aria-selected',String(selected));
  });
  try{localStorage.setItem('cssmora-admin-active-tab',tab.id);}catch{}
  document.querySelectorAll('.management-panel').forEach(panel=>{
    panel.hidden=panel.id!==tab.getAttribute('aria-controls');
  });
  const label=tab.querySelector('.module-copy strong')?.textContent.trim();
  if(label)$('#dashboard-title').textContent=label;
  closeMobileSidebar();
  const activePanel=document.getElementById(tab.getAttribute('aria-controls'));
  if(activePanel)void loadAdminPanel(activePanel.id);
}));

$('#agenda-form-reset').addEventListener('click',clearAgendaEditor);
$('#agenda-refresh').addEventListener('click',loadAgenda);

agendaRecordList.addEventListener('click',async event=>{
  const button=event.target.closest('[data-agenda-action]');
  if(!button)return;
  const item=agendas.find(row=>row.id===button.dataset.id);
  if(!item)return;
  if(button.dataset.agendaAction==='edit') {
    $('#agenda-record-id').value=item.id;
    agendaForm.elements.programId.value=item.program_id||'';
    agendaForm.elements.title.value=item.title||'';
    agendaForm.elements.startsAt.value=formatAgendaInput(item.starts_at);
    agendaForm.elements.endsAt.value=item.ends_at?formatAgendaInput(item.ends_at):'';
    agendaForm.elements.location.value=item.location||'';
    agendaForm.elements.description.value=item.description||'';
    agendaForm.elements.published.checked=item.status==='published';
    $('#agenda-editor-title').textContent='Edit agenda';
    $('#save-agenda').innerHTML='Simpan perubahan <span aria-hidden="true">↗</span>';
    $('#agenda-title-input').focus();
    return;
  }
  if(button.dataset.agendaAction==='delete'&&confirm(`Hapus agenda “${item.title}”?`)) {
    button.disabled=true;
    try {
      await api(`agenda?id=eq.${encodeURIComponent(item.id)}`,{method:'DELETE'});
      agendas=agendas.filter(row=>row.id!==item.id);
      renderAgendas();
      if($('#agenda-record-id').value===item.id)clearAgendaEditor();
    } catch(error) {
      alert(`Agenda belum terhapus: ${error.message}`);
      button.disabled=false;
    }
  }
});


const generateAnnouncementButton=$('#generate-announcement');
const announcementPreview=$('#agenda-announcement-preview');
const announcementStatus=$('#agenda-announcement-status');
generateAnnouncementButton.addEventListener('click',async()=>{
  const title=agendaForm.elements.title.value.trim();
  const starts=agendaForm.elements.startsAt.value;
  if(!title||!starts){
    announcementStatus.textContent='Isi nama kegiatan dan waktu mulai terlebih dahulu.';
    announcementStatus.dataset.kind='error';
    return;
  }
  const date=new Date(agendaIso(starts));
  const endValue=agendaForm.elements.endsAt.value;
  const end=endValue?new Date(agendaIso(endValue)):null;
  const dateFmt=new Intl.DateTimeFormat('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:agendaTimeZone});
  const timeFmt=new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:agendaTimeZone});
  const program=programs.find(item=>item.id===agendaForm.elements.programId.value);
  generateAnnouncementButton.disabled=true;
  generateAnnouncementButton.textContent='Menyusun…';
  announcementStatus.textContent='AI sedang merapikan jarkoman…';
  announcementStatus.dataset.kind='';
  try{
    const response=await authenticatedFetch(`${config.url}/functions/v1/generate-announcement`,{
      method:'POST',timeoutMs:35000,
      headers:{...baseHeaders(),Authorization:`Bearer ${session.access_token}`},
      body:JSON.stringify({
        title,
        programName:program?.name||'',
        date:dateFmt.format(date),
        time:timeFmt.format(date)+' WIB'+(end?'–'+timeFmt.format(end)+' WIB':'–selesai'),
        location:agendaForm.elements.location.value.trim(),
        description:agendaForm.elements.description.value.trim()
      })
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||'Jarkoman belum berhasil dibuat. Coba lagi.');
    announcementPreview.value=result.announcement||'';
    announcementPreview.dispatchEvent(new Event('input',{bubbles:true}));
    announcementStatus.textContent='Jarkoman siap ditinjau. Silakan sesuaikan sebelum dibagikan.';
    announcementStatus.dataset.kind='success';
  }catch(error){
    announcementStatus.textContent=error.message;
    announcementStatus.dataset.kind='error';
  }finally{
    generateAnnouncementButton.disabled=false;
    generateAnnouncementButton.textContent='Buat jarkoman ✦';
  }
});
announcementPreview.addEventListener('input',()=>{$('#copy-announcement').disabled=!announcementPreview.value.trim();});
$('#copy-announcement').addEventListener('click',async()=>{
  if(!announcementPreview.value.trim())return;
  try{
    await navigator.clipboard.writeText(announcementPreview.value);
    announcementStatus.textContent='Teks jarkoman disalin.';
    announcementStatus.dataset.kind='success';
  }catch{
    announcementPreview.focus();announcementPreview.select();
    const copied=document.execCommand('copy');
    announcementStatus.textContent=copied?'Teks jarkoman disalin.':'Pilih teks lalu salin secara manual.';
    announcementStatus.dataset.kind=copied?'success':'error';
  }
});

agendaForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const submit=$('#save-agenda');
  const starts=agendaForm.elements.startsAt.value;
  const ends=agendaForm.elements.endsAt.value;
  if(ends&&new Date(agendaIso(ends))<=new Date(agendaIso(starts))) {
    showMessage('#agenda-editor-message','Waktu selesai harus setelah waktu mulai.','error');
    return;
  }
  const existingId=$('#agenda-record-id').value;
  const payload={
    title:agendaForm.elements.title.value.trim(),
    starts_at:agendaIso(starts),
    ends_at:agendaIso(ends),
    location:agendaForm.elements.location.value.trim()||null,
    description:agendaForm.elements.description.value.trim()||null,
    status:agendaForm.elements.published.checked?'published':'draft',
    program_id:agendaForm.elements.programId.value
  };
  submit.disabled=true;
  showMessage('#agenda-editor-message','Menyimpan…');
  try {
    if(existingId) {
      await api(`agenda?id=eq.${encodeURIComponent(existingId)}`,{method:'PATCH',body:payload});
      showMessage('#agenda-editor-message','Perubahan agenda berhasil disimpan.','success');
    } else {
      await api('agenda',{method:'POST',body:payload});
      showMessage('#agenda-editor-message','Agenda berhasil ditambahkan.','success');
    }
    await loadAgenda();
    clearAgendaEditor();
    showMessage('#agenda-editor-message',existingId?'Perubahan agenda berhasil disimpan.':'Agenda berhasil ditambahkan.','success');
  } catch(error) {
    showMessage('#agenda-editor-message',error.message,'error');
  } finally {
    submit.disabled=false;
  }
});


const memberForm=$('#member-form');
const memberList=$('#member-record-list');
const attendanceEventList=$('#attendance-event-list');
const attendanceRosterPanel=$('#attendance-roster-panel');
const letterForm=$('#letter-form');
let members=[];
let attendanceEvents=[];
let currentAttendanceEvent=null;
let currentAttendanceRows=[];

const memberById=id=>members.find(member=>member.id===id);
const localDateInput=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const csvCell=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
function downloadCSV(name,rows){
  const csv='\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function parseCSV(text){
  const delimiter=(text.split(/\r?\n/,1)[0].match(/;/g)||[]).length>(text.split(/\r?\n/,1)[0].match(/,/g)||[]).length?';':',';
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted&&ch==='"'&&text[i+1]==='"'){cell+='"';i++;}
    else if(ch==='"')quoted=!quoted;
    else if(ch===delimiter&&!quoted){row.push(cell);cell='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}
    else cell+=ch;
  }
  if(cell||row.length){row.push(cell);if(row.some(v=>v.trim()))rows.push(row);}
  return rows;
}
const normHeader=value=>String(value||'').replace(/^\uFEFF/,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
function showSecretaryTab(tab){
  document.querySelectorAll('.secretariat-tab').forEach(item=>{
    const selected=item===tab;
    item.classList.toggle('is-active',selected);
    item.setAttribute('aria-selected',String(selected));
  });
  document.querySelectorAll('.secretariat-subpanel').forEach(panel=>{
    panel.hidden=panel.id!==tab.getAttribute('aria-controls');
  });
}
function initializeSecretaryForms(){
  if(!$('#letter-issued-on').value)$('#letter-issued-on').value=localDateInput();
}
async function loadSecretarySection(tab){
  if(!tab)return;
  const panel=tab.getAttribute('aria-controls');
  if(panel==='members-panel') {
    await ensureAdminData('members',loadMembers);
  } else if(panel==='attendance-tools-panel') {
    await Promise.all([
      loadMembers(),
      loadAttendanceEvents()
    ]);
  } else if(panel==='letters-panel') {
    await ensureAdminData('letters',loadLetters);
  }
}
document.querySelectorAll('.letter-work-tab').forEach(tab=>tab.addEventListener('click',()=>{
  document.querySelectorAll('.letter-work-tab').forEach(item=>{
    const selected=item===tab;
    item.classList.toggle('is-active',selected);
    item.setAttribute('aria-selected',String(selected));
  });
  document.querySelectorAll('.letter-work-panel').forEach(panel=>{panel.hidden=panel.id!==tab.getAttribute('aria-controls');});
  $('#dashboard-title').textContent='Sekretaris · Persuratan · '+tab.textContent.trim();
}));
document.querySelectorAll('.secretariat-tab').forEach(tab=>tab.addEventListener('click',()=>{
  showSecretaryTab(tab);
  $('#dashboard-title').textContent='Sekretaris · '+tab.textContent.trim();
  void loadSecretarySection(tab);
}));
async function loadMembers(){
  loadedAdminData.delete('members');
  memberList.setAttribute('aria-busy','true');
  memberList.closest('.secretariat-table-wrap')?.setAttribute('aria-busy','true');
  $('#member-count').textContent='Memuat…';
  memberList.innerHTML='<tr><td colspan="5"><div class="table-loading"><span class="table-spinner" aria-hidden="true"></span><span>Memuat data anggota…</span></div></td></tr>';
  try{
    members=await api('secretariat_members?select=*&order=cohort.desc,full_name.asc');
    updateMemberFilterOptions();
    updateMemberCount();
    renderMembers();
    loadedAdminData.add('members');
    if(currentAttendanceEvent)await loadAttendanceRoster(currentAttendanceEvent.id);
  }catch(error){
    $('#member-count').textContent='Gagal dimuat';
    memberList.innerHTML='<tr><td colspan="5"><div class="table-load-error"><span>'+escapeHTML(error.message)+'</span><button type="button" data-retry-members>Coba lagi</button></div></td></tr>';
  }finally{
    memberList.removeAttribute('aria-busy');
    memberList.closest('.secretariat-table-wrap')?.removeAttribute('aria-busy');
  }
}
function updateMemberFilterOptions(){
  const fill=(selector,values,allLabel)=>{
    const node=$(selector);
    const current=node.value||'all';
    node.innerHTML='<option value="all">'+allLabel+'</option>'+values.map(value=>'<option value="'+escapeHTML(value)+'">'+escapeHTML(value)+'</option>').join('');
    if(values.includes(current))node.value=current;
  };
  const cohorts=[...new Set(members.map(member=>String(member.cohort||'').trim()).filter(Boolean))]
    .sort((a,b)=>Number(b)-Number(a)||a.localeCompare(b,'id'));
  const programs=[...new Set(members.map(member=>String(member.study_program||'').trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'id'));
  fill('#member-cohort-filter',cohorts,'Semua');
  fill('#member-program-filter',programs,'Semua prodi');
}
function memberStudyStatusLabel(status){
  return ({mahasiswa:'Masih mahasiswa',lulus:'Lulus',belum_ditentukan:'Belum diisi'})[status]||'Belum diisi';
}
function normalizeMemberStudyStatus(value){
  const normalized=String(value||'').trim().toLowerCase().replace(/[_-]+/g,' ');
  if(['lulus','sudah lulus','alumni','lulusan'].includes(normalized))return 'lulus';
  if(['mahasiswa','masih mahasiswa','belum lulus','aktif kuliah'].includes(normalized))return 'mahasiswa';
  return 'belum_ditentukan';
}
function updateMemberCount(){
  $('#member-count').textContent=members.length+' anggota';
}
function renderMembers(){
  const query=$('#member-search').value.trim().toLowerCase();
  const cohort=$('#member-cohort-filter').value;
  const program=$('#member-program-filter').value;
  const status=$('#member-study-status-filter').value;
  const rows=members.filter(member=>{
    const cohortMatches=cohort==='all'||String(member.cohort)===cohort;
    const programMatches=program==='all'||String(member.study_program||'')===program;
    const studyStatus=member.study_status||'belum_ditentukan';
    const statusMatches=status==='all'||studyStatus===status;
    const queryMatches=!query||[member.nia,member.full_name,member.cohort,member.faculty,member.study_program].some(value=>String(value||'').toLowerCase().includes(query));
    return cohortMatches&&programMatches&&statusMatches&&queryMatches;
  });
  $('#member-visible-count').textContent=rows.length+' data';
  if(!rows.length){memberList.innerHTML='<tr><td colspan="5" class="records-empty">Belum ada anggota yang cocok.</td></tr>';return;}
  memberList.innerHTML=rows.map(member=>{
    const status=member.study_status||'belum_ditentukan';
    const statusClass=status==='mahasiswa'?'published':status==='lulus'?'study-graduate':'study-unknown';
    return '<tr><td><strong>'+escapeHTML(member.full_name)+'</strong><small>'+escapeHTML(member.nia)+'</small></td><td>'+escapeHTML(member.cohort)+'</td><td>'+escapeHTML(member.study_program||'—')+'</td><td><span class="record-status '+statusClass+'">'+escapeHTML(memberStudyStatusLabel(status))+'</span></td><td><div class="record-actions"><button type="button" data-member-action="edit" data-id="'+escapeHTML(member.id)+'">Edit</button></div></td></tr>';
  }).join('');
}
function resetMemberForm(){
  memberForm.reset();$('#member-record-id').value='';$('#member-active').checked=true;$('#member-nia').readOnly=false;
  $('#member-editor-title').textContent='Tambah anggota';
  $('#save-member').innerHTML='Simpan anggota <span aria-hidden="true">↗</span>';
  showMessage('#member-message','');
}
$('#member-form-reset').addEventListener('click',resetMemberForm);
$('#members-refresh').addEventListener('click',loadMembers);
$('#member-search').addEventListener('input',renderMembers);
$('#member-cohort-filter').addEventListener('change',renderMembers);
$('#member-program-filter').addEventListener('change',renderMembers);
$('#member-study-status-filter').addEventListener('change',renderMembers);
$('#member-export').addEventListener('click',()=>downloadCSV('cssmora-anggota.csv',[
  ['NIA','Nama','Angkatan','Fakultas','Program Studi','Status Studi'],
  ...members.map(member=>[member.nia,member.full_name,member.cohort,member.faculty,member.study_program,memberStudyStatusLabel(member.study_status||'belum_ditentukan')])
]));
memberList.addEventListener('click',event=>{
  const retry=event.target.closest('[data-retry-members]');
  if(retry){void ensureAdminData('members',loadMembers);return;}
  const button=event.target.closest('[data-member-action="edit"]');
  if(!button)return;
  const member=memberById(button.dataset.id);if(!member)return;
  $('#member-record-id').value=member.id;
  $('#member-nia').value=member.nia;$('#member-nia').readOnly=true;
  $('#member-name').value=member.full_name;$('#member-cohort').value=member.cohort;
  $('#member-faculty').value=member.faculty||'';$('#member-program').value=member.study_program||'';
  $('#member-study-status').value=member.study_status||'belum_ditentukan';
  $('#member-active').checked=member.is_active;
  $('#member-editor-title').textContent='Edit anggota';
  $('#save-member').innerHTML='Simpan perubahan <span aria-hidden="true">↗</span>';
  $('#member-name').focus();
});
memberForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const id=$('#member-record-id').value;
  const payload={nia:$('#member-nia').value.trim(),full_name:$('#member-name').value.trim(),cohort:Number($('#member-cohort').value),faculty:$('#member-faculty').value.trim()||null,study_program:$('#member-program').value.trim()||null,study_status:$('#member-study-status').value||'belum_ditentukan',is_active:$('#member-active').checked,updated_at:new Date().toISOString()};
  $('#save-member').disabled=true;showMessage('#member-message','Menyimpan data anggota…');
  try{
    if(id)await api('secretariat_members?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:payload});
    else await api('secretariat_members',{method:'POST',body:payload});
    resetMemberForm();await loadMembers();showMessage('#member-message',id?'Perubahan anggota disimpan.':'Anggota berhasil ditambahkan.','success');
  }catch(error){showMessage('#member-message',error.message,'error');}
  finally{$('#save-member').disabled=false;$('#member-nia').readOnly=false;}
});
$('#member-csv').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    const matrix=parseCSV(await file.text());if(matrix.length<2)throw new Error('CSV belum berisi baris data.');
    const headers=matrix[0].map(normHeader);
    const find=keys=>headers.findIndex(header=>keys.some(key=>header===key||header.includes(key)));
    const columns={nia:find(['nia','nomor induk']),name:find(['nama lengkap','nama']),cohort:find(['angkatan','tahun masuk']),faculty:find(['fakultas']),program:find(['jurusan','program studi','prodi']),studyStatus:find(['status studi','status kuliah','status pendidikan','status'])};
    if(columns.nia<0||columns.name<0||columns.cohort<0)throw new Error('Kolom wajib belum ditemukan. Gunakan NIA, Nama, dan Angkatan.');
    const imported=matrix.slice(1).map(row=>{
      const member={
        nia:(row[columns.nia]||'').trim(),
        full_name:(row[columns.name]||'').trim(),
        cohort:Number(row[columns.cohort]),
        faculty:columns.faculty<0?null:(row[columns.faculty]||'').trim()||null,
        study_program:columns.program<0?null:(row[columns.program]||'').trim()||null,
        updated_at:new Date().toISOString()
      };
      const statusValue=columns.studyStatus<0?'':String(row[columns.studyStatus]||'').trim();
      if(statusValue)member.study_status=normalizeMemberStudyStatus(statusValue);
      return member;
    }).filter(member=>member.nia&&member.full_name&&Number.isInteger(member.cohort));
    if(!imported.length)throw new Error('Tidak ada baris anggota yang valid.');
    await api('secretariat_members?on_conflict=nia',{method:'POST',body:imported,extraHeaders:{Prefer:'resolution=merge-duplicates,return=minimal'}});
    showMessage('#member-list-message',imported.length+' data anggota berhasil diimpor.','success');await loadMembers();
  }catch(error){showMessage('#member-list-message','Impor gagal: '+error.message,'error');}
  finally{event.target.value='';}
});

async function loadAttendanceEvents(){
  attendanceEventList.innerHTML='<p class="records-empty">Memuat agenda…</p>';
  try{
    const rows=await api('secretariat_attendance_events?select=*,agenda(id,title,starts_at,ends_at,status)&order=created_at.desc,event_date.desc');
    attendanceEvents=(rows||[]).map(row=>({...row,agenda:Array.isArray(row.agenda)?row.agenda[0]||null:row.agenda||null}));
    renderAttendanceEvents();
    attendanceEventList.scrollTop=0;
    loadedAdminData.add('attendanceEvents');
    if(currentAttendanceEvent)currentAttendanceEvent=attendanceEvents.find(row=>row.id===currentAttendanceEvent.id)||null;
  }catch(error){
    loadedAdminData.delete('attendanceEvents');
    attendanceEventList.innerHTML='<p class="records-empty">'+escapeHTML(error.message)+'</p>';
  }
}
function attendanceEventIsPublished(event){return event?.agenda?.status==='published';}
function attendanceWibNowInputValue(){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function attendanceWibInputToIso(value){
  const normalized=value.length===16?value+':00':value;
  const date=new Date(normalized+'+07:00');
  return Number.isFinite(date.getTime())?date.toISOString():null;
}
function attendanceDeadlineLabel(value){
  if(!value)return '';
  return new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value))+' WIB';
}
function renderAttendanceEvents(){
  const search=($('#attendance-event-filter').value||'').trim().toLocaleLowerCase('id-ID');
  const visible=attendanceEvents.filter(event=>!search||[event.title,event.agenda?.title,event.event_date,event.location].some(value=>String(value||'').toLocaleLowerCase('id-ID').includes(search)));
  if(!attendanceEvents.length){attendanceEventList.innerHTML='<p class="records-empty">Belum ada agenda terbit untuk absensi.</p>';return;}
  if(!visible.length){attendanceEventList.innerHTML='<p class="records-empty">Agenda yang cocok tidak ditemukan.</p>';return;}
  attendanceEventList.innerHTML=visible.map(event=>{
    const published=attendanceEventIsPublished(event);
    const source=published?'AGENDA TERBIT':event.agenda_id?'AGENDA TIDAK TERBIT':'TANPA AGENDA';
    const sourceClass=published?'':' is-muted';
    const title=event.agenda?.title||event.title;
    const status=event.status==='open'?'ABSENSI DIBUKA':'DITUTUP';
    const deadline=event.auto_close_at?'<span class="attendance-auto-close-label">Tutup otomatis '+escapeHTML(attendanceDeadlineLabel(event.auto_close_at))+'</span>':'';
    const copy=published?'<button type="button" data-copy-event="'+escapeHTML(event.id)+'">Salin tautan</button>':'';
    const toggle=published?'<button type="button" data-toggle-event="'+escapeHTML(event.id)+'">'+(event.status==='open'?'Tutup absensi':'Buka absensi')+'</button>':'';
    const remove=!published?'<button type="button" data-delete-event="'+escapeHTML(event.id)+'">Hapus data</button>':'';
    return '<article class="attendance-event-card" data-agenda-state="'+(published?'published':'unpublished')+'"><button type="button" class="secretariat-record-select" data-event-id="'+escapeHTML(event.id)+'"><span><strong>'+escapeHTML(title)+'</strong><small class="attendance-event-meta-line">'+escapeHTML(event.event_date)+' · '+escapeHTML(event.session_name||'Umum')+(event.location?' · '+escapeHTML(event.location):'')+' <span class="attendance-event-badge'+sourceClass+'">'+source+'</span>'+deadline+'</small></span><span class="record-status '+(event.status==='open'&&published?'published':'')+'">'+status+'</span></button><div class="attendance-event-actions">'+copy+toggle+remove+'</div></article>';
  }).join('');
}
$('#attendance-event-filter').addEventListener('input',renderAttendanceEvents);
let attendanceRecapRows=[];
let attendanceOpenEventId=null;
async function refreshAttendanceData(){
  const selectedId=currentAttendanceEvent?.id;
  await Promise.all([loadMembers(),loadAttendanceEvents(),$('#attendance-recap-card').hidden?Promise.resolve():loadAttendanceRecap()]);
  if(selectedId){
    if(attendanceEvents.some(row=>row.id===selectedId)){
      if(!attendanceRosterDirty)await loadAttendanceRoster(selectedId);
    }else{currentAttendanceEvent=null;attendanceRosterPanel.hidden=true;}
  }
}
$('#events-refresh').addEventListener('click',refreshAttendanceData);
async function deleteAttendanceEvent(eventId){
  const endpoint=config.url+'/functions/v1/attendance-checkin?mode=delete-event&event_id='+encodeURIComponent(eventId);
  const response=await authenticatedFetch(endpoint,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:'{}'});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||'Data absensi belum dapat dihapus.');
  return result;
}
attendanceEventList.addEventListener('click',async event=>{
  const copy=event.target.closest('[data-copy-event]');
  if(copy){
    const item=attendanceEvents.find(row=>row.id===copy.dataset.copyEvent);
    if(!item||!attendanceEventIsPublished(item))return;
    const link=window.location.origin+'/absen.html?t='+encodeURIComponent(item.public_token);
    try{await navigator.clipboard.writeText(link);showMessage('#event-message','Tautan absensi tersalin.','success');}
    catch{showMessage('#event-message','Salin tautan ini: '+link,'success');}
    return;
  }
  const toggle=event.target.closest('[data-toggle-event]');
  if(toggle){
    const item=attendanceEvents.find(row=>row.id===toggle.dataset.toggleEvent);if(!item||!attendanceEventIsPublished(item))return;
    if(currentAttendanceEvent?.id===item.id&&attendanceRosterDirty){showMessage('#event-message','Simpan atau buang perubahan rekap sebelum mengubah status absensi.','error');return;}
    if(item.status!=='open'){
      attendanceOpenEventId=item.id;
      $('#attendance-open-event-name').textContent=item.agenda?.title||item.title;
      $('#attendance-auto-close-at').value='';
      $('#attendance-auto-close-at').min=attendanceWibNowInputValue();
      $('#attendance-open-message').textContent='';
      $('#attendance-open-message').dataset.kind='';
      $('#attendance-open-dialog').showModal();
      return;
    }
    toggle.disabled=true;
    try{
      await api('secretariat_attendance_events?id=eq.'+encodeURIComponent(item.id),{method:'PATCH',body:{status:'closed',auto_close_at:null}});
      await loadAttendanceEvents();
      if(currentAttendanceEvent?.id===item.id)await loadAttendanceRoster(item.id);
    }catch(error){showMessage('#event-message',error.message,'error');toggle.disabled=false;}
    return;
  }
  const remove=event.target.closest('[data-delete-event]');
  if(remove){
    const item=attendanceEvents.find(row=>row.id===remove.dataset.deleteEvent);
    if(!item||attendanceEventIsPublished(item))return;
    if(!window.confirm('Hapus daftar hadir, seluruh rekap, dan foto buktinya? Agenda kalender tetap tersimpan.'))return;
    remove.disabled=true;showMessage('#event-message','Menghapus data absensi…');
    try{
      await deleteAttendanceEvent(item.id);
      if(currentAttendanceEvent?.id===item.id){currentAttendanceEvent=null;currentAttendanceRows=[];attendanceRosterDrafts.clear();attendanceRosterDirty=false;attendanceRosterPanel.hidden=true;}
      await Promise.all([loadAttendanceEvents(),$('#attendance-recap-card').hidden?Promise.resolve():loadAttendanceRecap()]);
      showMessage('#event-message','Daftar hadir dan datanya berhasil dihapus.','success');
    }catch(error){showMessage('#event-message',error.message,'error');remove.disabled=false;}
    return;
  }
  const select=event.target.closest('[data-event-id]');if(select)await loadAttendanceRoster(select.dataset.eventId);
});
$('#attendance-open-cancel').addEventListener('click',()=>{attendanceOpenEventId=null;$('#attendance-open-dialog').close();});
$('#attendance-open-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const item=attendanceEvents.find(row=>row.id===attendanceOpenEventId);
  if(!item||!attendanceEventIsPublished(item))return;
  const input=$('#attendance-auto-close-at'),message=$('#attendance-open-message'),button=$('#attendance-open-submit');
  let autoCloseAt=null;
  if(input.value){
    autoCloseAt=attendanceWibInputToIso(input.value);
    if(!autoCloseAt||Date.parse(autoCloseAt)<=Date.now()){
      message.textContent='Pilih batas waktu setelah waktu sekarang.';message.dataset.kind='error';return;
    }
  }
  button.disabled=true;message.textContent='Membuka absensi…';message.dataset.kind='';
  try{
    await api('secretariat_attendance_events?id=eq.'+encodeURIComponent(item.id),{method:'PATCH',body:{status:'open',auto_close_at:autoCloseAt}});
    $('#attendance-open-dialog').close();
    attendanceOpenEventId=null;
    await loadAttendanceEvents();
    if(currentAttendanceEvent?.id===item.id)await loadAttendanceRoster(item.id);
    showMessage('#event-message',autoCloseAt?'Absensi dibuka dan akan ditutup otomatis sesuai batas waktu.':'Absensi dibuka. Tutup manual saat kegiatan selesai.','success');
  }catch(error){message.textContent=error.message;message.dataset.kind='error';}
  finally{button.disabled=false;}
});
async function loadAttendanceRecap(){
  const list=$('#attendance-recap');
  list.innerHTML='<tr><td colspan="5" class="records-empty">Memuat rekap kehadiran…</td></tr>';
  try{
    attendanceRecapRows=await api('rpc/get_secretariat_attendance_recap',{method:'POST',body:{}})||[];
    renderAttendanceRecap();
  }catch(error){
    attendanceRecapRows=[];
    $('#attendance-recap-summary').innerHTML='';
    list.innerHTML='<tr><td colspan="5" class="records-empty">'+escapeHTML(error.message)+'</td></tr>';
  }
}
$('#attendance-recap-toggle').addEventListener('click',async()=>{
  const button=$('#attendance-recap-toggle'),card=$('#attendance-recap-card'),show=card.hidden;
  card.hidden=!show;
  button.setAttribute('aria-expanded',String(show));
  button.querySelector('[data-attendance-recap-label]').textContent=show?'Tutup akumulasi absen':'Lihat akumulasi absen';
  if(show)await loadAttendanceRecap();
});
let attendanceDeadlineRefreshRunning=false;
setInterval(async()=>{
  if(document.hidden||$('#attendance-tools-panel').hidden||attendanceDeadlineRefreshRunning)return;
  const due=attendanceEvents.some(row=>row.status==='open'&&row.auto_close_at&&Date.parse(row.auto_close_at)<=Date.now());
  if(!due)return;
  attendanceDeadlineRefreshRunning=true;
  const selectedId=currentAttendanceEvent?.id,wasOpen=currentAttendanceEvent?.status==='open';
  try{
    await loadAttendanceEvents();
    if(selectedId&&wasOpen&&currentAttendanceEvent?.status==='closed'&&!attendanceRosterDirty)await loadAttendanceRoster(selectedId);
  }catch{}finally{attendanceDeadlineRefreshRunning=false;}
},15000);
function renderAttendanceRecap(){
  const totalEvents=Number(attendanceRecapRows[0]?.completed_event_count||0);
  const attended=attendanceRecapRows.reduce((sum,row)=>sum+Number(row.attended_count||0),0);
  const eligible=attendanceRecapRows.reduce((sum,row)=>sum+Number(row.eligible_count||0),0);
  const rate=eligible?Math.round(attended*1000/eligible)/10:0;
  $('#attendance-recap-summary').innerHTML='<span><strong>'+totalEvents+'</strong> agenda selesai</span><span><strong>'+rate+'%</strong> rata-rata kehadiran</span><span><strong>'+attendanceRecapRows.length+'</strong> anggota</span>';
  if(!attendanceRecapRows.length){$('#attendance-recap').innerHTML='<tr><td colspan="5" class="records-empty">Belum ada data anggota untuk direkap.</td></tr>';return;}
  const search=($('#attendance-recap-filter').value||'').trim().toLocaleLowerCase('id-ID');
  const rows=attendanceRecapRows.filter(row=>!search||String(row.full_name||'').toLocaleLowerCase('id-ID').includes(search)||String(row.nia||'').toLocaleLowerCase('id-ID').includes(search));
  if(!rows.length){$('#attendance-recap').innerHTML='<tr><td colspan="5" class="records-empty">Anggota yang cocok tidak ditemukan.</td></tr>';return;}
  $('#attendance-recap').innerHTML=rows.map(row=>{
    const percent=Math.max(0,Math.min(100,Number(row.attendance_percent)||0));
    return '<tr><td><strong>'+escapeHTML(row.full_name)+'</strong><small>Angkatan '+escapeHTML(row.cohort)+'</small></td><td>'+escapeHTML(row.nia)+'</td><td>'+Number(row.attended_count||0)+'</td><td>'+Number(row.eligible_count||0)+'</td><td><span class="attendance-rate"><span class="attendance-rate-track" aria-hidden="true"><i style="width:'+percent+'%"></i></span>'+percent+'%</span></td></tr>';
  }).join('');
}
$('#attendance-recap-filter').addEventListener('input',renderAttendanceRecap);
function attendanceStatusLabel(status){return({hadir:'Hadir',izin:'Izin',sakit:'Sakit',alpa:'Tanpa keterangan',belum:'Belum dicatat'})[status]||status;}
let attendanceRosterRequest=0;
let attendanceRosterLoading=false;
let attendanceRosterDirty=false;
const attendanceRosterDrafts=new Map();
function captureAttendanceRosterDrafts(){
  currentAttendanceRows.forEach(row=>{
    const select=document.querySelector('[data-attendance-status="'+CSS.escape(row.member_id)+'"]');
    const reason=document.querySelector('[data-attendance-reason="'+CSS.escape(row.member_id)+'"]');
    if(!select||!reason)return;
    const draft={status:select.value,reason:reason.value.trim()};
    if(draft.status===row.status&&draft.reason===(row.reason||'').trim())attendanceRosterDrafts.delete(row.member_id);
    else attendanceRosterDrafts.set(row.member_id,draft);
  });
  attendanceRosterDirty=attendanceRosterDrafts.size>0;
}
function attendanceRosterHasChanges(){return attendanceRosterDirty;}
function updateAttendanceSaveState(){
  captureAttendanceRosterDrafts();
  $('#attendance-save').disabled=!currentAttendanceEvent||currentAttendanceEvent.status==='closed'||!attendanceEventIsPublished(currentAttendanceEvent)||!attendanceRosterDirty;
}
async function loadAttendanceRoster(eventId){
  const selected=attendanceEvents.find(event=>event.id===eventId);if(!selected)return;
  if(currentAttendanceEvent&&attendanceRosterDirty&&!window.confirm('Buang perubahan rekap yang belum disimpan?'))return;
  const requestId=++attendanceRosterRequest;
  currentAttendanceEvent=selected;currentAttendanceRows=[];attendanceRosterDrafts.clear();attendanceRosterLoading=true;attendanceRosterDirty=false;attendanceRosterPanel.hidden=false;
  $('#attendance-save').disabled=true;
  $('#attendance-roster-title').textContent=selected.agenda?.title||selected.title;
  $('#attendance-event-meta').textContent=selected.event_date+' · '+(selected.session_name||'Umum')+(selected.location?' · '+selected.location:'')+(selected.agenda?.status==='published'?'':' · Agenda tidak terbit');
  $('#attendance-summary').textContent='';
  $('#attendance-roster').innerHTML='<tr><td colspan="4" class="records-empty">Memuat daftar anggota…</td></tr>';
  try{
    const rows=await api('secretariat_attendance_records?select=*&event_id=eq.'+encodeURIComponent(eventId));
    if(requestId!==attendanceRosterRequest)return;
    currentAttendanceRows=rows;
    renderAttendanceRoster();
  }catch(error){if(requestId===attendanceRosterRequest)$('#attendance-roster').innerHTML='<tr><td colspan="4" class="records-empty">'+escapeHTML(error.message)+'</td></tr>';}
  finally{if(requestId===attendanceRosterRequest)attendanceRosterLoading=false;}
}
function renderAttendanceRoster(){
  const allRows=currentAttendanceRows.map(row=>({...row,member:memberById(row.member_id)})).filter(row=>row.member);
  allRows.sort((a,b)=>Number(b.status==='hadir')-Number(a.status==='hadir')||Date.parse(b.updated_at||0)-Date.parse(a.updated_at||0)||a.member.full_name.localeCompare(b.member.full_name,'id'));
  const counts={hadir:0,izin:0,sakit:0,alpa:0,belum:0};allRows.forEach(row=>counts[row.status]=(counts[row.status]||0)+1);
  const rate=allRows.length?Math.round(counts.hadir*1000/allRows.length)/10:0;
  $('#attendance-summary').innerHTML='<span><strong>'+counts.hadir+'</strong> hadir</span><span><strong>'+counts.izin+'</strong> izin</span><span><strong>'+counts.sakit+'</strong> sakit</span><span><strong>'+counts.alpa+'</strong> tanpa keterangan</span><span><strong>'+rate+'%</strong> kehadiran</span>';
  if(!allRows.length){$('#attendance-roster').innerHTML='<tr><td colspan="4" class="records-empty">Belum ada roster pada daftar hadir ini.</td></tr>';return;}
  const search=($('#attendance-roster-filter').value||'').trim().toLocaleLowerCase('id-ID');
  const rows=allRows.filter(row=>!search||row.member.full_name.toLocaleLowerCase('id-ID').includes(search)||row.member.nia.toLocaleLowerCase('id-ID').includes(search));
  if(!rows.length){$('#attendance-roster').innerHTML='<tr><td colspan="4" class="records-empty">Anggota yang cocok tidak ditemukan.</td></tr>';return;}
  const canEdit=currentAttendanceEvent.status==='open'&&attendanceEventIsPublished(currentAttendanceEvent);
  $('#attendance-roster').innerHTML=rows.map(row=>{
    const draft=attendanceRosterDrafts.get(row.member_id);
    const status=draft?.status||row.status;
    const reason=draft?.reason??row.reason??'';
    const proof=row.proof_path&&row.proof_uploaded_at
      ? '<button class="text-button attendance-proof-button" type="button" data-attendance-proof="'+escapeHTML(row.member_id)+'">Lihat foto</button>'
      : row.proof_deleted_at
        ? '<small class="attendance-proof-expired">Dihapus otomatis</small>'
        : '<small class="attendance-proof-missing">Belum ada foto</small>';
    return '<tr><td><strong>'+escapeHTML(row.member.full_name)+'</strong><small>Angkatan '+escapeHTML(row.member.cohort)+'</small></td><td>'+escapeHTML(row.member.nia)+'</td><td><select data-attendance-status="'+escapeHTML(row.member_id)+'" aria-label="Status kehadiran '+escapeHTML(row.member.full_name)+'">'+['belum','hadir','izin','sakit','alpa'].map(option=>'<option value="'+option+'" '+(status===option?'selected':'')+'>'+attendanceStatusLabel(option)+'</option>').join('')+'</select><input class="attendance-reason" data-attendance-reason="'+escapeHTML(row.member_id)+'" value="'+escapeHTML(reason)+'" placeholder="Catatan izin (opsional)" aria-label="Catatan kehadiran '+escapeHTML(row.member.full_name)+'"></td><td>'+proof+'</td></tr>';
  }).join('');
  document.querySelectorAll('#attendance-roster select,#attendance-roster input').forEach(field=>field.disabled=!canEdit);
  $('#attendance-save').disabled=!canEdit||!attendanceRosterDirty;
}
$('#attendance-roster').addEventListener('input',event=>{if(event.target.matches('[data-attendance-reason]'))updateAttendanceSaveState();});
$('#attendance-roster').addEventListener('change',event=>{if(event.target.matches('[data-attendance-status]'))updateAttendanceSaveState();});
$('#attendance-roster-filter').addEventListener('input',()=>{captureAttendanceRosterDrafts();renderAttendanceRoster();});
async function refreshOpenAttendanceRoster(){
  if(attendanceRosterLoading||!currentAttendanceEvent||attendanceRosterPanel.hidden||currentAttendanceEvent.status!=='open'||attendanceRosterHasChanges())return;
  const eventId=currentAttendanceEvent.id,requestId=attendanceRosterRequest;
  try{
    const rows=await api('secretariat_attendance_records?select=*&event_id=eq.'+encodeURIComponent(eventId));
    if(requestId!==attendanceRosterRequest||attendanceRosterHasChanges())return;
    const signature=items=>items.map(row=>[row.member_id,row.status,row.updated_at,row.proof_path,row.proof_uploaded_at,row.proof_deleted_at].join('|')).join('\n');
    if(signature(rows)!==signature(currentAttendanceRows)){
      currentAttendanceRows=rows;
      renderAttendanceRoster();
    }
  }catch{}
}
setInterval(()=>{if(!document.hidden&&!$('#attendance-tools-panel').hidden)void refreshOpenAttendanceRoster();},15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('#attendance-tools-panel').hidden)void refreshOpenAttendanceRoster();});
async function getAttendanceProofUrl(eventId,memberId){
  const endpoint=config.url+'/functions/v1/attendance-checkin?mode=proof-url&event_id='+encodeURIComponent(eventId)+'&member_id='+encodeURIComponent(memberId);
  const response=await authenticatedFetch(endpoint,{method:'GET',headers:{apikey:config.publishableKey}});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||'Foto bukti belum dapat dimuat.');
  return result.signed_url;
}
$('#attendance-roster').addEventListener('click',async event=>{
  const button=event.target.closest('[data-attendance-proof]');
  if(!button||!currentAttendanceEvent)return;
  button.disabled=true;
  try{
    const signedUrl=await getAttendanceProofUrl(currentAttendanceEvent.id,button.dataset.attendanceProof);
    $('#attendance-proof-image').src=signedUrl;
    $('#attendance-proof-dialog').showModal();
  }catch(error){if(currentAttendanceEvent?.id)showMessage('#attendance-message',error.message,'error');}
  finally{button.disabled=attendanceRosterLoading;}
});
$('#attendance-proof-dialog').addEventListener('close',()=>{$('#attendance-proof-image').removeAttribute('src');});
$('#attendance-save').addEventListener('click',async()=>{
  if(!currentAttendanceEvent||attendanceRosterLoading||currentAttendanceEvent.status==='closed'||currentAttendanceEvent.agenda?.status!=='published')return;
  const eventId=currentAttendanceEvent.id,requestId=attendanceRosterRequest;
  const changes=currentAttendanceRows.flatMap(row=>{
    const draft=attendanceRosterDrafts.get(row.member_id);
    if(!draft)return [];
    const status=draft.status, note=draft.reason||null;
    if(status===row.status&&note===(row.reason?.trim()||null))return [];
    return [{member_id:row.member_id,status,reason:note,expected_updated_at:row.updated_at}];
  });
  if(!changes.length){showMessage('#attendance-message','Tidak ada perubahan untuk disimpan.');return;}
  const button=$('#attendance-save');button.disabled=true;showMessage('#attendance-message','Menyimpan status kehadiran…');
  try{
    await api('rpc/save_secretariat_attendance_changes',{method:'POST',body:{p_event_id:eventId,p_changes:changes}});
    const rows=await api('secretariat_attendance_records?select=*&event_id=eq.'+encodeURIComponent(eventId));
    if(requestId!==attendanceRosterRequest)return;
    currentAttendanceRows=rows;
    attendanceRosterDrafts.clear();attendanceRosterDirty=false;
    renderAttendanceRoster();
    await loadAttendanceRecap();
    showMessage('#attendance-message','Rekap kehadiran berhasil disimpan.','success');
  }catch(error){if(requestId===attendanceRosterRequest)showMessage('#attendance-message',error.message,'error');}
  finally{button.disabled=attendanceRosterLoading||currentAttendanceEvent?.status==='closed'||!attendanceRosterDirty;}
});
$('#attendance-export').addEventListener('click',()=>{
  if(!currentAttendanceEvent)return;
  const rows=currentAttendanceRows.map(row=>{const m=memberById(row.member_id);return[m?.nia,m?.full_name,m?.cohort,attendanceStatusLabel(row.status),row.reason||'',row.proof_deleted_at?'Dihapus otomatis':row.proof_uploaded_at?'Tersedia':'Tidak ada'];});
  downloadCSV('absensi-'+currentAttendanceEvent.event_date+'.csv',[['NIA','Nama','Angkatan','Status','Catatan','Bukti foto'],...rows]);
});

async function loadLetters(){
  loadedAdminData.delete('letters');
  const list=$('#letter-record-list');list.innerHTML='<p class="records-empty">Memuat surat…</p>';
  try{
    const letters=await api('secretariat_letters?select=*&order=created_at.desc,issued_on.desc,sequence_number.desc');
    loadedAdminData.add('letters');
    $('#letter-count').textContent=letters.length+' surat';
    if(!letters.length)list.innerHTML='<p class="records-empty">Belum ada surat yang diberi nomor.</p>';
    else list.innerHTML=letters.map(letter=>'<article class="letter-record"><div class="letter-record-heading"><strong>'+escapeHTML(letter.letter_number)+'</strong><button type="button" data-copy-letter="'+escapeHTML(letter.letter_number)+'">Salin nomor</button><span class="record-status '+(letter.archive_status==='archived'?'published':'')+'">'+(letter.archive_status==='archived'?'SUDAH ARSIP':letter.archive_status==='void'?'DIBATALKAN':'BELUM ARSIP')+'</span></div><p>'+escapeHTML(letter.subject)+'</p><small>'+escapeHTML(letter.issued_on)+' · '+escapeHTML(letter.department_code)+' · '+escapeHTML(letter.recipient||'Tujuan belum diisi')+'</small><form class="letter-archive-form" data-letter-id="'+escapeHTML(letter.id)+'"><input name="archiveUrl" type="url" value="'+escapeHTML(letter.archive_url||'')+'" placeholder="Tautan arsip Drive"><select name="archiveStatus" aria-label="Status arsip surat"><option value="pending" '+(letter.archive_status==='pending'?'selected':'')+'>Belum diarsipkan</option><option value="archived" '+(letter.archive_status==='archived'?'selected':'')+'>Sudah diarsipkan</option><option value="void" '+(letter.archive_status==='void'?'selected':'')+'>Dibatalkan</option></select><button type="submit">Simpan arsip</button></form></article>').join('');
    list.scrollTop=0;
    void window.CSSMoRALetterSignatures?.load(letters);
  }catch(error){list.innerHTML='<p class="records-empty">'+escapeHTML(error.message)+'</p>';}
}
$('#letters-refresh').addEventListener('click',loadLetters);
$('#letter-record-list').addEventListener('click',async event=>{
  const button=event.target.closest('[data-copy-letter]');if(!button)return;
  try{await navigator.clipboard.writeText(button.dataset.copyLetter);showMessage('#letter-message','Nomor surat disalin.','success');}
  catch{showMessage('#letter-message','Nomor surat: '+button.dataset.copyLetter);}
});
$('#letter-issued-on').value=localDateInput();
letterForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=$('#issue-letter');button.disabled=true;showMessage('#letter-message','Meminta nomor berikutnya…');
  try{
    const issued=await api('rpc/issue_secretariat_letter',{method:'POST',body:{
      p_issued_on:$('#letter-issued-on').value,p_subject:$('#letter-subject').value.trim(),
      p_scope_code:$('#letter-scope').value,p_type_code:$('#letter-type').value,
      p_department_code:$('#letter-department').value,p_period_start_year:2026,
      p_recipient:$('#letter-recipient').value.trim()||null,
      p_attachment_count:Number($('#letter-attachments').value||0),
      p_archive_url:$('#letter-archive-url').value.trim()||null
    }});
    const data=Array.isArray(issued)?issued[0]:issued;
    letterForm.reset();$('#letter-issued-on').value=localDateInput();$('#letter-attachments').value='0';
    showMessage('#letter-message','Nomor terbit: '+(data?.letter_number||'berhasil dibuat')+'.','success');
    await loadLetters();
  }catch(error){showMessage('#letter-message',error.message,'error');}
  finally{button.disabled=false;}
});
$('#letter-record-list').addEventListener('submit',async event=>{
  const form=event.target.closest('.letter-archive-form');if(!form)return;
  event.preventDefault();const button=form.querySelector('button');button.disabled=true;
  const url=form.elements.archiveUrl.value.trim()||null;
  const status=form.elements.archiveStatus.value;
  try{
    if(status==='archived'&&!url)throw new Error('Tambahkan tautan arsip sebelum menandai surat sudah diarsipkan.');
    await api('secretariat_letters?id=eq.'+encodeURIComponent(form.dataset.letterId),{method:'PATCH',body:{archive_url:url,archive_status:status}});
    await loadLetters();showMessage('#letter-message','Status dan tautan arsip diperbarui.','success');
  }catch(error){showMessage('#letter-message',error.message,'error');button.disabled=false;}
});

const achievementList=$('#achievement-application-list');
const achievementStatusLabels={pending_bendahara:'Menunggu Bendahara',pending_ketua:'Menunggu Ketua',approved:'Disetujui',rejected:'Ditolak'};
const hasAchievementRole=role=>achievementRoles.includes(role);
const achievementMoney=value=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value)||0);
function achievementRequestNumber(app){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'2-digit',month:'2-digit'}).formatToParts(new Date(app.created_at)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return 'CSS-PR-'+parts.year+parts.month+'-'+app.id.replaceAll('-','').slice(0,8).toUpperCase();
}
function achievementDetailMarkup(app,team,{canReview=false,role=''}={}){
  const phone=String(app.leader_phone||'').replace(/\D/g,'').replace(/^0/,'62');
  const waText=encodeURIComponent(`Halo ${app.leader_name}, pengajuan bantuan biaya lomba “${app.competition_name}” telah disetujui CSSMoRA UNAIR. Nilai subsidi yang diajukan sebesar ${achievementMoney(app.requested_amount)}. Bukti transfer akan saya kirimkan melalui chat WhatsApp ini.`);
  const waLink='https://wa.me/'+phone+'?text='+waText;
  const subsidyPercent=Number(app.subsidy_rate||0)*100;
  const subsidyPercentLabel=(Number.isInteger(subsidyPercent)?subsidyPercent:subsidyPercent.toFixed(1))+'%';
  const approvalTrail=`<div class="achievement-approval-trail"><span class="${app.treasurer_decision?'is-done':''}"><b>1</b><strong>Bendahara</strong><small>${app.treasurer_decision?`${app.treasurer_decision==='approved'?'Disetujui':'Ditolak'} oleh Bendahara${app.treasurer_note?' · '+escapeHTML(app.treasurer_note):''}`:'Menunggu pemeriksaan bukti'}</small></span><span class="${app.chair_decision?'is-done':''}"><b>2</b><strong>Ketua</strong><small>${app.chair_decision?`${app.chair_decision==='approved'?'Disetujui':'Ditolak'} oleh Ketua${app.chair_note?' · '+escapeHTML(app.chair_note):''}`:app.status==='pending_ketua'?'Menunggu persetujuan Ketua':'Menunggu tahap Bendahara'}</small></span></div>`;
  const paymentPanel=app.status==='approved'?`<section class="achievement-payment-panel"><div class="achievement-payment-heading"><strong>Kirim konfirmasi ke peserta</strong><span class="record-status ${app.payment_shared_at?'published':''}">${app.payment_shared_at?'PESAN TERKIRIM':'BELUM TERKIRIM'}</span></div><p class="admin-muted">Pesan WhatsApp sudah disiapkan. Bendahara dapat mengirim bukti transfer secara manual dari HP sebelum mengirim pesan.</p><div class="achievement-payment-actions"><a href="${waLink}" target="_blank" rel="noopener noreferrer">Buka pesan WhatsApp ↗</a>${!app.payment_shared_at?`<button type="button" data-mark-payment-shared="${escapeHTML(app.id)}">Tandai pesan terkirim</button>`:''}</div>${app.payment_shared_at?`<small class="achievement-sent-at">Ditandai terkirim ${escapeHTML(new Date(app.payment_shared_at).toLocaleString('id-ID'))}</small>`:''}</section>`:''; 
  return `<div class="achievement-detail-content"><div class="achievement-application-grid"><div><small>Ketua / peserta</small><strong>${escapeHTML(app.leader_name)}</strong></div><div><small>Kontak &amp; email resmi</small><strong>${escapeHTML(app.leader_phone)} · ${escapeHTML(app.official_email)}</strong></div><div><small>Biaya lomba</small><strong>${achievementMoney(app.fee_amount)}</strong></div><div><small>Subsidi ${subsidyPercentLabel}</small><strong>${achievementMoney(app.requested_amount)}</strong></div><div><small>Rekening pencairan</small><strong>${escapeHTML(app.bank_name)} · ${escapeHTML(app.account_number)} · ${escapeHTML(app.account_name)}</strong></div><div><small>Pengembalian hadiah</small><strong>Setuju 5% ke kas CSSMoRA</strong></div></div>${app.participation_type==='tim'?`<div class="achievement-team-row"><small>Anggota tim</small><span>${team.map(m=>`${escapeHTML(m.member_name)} · ${escapeHTML(m.cohort)}`).join(' &nbsp;·&nbsp; ')}</span></div>`:''}<div class="achievement-application-links"><a href="${escapeHTML(app.information_url)}" target="_blank" rel="noopener">Buka informasi lomba ↗</a><button type="button" data-achievement-proof="${escapeHTML(app.proof_path)}">Lihat bukti pendaftaran ↗</button></div>${approvalTrail}${canReview?`<div class="achievement-review-controls"><label>Catatan peninjauan <input type="text" maxlength="1000" data-review-note placeholder="Catatan singkat (opsional)"></label><button type="button" data-achievement-decision="rejected" class="achievement-reject">Tolak</button><button type="button" data-achievement-decision="approved" class="achievement-approve">Setujui ${role==='bendahara'?'&amp; teruskan ke Ketua':''}</button></div>`:''}${paymentPanel}</div>`;
}
function renderAchievementApplications(){
  const rows=achievementFilter==='all'?achievementApplications:achievementApplications.filter(row=>row.status===achievementFilter);
  $('#achievement-count').textContent=rows.length+' pengajuan';
  if(!rows.length){achievementList.innerHTML='<p class="records-empty">'+(achievementApplications.length?'Tidak ada pengajuan pada status ini.':'Belum ada pengajuan biaya lomba.')+'</p>';return;}
  const approved=rows.filter(row=>row.status==='approved');
  const waiting=rows.filter(row=>row.status!=='approved');
  const table=approved.length?`<div class="achievement-approved-table-wrap"><table class="achievement-approved-table"><thead><tr><th>Lomba</th><th>Peserta</th><th>Subsidi</th><th>Status WhatsApp</th><th></th></tr></thead><tbody>${approved.map(app=>{
    const open=expandedAchievementIds.has(app.id);
    const team=achievementMembers.filter(member=>member.application_id===app.id);
    const shared=Boolean(app.payment_shared_at);
    const transferStatus=shared?'Pesan terkirim':'Belum dikirim';
    return `<tr><td><strong>${escapeHTML(app.competition_name)}</strong><small>${escapeHTML(new Date(app.created_at).toLocaleDateString('id-ID'))}</small></td><td>${escapeHTML(app.leader_name)}</td><td>${achievementMoney(app.requested_amount)}</td><td><span class="record-status ${shared?'published':''}">${transferStatus}</span></td><td><button type="button" class="achievement-details-toggle" data-achievement-details="${escapeHTML(app.id)}" aria-expanded="${open}">${open?'Tutup rincian':'Lihat rincian'}</button></td></tr><tr class="achievement-details-row" ${open?'':'hidden'}><td colspan="5">${achievementDetailMarkup(app,team)}</td></tr>`;
  }).join('')}</tbody></table></div>`:''; 
  const cards=waiting.map(app=>{
    const team=achievementMembers.filter(member=>member.application_id===app.id);
    const role=app.status==='pending_bendahara'&&hasAchievementRole('bendahara')?'bendahara':app.status==='pending_ketua'&&hasAchievementRole('ketua')?'ketua':'';
    const isChairSelfReviewException=session?.user?.email?.toLowerCase()==='naufal.almaroqi@gmail.com';
    const canReview=Boolean(role)&&(role!=='ketua'||app.treasurer_email?.toLowerCase()!==session?.user?.email?.toLowerCase()||isChairSelfReviewException);
    const blocked=app.status==='pending_ketua'&&app.treasurer_email?.toLowerCase()===session?.user?.email?.toLowerCase()&&!isChairSelfReviewException;
    return `<article class="achievement-application-card" data-application-id="${escapeHTML(app.id)}"><header class="achievement-application-head"><div><span class="achievement-request-number">${escapeHTML(achievementRequestNumber(app))}</span><h4>${escapeHTML(app.competition_name)}</h4><small>${escapeHTML(app.competition_type)} · ${app.participation_type==='tim'?'Tim':'Individu'} · ${escapeHTML(new Date(app.created_at).toLocaleString('id-ID'))}</small></div><span class="record-status achievement-status ${escapeHTML(app.status)}">${achievementStatusLabels[app.status]||escapeHTML(app.status)}</span></header>${achievementDetailMarkup(app,team,{canReview,role})}${blocked?'<p class="admin-muted achievement-review-blocked">Persetujuan Bendahara dan Ketua harus dilakukan oleh dua akun berbeda.</p>':''}</article>`;
  }).join('');
  const newestApproved=Date.parse(approved[0]?.created_at||0),newestWaiting=Date.parse(waiting[0]?.created_at||0);
  achievementList.innerHTML=newestWaiting>newestApproved?cards+table:table+cards;
}
async function loadAchievementDashboard(){
  const refresh=$('#achievement-refresh');
  const previousLabel=refresh.innerHTML;
  const hasRows=achievementApplications.length>0;
  achievementList.setAttribute('aria-busy','true');
  refresh.disabled=true;refresh.innerHTML='<span class="achievement-refresh-spinner" aria-hidden="true"></span> Memuat…';
  if(!hasRows)achievementList.innerHTML='<p class="records-empty">Memuat pengajuan…</p>';
  const overlay=document.createElement('div');
  overlay.className='achievement-loading-overlay';
  overlay.setAttribute('role','status');
  overlay.setAttribute('aria-live','polite');
  overlay.innerHTML='<span class="achievement-loading-spinner" aria-hidden="true"></span><span><strong>Memuat pengajuan</strong><small>Mengambil data dan status terbaru…</small></span>';
  achievementList.append(overlay);
  try{
    const applications=await api('cssmora_achievement_applications?select=*&order=created_at.desc');
    const ids=applications.map(row=>row.id);
    const members=ids.length?await api('cssmora_achievement_application_members?select=application_id,member_name,cohort,role&application_id=in.('+ids.join(',')+')&order=cohort.desc,member_name.asc'):[];
    achievementApplications=applications;achievementMembers=members;
    renderAchievementApplications();
    achievementList.scrollTop=0;
  }catch(error){
    if(!hasRows)achievementList.innerHTML='<p class="records-empty">'+escapeHTML(error.message)+'</p>';
    else showMessage('#achievement-action-message','Data belum berhasil diperbarui: '+error.message,'error');
  }finally{
    achievementList.querySelector('.achievement-loading-overlay')?.remove();
    achievementList.removeAttribute('aria-busy');
    refresh.disabled=false;refresh.innerHTML=previousLabel;
  }
}
const roleLabels={ketua:'Ketua',wakil:'Wakil Ketua',bendahara:'Bendahara',sekretaris:'Sekretaris',bph_departemen:'BPH / Departemen'};
function renderRoleAssignments(){
  if(!assignedRoles.length){roleList.innerHTML='<p class="records-empty">Belum ada akses pengurus.</p>';return;}
  roleList.innerHTML='<div class="access-table-wrap"><table class="access-table"><thead><tr><th>Akun</th><th>Peran</th><th>Status</th><th>Aksi</th></tr></thead><tbody>'+
    assignedRoles.map(row=>'<tr><td><strong>'+escapeHTML(row.email)+'</strong></td><td>'+escapeHTML(roleLabels[row.role]||row.role)+'</td><td><span class="access-status '+(row.is_active?'is-active':'')+'">'+(row.is_active?'Aktif':'Nonaktif')+'</span></td><td><button type="button" class="access-toggle" data-role-email="'+escapeHTML(row.email)+'" data-role-name="'+escapeHTML(row.role)+'" data-role-enable="'+(!row.is_active)+'">'+(row.is_active?'Nonaktifkan':'Aktifkan')+'</button></td></tr>').join('')+
    '</tbody></table></div>';
}
async function loadRoleAssignments(){
  roleList.setAttribute('aria-busy','true');
  roleList.innerHTML='<p class="records-empty">Memuat akses…</p>';
  try{
    assignedRoles=await api('cssmora_user_roles?select=email,role,is_active,created_at&order=email.asc,role.asc');
    renderRoleAssignments();
  }catch(error){
    roleList.innerHTML='<p class="records-empty">'+escapeHTML(error.message)+'</p>';
  }finally{roleList.removeAttribute('aria-busy');}
}
async function driveRequest(action) {
  if (!session?.access_token) throw new Error('Login pengurus diperlukan.');
  const response = await authenticatedFetch(config.url + '/functions/v1/drive-integration', {
    method: 'POST',
    headers: { ...baseHeaders(), Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify({ action }),
    timeoutMs: action === 'backup' || action === 'sync' ? 120000 : 15000
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Permintaan Google Drive gagal.');
  return data;
}
function updateDriveShortcut(folderUrl) {
  const link = $('#drive-shortcut');
  if (!link) return;
  const target = folderUrl || 'https://drive.google.com/drive/my-drive';
  link.href = 'https://accounts.google.com/AccountChooser?hd=cssmora.org&continue=' + encodeURIComponent(target);
}
function driveDateLabel(value) {
  if (!value) return 'Belum ada backup';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Belum ada backup';
  return date.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB';
}
async function loadDriveIntegrationStatus() {
  const status = $('#drive-status');
  if (!status) return null;
  try {
    const data = await driveRequest('status');
    const account = $('#drive-account');
    const count = $('#drive-file-count');
    const backup = $('#drive-last-backup');
    const openFolder = $('#drive-open-folder');
    const connect = $('#drive-connect');
    const sync = $('#drive-sync-now');
    const backupButton = $('#drive-backup-now');
    updateDriveShortcut(data.folderUrl);
    status.textContent = data.connected
      ? 'Drive tersambung. File disalin ke folder privat aplikasi.'
      : 'Drive belum tersambung. Hubungkan akun unair@cssmora.org untuk mengaktifkan sinkronisasi.';
    if (account) account.textContent = data.accountEmail || 'Belum tersambung';
    if (count) count.textContent = data.connected
      ? Number(data.pendingFiles || 0) + ' menunggu · ' + Number(data.failedFiles || 0) + ' gagal'
      : 'Belum aktif';
    if (backup) {
      const last = data.lastBackup;
      backup.textContent = last
        ? driveDateLabel(last.finished_at || last.started_at) + ' · ' + (last.status === 'succeeded' ? 'berhasil' : last.status === 'failed' ? 'gagal' : 'diproses')
        : 'Belum ada backup';
    }
    if (openFolder) {
      openFolder.hidden = !data.connected || !data.folderUrl;
      if (data.folderUrl) openFolder.href = 'https://accounts.google.com/AccountChooser?hd=cssmora.org&continue=' + encodeURIComponent(data.folderUrl);
    }
    if (connect) connect.disabled = false;
    if (sync) sync.disabled = !data.connected;
    if (backupButton) backupButton.disabled = !data.connected;

    const callbackUrl = new URL(window.location.href);
    const callbackState = callbackUrl.searchParams.get('drive');
    if (callbackState) {
      showMessage('#drive-message', callbackState === 'connected'
        ? 'Google Drive berhasil dihubungkan.'
        : 'Google Drive belum berhasil dihubungkan. Periksa akun dan konfigurasi OAuth.', callbackState === 'connected' ? 'success' : 'error');
      callbackUrl.searchParams.delete('drive');
      history.replaceState({}, document.title, callbackUrl.pathname + callbackUrl.search + callbackUrl.hash);
    }
    return data;
  } catch (error) {
    status.textContent = 'Status Google Drive belum dapat dimuat.';
    showMessage('#drive-message', error.message, 'error');
    return null;
  }
}
async function runDriveAction(action, button) {
  if (!button) return;
  button.disabled = true;
  showMessage('#drive-message', action === 'backup' ? 'Membuat backup terenkripsi…' : 'Menyinkronkan file…');
  try {
    const result = await driveRequest(action);
    await loadDriveIntegrationStatus();
    if (result.skipped) showMessage('#drive-message', result.skipped, 'error');
    else if (action === 'backup') showMessage('#drive-message', 'Backup terenkripsi berhasil disimpan di Drive.', 'success');
    else showMessage('#drive-message', 'Sinkronisasi selesai. Berhasil: ' + Number(result.succeeded || 0) + ', gagal: ' + Number(result.failed || 0) + '.', result.failed ? 'error' : 'success');
  } catch (error) {
    showMessage('#drive-message', error.message, 'error');
  } finally {
    button.disabled = false;
    await loadDriveIntegrationStatus();
  }
}
$('#drive-refresh')?.addEventListener('click', () => { void loadDriveIntegrationStatus(); });
$('#drive-connect')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  showMessage('#drive-message', 'Membuka persetujuan Google…');
  try {
    const result = await driveRequest('connect');
    if (!result.authorizationUrl) throw new Error('Tautan persetujuan Google tidak tersedia.');
    window.location.assign(result.authorizationUrl);
  } catch (error) {
    showMessage('#drive-message', error.message, 'error');
    button.disabled = false;
  }
});
$('#drive-sync-now')?.addEventListener('click', event => { void runDriveAction('sync', event.currentTarget); });
$('#drive-backup-now')?.addEventListener('click', event => { void runDriveAction('backup', event.currentTarget); });

roleForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=$('#save-role');
  const email=roleForm.elements.email.value.trim().toLowerCase();
  const role=roleForm.elements.role.value;
  button.disabled=true;
  showMessage('#role-message','Menyimpan akses…');
  try{
    await api('rpc/set_cssmora_user_role',{method:'POST',body:{p_email:email,p_role:role,p_enabled:true}});
    roleForm.reset();
    showMessage('#role-message','Akses '+(roleLabels[role]||role)+' tersimpan.','success');
    await loadRoleAssignments();
  }catch(error){showMessage('#role-message',error.message,'error');}
  finally{button.disabled=false;}
});
$('#role-refresh').addEventListener('click',loadRoleAssignments);
roleList.addEventListener('click',async event=>{
  const button=event.target.closest('[data-role-email]');
  if(!button)return;
  button.disabled=true;
  try{
    await api('rpc/set_cssmora_user_role',{method:'POST',body:{
      p_email:button.dataset.roleEmail,p_role:button.dataset.roleName,p_enabled:button.dataset.roleEnable==='true'
    }});
    showMessage('#role-message','Perubahan akses berhasil disimpan.','success');
    await loadRoleAssignments();
  }catch(error){showMessage('#role-message',error.message,'error');button.disabled=false;}
});

$('#achievement-refresh').addEventListener('click',loadAchievementDashboard);
document.querySelectorAll('[data-achievement-filter]').forEach(button=>button.addEventListener('click',()=>{
  achievementFilter=button.dataset.achievementFilter;
  document.querySelectorAll('[data-achievement-filter]').forEach(item=>item.classList.toggle('is-active',item===button));
  renderAchievementApplications();
}));
achievementList.addEventListener('click',async event=>{
  const toggle=event.target.closest('[data-achievement-details]');
  if(toggle){
    const detailRow=toggle.closest('tr')?.nextElementSibling;
    if(detailRow?.classList.contains('achievement-details-row')){detailRow.hidden=!detailRow.hidden;const id=toggle.dataset.achievementDetails;if(detailRow.hidden)expandedAchievementIds.delete(id);else expandedAchievementIds.add(id);toggle.setAttribute('aria-expanded',String(!detailRow.hidden));toggle.textContent=detailRow.hidden?'Lihat rincian':'Tutup rincian';}
    return;
  }
  const mark=event.target.closest('[data-mark-payment-shared]');
  if(mark){mark.disabled=true;try{await api('rpc/mark_cssmora_achievement_payment_shared',{method:'POST',body:{p_id:mark.dataset.markPaymentShared}});showMessage('#achievement-action-message','Pesan WhatsApp ditandai sudah terkirim.','success');await loadAchievementDashboard();}catch(error){showMessage('#achievement-action-message',error.message,'error');mark.disabled=false;}return;}
  const proof=event.target.closest('[data-achievement-proof]');
  if(proof){
    proof.disabled=true;
    try{
      const path=proof.dataset.achievementProof.split('/').map(encodeURIComponent).join('/');
      const response=await authenticatedFetch(`${config.url}/storage/v1/object/sign/cssmora-prestasi-proofs/${path}`,{method:'POST',headers:{...baseHeaders(),Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({expiresIn:3600})});
      const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||'Bukti pendaftaran tidak dapat dibuka.');
      const url=data.signedURL?.startsWith('http')?data.signedURL:`${config.url}/storage/v1${data.signedURL}`;
      window.open(url,'_blank','noopener');
    }catch(error){alert(error.message);}finally{proof.disabled=false;}
    return;
  }
  const decision=event.target.closest('[data-achievement-decision]');if(!decision)return;
  const card=decision.closest('[data-application-id]'),id=card.dataset.applicationId;
  const controls=card.querySelectorAll('[data-achievement-decision]');controls.forEach(button=>button.disabled=true);
  if(decision.dataset.achievementDecision==='approved')expandedAchievementIds.add(id);
  try{
    const result=await api('rpc/review_cssmora_achievement_application',{method:'POST',body:{p_id:id,p_decision:decision.dataset.achievementDecision,p_note:card.querySelector('[data-review-note]')?.value.trim()||null}});
    showMessage('#achievement-action-message',`Status pengajuan diperbarui: ${achievementStatusLabels[result]||result}.`,'success');
    await loadAchievementDashboard();
  }catch(error){alert(error.message);controls.forEach(button=>button.disabled=false);}
});

async function initialize(){
  if(!config?.url||!config?.publishableKey){showMessage('#auth-message','Konfigurasi Supabase belum tersedia.','error');return;}
  try{
    const stored=localStorage.getItem('cssmora-admin-session')||sessionStorage.getItem('cssmora-admin-session');
    if(stored){session=JSON.parse(stored);saveSession(session);if(session.expires_at<Date.now()+60000)await refreshSession();await checkAdmin();}
    else{authView.hidden=false;adminView.hidden=true;}
  }catch(error){
    const invalidSession=error instanceof SyntaxError||error.status===401||error.status===403||error.authFailure===true;
    if(invalidSession)saveSession(null);
    authView.hidden=false;adminView.hidden=true;
    showMessage('#auth-message',invalidSession?error.message:'Koneksi belum tersedia. Sesi tetap tersimpan; muat ulang untuk mencoba lagi.','error');
  }
  finally{document.documentElement.classList.remove('admin-session-restoring');}
}
initialize();
