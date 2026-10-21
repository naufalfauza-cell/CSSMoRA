const $ = selector => document.querySelector(selector);
const config = window.CSSMORA_SUPABASE;
const authView = $('#auth-view');
const adminView = $('#admin-view');
const authForm = $('#auth-form');
const competitionForm = $('#competition-form');
const recordList = $('#record-list');
let session = null;
let competitions = [];
let agendas = [];
let programs = [];
const programForm = $('#program-form');
const programRecordList = $('#program-record-list');
const programPhotoInput = $('#program-photo');
const agendaForm = $('#agenda-form');
const agendaRecordList = $('#agenda-record-list');
const agendaTimeZone = 'Asia/Jakarta';
const loadedAdminData = new Set();
const loadingAdminData = new Map();

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const baseHeaders = () => ({apikey:config.publishableKey,'Content-Type':'application/json'});
const showMessage = (selector,message,kind='') => {
  const node=$(selector);
  node.textContent=message;
  node.dataset.kind=kind;
};
const saveSession = value => {
  session=value;
  if(value)sessionStorage.setItem('cssmora-admin-session',JSON.stringify(value));
  else sessionStorage.removeItem('cssmora-admin-session');
};

async function fetchTimed(url, options) {
  const timeoutOptions=typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?{signal:AbortSignal.timeout(15000)}:{};
  try {
    return await fetch(url,{...options,...timeoutOptions});
  } catch(error) {
    if(error?.name==='TimeoutError'||error?.name==='AbortError') {
      throw new Error('Supabase belum merespons setelah 15 detik. Periksa koneksi lalu coba lagi.');
    }
    throw error;
  }
}

async function authRequest(path,body) {
  const response=await fetchTimed(`${config.url}/auth/v1/${path}`,{
    method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.msg||data.message||data.error_description||'Autentikasi gagal. Periksa email dan kata sandi.');
  return data;
}

async function refreshSession() {
  if(!session?.refresh_token)throw new Error('Sesi berakhir. Silakan login kembali.');
  const refreshed=await authRequest('token?grant_type=refresh_token',{refresh_token:session.refresh_token});
  saveSession({...refreshed,expires_at:Date.now()+Number(refreshed.expires_in||3600)*1000});
}

async function api(path,{method='GET',body,allowRetry=true,extraHeaders={}}={}) {
  const headers={...baseHeaders(),...extraHeaders};
  if(session?.access_token)headers.Authorization=`Bearer ${session.access_token}`;
  const response=await fetchTimed(`${config.url}/rest/v1/${path}`,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)
  });
  if(response.status===401&&allowRetry&&session?.refresh_token){
    await refreshSession();
    return api(path,{method,body,allowRetry:false,extraHeaders});
  }
  const raw=await response.text();
  const result=raw?JSON.parse(raw):null;
  if(!response.ok)throw new Error(result?.message||result?.hint||result?.details||'Permintaan gagal. Coba lagi.');
  return result;
}

async function ensureAdminData(key, loader) {
  if(loadedAdminData.has(key))return;
  if(loadingAdminData.has(key))return loadingAdminData.get(key);
  const pending=Promise.resolve().then(loader).finally(()=>loadingAdminData.delete(key));
  loadingAdminData.set(key,pending);
  return pending;
}

async function loadAdminPanel(panelId) {
  if(panelId==='competitions-panel') {
    await ensureAdminData('competitions',loadRecords);
    return;
  }
  if(panelId==='agenda-panel') {
    await ensureAdminData('programs',loadPrograms);
    await ensureAdminData('agenda',loadAgenda);
    return;
  }
  if(panelId==='secretariat-panel') {
    initializeSecretaryForms();
    const selected=document.querySelector('.secretariat-tab.is-active')||document.querySelector('.secretariat-tab');
    await loadSecretarySection(selected);
  }
}

async function checkAdmin() {
  const user=session?.user;
  if(!user?.email)throw new Error('Akun tidak memiliki alamat email yang terverifikasi.');
  const rows=await api(`competition_admins?select=email&email=eq.${encodeURIComponent(user.email.toLowerCase())}`);
  if(!rows?.length)throw new Error('Akun ini belum diberi akses admin CSSMoRA. Hubungi pengurus utama.');
  $('#signed-in-as').textContent=user.email;
  authView.hidden=true;
  adminView.hidden=false;
  void loadAdminPanel('competitions-panel');
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
  try{if(session?.access_token)await fetch(`${config.url}/auth/v1/logout`,{method:'POST',headers:{apikey:config.publishableKey,Authorization:`Bearer ${session.access_token}`}});}catch{}
  saveSession(null);
  adminView.hidden=true;
  authView.hidden=false;
  authForm.reset();
  showMessage('#auth-message','Kamu sudah keluar.','success');
});

async function loadRecords(){
  loadedAdminData.delete('competitions');
  recordList.innerHTML='<p class="records-empty">Memuat data…</p>';
  try{
    competitions=await api('competitions?select=*&order=deadline.desc');
    renderRecords();
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
      competitions=competitions.filter(row=>row.id!==item.id);
      renderRecords();
      if($('#record-id').value===item.id)clearEditor();
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
  const payload={
    id:existingId||`${slug}-${Date.now()}`,
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
    if(existingId){
      await api(`competitions?id=eq.${encodeURIComponent(existingId)}`,{method:'PATCH',body:payload});
      showMessage('#editor-message','Perubahan berhasil disimpan.','success');
    }else{
      await api('competitions',{method:'POST',body:payload});
      showMessage('#editor-message','Lomba berhasil ditambahkan.','success');
    }
    await loadRecords();
    clearEditor();
  }catch(error){showMessage('#editor-message',error.message,'error');}
  finally{submit.disabled=false;}
});


const programBucket='cssmora-agenda-programs';
const storageHeaders=contentType=>({
  apikey:config.publishableKey,
  Authorization:`Bearer ${session?.access_token||config.publishableKey}`,
  ...(contentType?{'Content-Type':contentType}:{})
});
const objectUrl=path=>`${config.url}/storage/v1/object/public/${programBucket}/${path.split('/').map(encodeURIComponent).join('/')}`;

async function uploadProgramPhoto(file,path) {
  const response=await fetch(`${config.url}/storage/v1/object/${programBucket}/${path.split('/').map(encodeURIComponent).join('/')}`,{
    method:'POST',headers:{...storageHeaders(file.type),'x-upsert':'false'},body:file
  });
  if(!response.ok) {
    const data=await response.json().catch(()=>({}));
    throw new Error(data.message||data.error||'Foto proker gagal diunggah.');
  }
}
async function deleteProgramPhoto(path) {
  if(!path)return;
  const response=await fetch(`${config.url}/storage/v1/object/${programBucket}/${path.split('/').map(encodeURIComponent).join('/')}`,{
    method:'DELETE',headers:storageHeaders()
  });
  if(!response.ok)throw new Error('Foto lama belum dapat dihapus dari penyimpanan.');
}
async function loadPrograms() {
  loadedAdminData.delete('programs');
  programRecordList.innerHTML='<p class="records-empty">Memuat proker…</p>';
  try {
    programs=await api('agenda_programs?select=*&order=name.asc');
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
  programRecordList.innerHTML=programs.map(program=>`<article class="program-record">
    <img src="${escapeHTML(program.photo_url)}" alt="" loading="lazy">
    <div class="program-record-copy"><strong>${escapeHTML(program.name)}</strong><span class="record-status ${program.is_active?'published':''}">${program.is_active?'AKTIF':'NONAKTIF'}</span></div>
    <div class="program-record-actions"><button type="button" data-program-action="edit" data-id="${escapeHTML(program.id)}">Edit</button><button type="button" data-program-action="toggle" data-id="${escapeHTML(program.id)}">${program.is_active?'Nonaktifkan':'Aktifkan'}</button></div>
  </article>`).join('');
  programRecordList.querySelectorAll('img').forEach(image=>image.addEventListener('error',()=>{image.src='./assets/cssmora-logo.png';},{once:true}));
}
function renderProgramOptions(selected='') {
  const select=$('#agenda-program');
  select.innerHTML='<option value="">Pilih proker aktif…</option>'+programs.filter(program=>program.is_active).map(program=>`<option value="${escapeHTML(program.id)}">${escapeHTML(program.name)}</option>`).join('');
  if(selected&&programs.some(program=>program.id===selected))select.value=selected;
  select.disabled=!programs.some(program=>program.is_active);
}
function clearProgramEditor() {
  if(!programForm)return;
  programForm.reset();
  $('#program-record-id').value='';
  programPhotoInput.required=true;
  $('#program-active').checked=true;
  $('#program-editor-title').textContent='Tambah proker';
  $('#save-program').innerHTML='Simpan proker <span aria-hidden="true">↗</span>';
  $('#program-photo-preview').hidden=true;
  showMessage('#program-editor-message','');
}
$('#program-form-reset').addEventListener('click',clearProgramEditor);
$('#program-refresh').addEventListener('click',loadPrograms);
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
    $('#program-record-id').value=program.id;
    programForm.elements.name.value=program.name;
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
    const payload={name:programForm.elements.name.value.trim(),is_active:$('#program-active').checked};
    if(file){payload.photo_path=photoPath;payload.photo_url=photoUrl;}
    if(existingId)await api(`agenda_programs?id=eq.${encodeURIComponent(existingId)}`,{method:'PATCH',body:payload});
    else await api('agenda_programs',{method:'POST',body:{id,...payload,photo_path:photoPath,photo_url:photoUrl}});
    if(file&&old?.photo_path)await deleteProgramPhoto(old.photo_path).catch(()=>{});
    await loadPrograms();
    await loadAgenda();
    clearProgramEditor();
    showMessage('#program-editor-message',existingId?'Perubahan proker berhasil disimpan.':'Proker dan fotonya berhasil ditambahkan.','success');
  } catch(error) {
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
  document.querySelectorAll('.admin-tab').forEach(item=>{
    const selected=item===tab;
    item.classList.toggle('is-active',selected);
    item.setAttribute('aria-selected',String(selected));
  });
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
const attendanceEventForm=$('#attendance-event-form');
const attendanceEventList=$('#attendance-event-list');
const attendanceRosterPanel=$('#attendance-roster-panel');
const letterForm=$('#letter-form');
let members=[];
let attendanceEvents=[];
let currentAttendanceEvent=null;
let currentAttendanceRows=[];
let attendanceCodeRefreshTimer=null;
let attendanceCodeEventId=null;
let attendanceCodeExpiresAt=0;

const memberById=id=>members.find(member=>member.id===id);
const localDateInput=()=>{
  const date=new Date();
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10);
};
const csvCell=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
function downloadCSV(name,rows){
  const csv='\\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\\r\\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function parseCSV(text){
  const delimiter=(text.split(/\\r?\\n/,1)[0].match(/;/g)||[]).length>(text.split(/\\r?\\n/,1)[0].match(/,/g)||[]).length?';':',';
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted&&ch==='"'&&text[i+1]==='"'){cell+='"';i++;}
    else if(ch==='"')quoted=!quoted;
    else if(ch===delimiter&&!quoted){row.push(cell);cell='';}
    else if((ch==='\\n'||ch==='\\r')&&!quoted){if(ch==='\\r'&&text[i+1]==='\\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}
    else cell+=ch;
  }
  if(cell||row.length){row.push(cell);if(row.some(v=>v.trim()))rows.push(row);}
  return rows;
}
const normHeader=value=>String(value||'').replace(/^\\uFEFF/,'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').trim().toLowerCase();
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
  if(!$('#attendance-event-date').value)$('#attendance-event-date').value=localDateInput();
}
async function loadSecretarySection(tab){
  if(!tab)return;
  const panel=tab.getAttribute('aria-controls');
  if(panel==='members-panel') {
    await ensureAdminData('members',loadMembers);
  } else if(panel==='attendance-tools-panel') {
    await Promise.all([
      ensureAdminData('members',loadMembers),
      ensureAdminData('attendanceEvents',loadAttendanceEvents)
    ]);
  } else if(panel==='letters-panel') {
    await ensureAdminData('letters',loadLetters);
  }
}
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
  loadedAdminData.delete('attendanceEvents');
  attendanceEventList.innerHTML='<p class="records-empty">Memuat kegiatan…</p>';
  try{
    attendanceEvents=await api('secretariat_attendance_events?select=*&order=event_date.desc,created_at.desc');
    renderAttendanceEvents();
    loadedAdminData.add('attendanceEvents');
  }catch(error){attendanceEventList.innerHTML='<p class="records-empty">'+escapeHTML(error.message)+'</p>';}
}
function renderAttendanceEvents(){
  if(!attendanceEvents.length){attendanceEventList.innerHTML='<p class="records-empty">Belum ada kegiatan absensi.</p>';return;}
  attendanceEventList.innerHTML=attendanceEvents.map(e=>'<article class="attendance-event-card"><button type="button" class="secretariat-record-select" data-event-id="'+escapeHTML(e.id)+'"><span><strong>'+escapeHTML(e.title)+'</strong><small>'+escapeHTML(e.event_date)+' · '+escapeHTML(e.session_name||'Umum')+(e.location?' · '+escapeHTML(e.location):'')+'</small></span><span class="record-status '+(e.status==='open'?'published':'')+'">'+(e.status==='open'?'TERBUKA':'DITUTUP')+'</span></button><div class="attendance-event-actions"><button type="button" data-copy-event="'+escapeHTML(e.id)+'">Salin tautan</button><button type="button" data-toggle-event="'+escapeHTML(e.id)+'">'+(e.status==='open'?'Tutup absensi':'Buka lagi')+'</button></div></article>').join('');
}
$('#events-refresh').addEventListener('click',loadAttendanceEvents);
$('#attendance-code-retry').addEventListener('click',()=>{if(currentAttendanceEvent)void loadAttendanceCode(currentAttendanceEvent.id);});
attendanceEventList.addEventListener('click',async event=>{
  const copy=event.target.closest('[data-copy-event]');
  if(copy){
    const item=attendanceEvents.find(row=>row.id===copy.dataset.copyEvent);
    if(!item)return;
    const link=window.location.origin+'/absen.html?t='+encodeURIComponent(item.public_token);
    try{await navigator.clipboard.writeText(link);showMessage('#event-message','Tautan absensi tersalin. Bagikan kepada peserta kegiatan.','success');}
    catch{showMessage('#event-message','Salin tautan ini: '+link,'success');}
    return;
  }
  const toggle=event.target.closest('[data-toggle-event]');
  if(toggle){
    const item=attendanceEvents.find(row=>row.id===toggle.dataset.toggleEvent);if(!item)return;
    toggle.disabled=true;
    try{await api('secretariat_attendance_events?id=eq.'+encodeURIComponent(item.id),{method:'PATCH',body:{status:item.status==='open'?'closed':'open'}});await loadAttendanceEvents();if(currentAttendanceEvent?.id===item.id){currentAttendanceEvent=attendanceEvents.find(row=>row.id===item.id);await loadAttendanceRoster(item.id);}}
    catch(error){showMessage('#event-message',error.message,'error');toggle.disabled=false;}
    return;
  }
  const select=event.target.closest('[data-event-id]');if(select)loadAttendanceRoster(select.dataset.eventId);
});
attendanceEventForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=$('#save-attendance-event');button.disabled=true;
  showMessage('#event-message','Membuat kegiatan dan menyalin roster aktif…');
  try{
    const result=await api('rpc/create_secretariat_attendance_event',{method:'POST',body:{
      p_title:$('#attendance-event-title').value.trim(),p_event_date:$('#attendance-event-date').value,
      p_session_name:$('#attendance-event-session').value.trim()||'Umum',p_location:$('#attendance-event-location').value.trim()||null
    }});
    const id=typeof result==='string'?result:(Array.isArray(result)?result[0]:result?.id);
    attendanceEventForm.reset();$('#attendance-event-session').value='Umum';$('#attendance-event-date').value=localDateInput();
    await loadAttendanceEvents();showMessage('#event-message','Daftar hadir dibuat untuk '+members.filter(m=>m.is_active).length+' anggota aktif.','success');
    if(id)await loadAttendanceRoster(id);
  }catch(error){showMessage('#event-message',error.message,'error');}
  finally{button.disabled=false;}
});
function attendanceStatusLabel(status){return({hadir:'Hadir',izin:'Izin',sakit:'Sakit',alpa:'Tanpa keterangan',belum:'Belum dicatat'})[status]||status;}
async function requestAttendanceCode(eventId,allowRetry=true){
  const headers={apikey:config.publishableKey,Authorization:session?.access_token?'Bearer '+session.access_token:''};
  const response=await fetchTimed(config.url+'/functions/v1/attendance-checkin?mode=code&event_id='+encodeURIComponent(eventId),{method:'GET',headers});
  if(response.status===401&&allowRetry&&session?.refresh_token){
    await refreshSession();
    return requestAttendanceCode(eventId,false);
  }
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||'Kode check-in belum dapat dimuat.');
  return result;
}
function clearAttendanceCodeTimer(){
  if(attendanceCodeRefreshTimer){clearInterval(attendanceCodeRefreshTimer);attendanceCodeRefreshTimer=null;}
}
function stopAttendanceCode(){
  clearAttendanceCodeTimer();
  attendanceCodeEventId=null;
  $('#attendance-code-panel').hidden=true;
}
async function loadAttendanceCode(eventId){
  clearAttendanceCodeTimer();
  attendanceCodeEventId=eventId;
  const panel=$('#attendance-code-panel');
  panel.hidden=false;
  $('#attendance-code-value').textContent='••••';
  $('#attendance-code-countdown').textContent='Memuat kode…';
  try{
    const result=await requestAttendanceCode(eventId);
    if(attendanceCodeEventId!==eventId)return;
    if(!result.active){
      $('#attendance-code-value').textContent='—';
      $('#attendance-code-countdown').textContent=result.message||'Kode belum tersedia.';
      return;
    }
    $('#attendance-code-value').textContent=result.code;
    attendanceCodeExpiresAt=Date.now()+Math.max(1,Number(result.seconds_remaining)||1)*1000;
    attendanceCodeRefreshTimer=window.setInterval(()=>{
      if(attendanceCodeEventId!==eventId){clearAttendanceCodeTimer();return;}
      const remaining=Math.max(0,Math.ceil((attendanceCodeExpiresAt-Date.now())/1000));
      $('#attendance-code-countdown').textContent=remaining?'Berganti dalam '+remaining+' detik':'Memperbarui kode…';
      if(!remaining){clearAttendanceCodeTimer();void loadAttendanceCode(eventId);}
    },250);
  }catch(error){
    if(attendanceCodeEventId!==eventId)return;
    $('#attendance-code-value').textContent='—';
    $('#attendance-code-countdown').textContent=error.message;
  }
}
async function loadAttendanceRoster(eventId){
  const selected=attendanceEvents.find(event=>event.id===eventId);if(!selected)return;
  currentAttendanceEvent=selected;attendanceRosterPanel.hidden=false;
  $('#attendance-roster-title').textContent=selected.title;
  $('#attendance-event-meta').textContent=selected.event_date+' · '+(selected.session_name||'Umum')+(selected.location?' · '+selected.location:'');
  if(selected.status==='open')void loadAttendanceCode(eventId);else stopAttendanceCode();
  $('#attendance-roster').innerHTML='<tr><td colspan="3" class="records-empty">Memuat daftar anggota…</td></tr>';
  try{
    currentAttendanceRows=await api('secretariat_attendance_records?select=*&event_id=eq.'+encodeURIComponent(eventId));
    renderAttendanceRoster();
  }catch(error){$('#attendance-roster').innerHTML='<tr><td colspan="3" class="records-empty">'+escapeHTML(error.message)+'</td></tr>';}
}
function renderAttendanceRoster(){
  const rows=currentAttendanceRows.map(row=>({...row,member:memberById(row.member_id)})).filter(row=>row.member).sort((a,b)=>a.member.full_name.localeCompare(b.member.full_name,'id'));
  const counts={hadir:0,izin:0,sakit:0,alpa:0,belum:0};rows.forEach(row=>counts[row.status]=(counts[row.status]||0)+1);
  const rate=rows.length?Math.round(counts.hadir*100/rows.length):0;
  $('#attendance-summary').innerHTML='<span><strong>'+counts.hadir+'</strong> hadir</span><span><strong>'+counts.izin+'</strong> izin</span><span><strong>'+counts.sakit+'</strong> sakit</span><span><strong>'+counts.alpa+'</strong> tanpa keterangan</span><span><strong>'+rate+'%</strong> kehadiran</span>';
  if(!rows.length){$('#attendance-roster').innerHTML='<tr><td colspan="3" class="records-empty">Belum ada roster. Pastikan data anggota sudah diimpor sebelum membuat daftar hadir.</td></tr>';return;}
  $('#attendance-roster').innerHTML=rows.map(row=>'<tr><td><strong>'+escapeHTML(row.member.full_name)+'</strong><small>Angkatan '+escapeHTML(row.member.cohort)+'</small></td><td>'+escapeHTML(row.member.nia)+'</td><td><select data-attendance-status="'+escapeHTML(row.member_id)+'" aria-label="Status kehadiran '+escapeHTML(row.member.full_name)+'">'+['belum','hadir','izin','sakit','alpa'].map(status=>'<option value="'+status+'" '+(row.status===status?'selected':'')+'>'+attendanceStatusLabel(status)+'</option>').join('')+'</select><input class="attendance-reason" data-attendance-reason="'+escapeHTML(row.member_id)+'" value="'+escapeHTML(row.reason||'')+'" placeholder="Catatan izin (opsional)" aria-label="Catatan kehadiran '+escapeHTML(row.member.full_name)+'"></td></tr>').join('');
  document.querySelectorAll('#attendance-roster select,#attendance-roster input').forEach(field=>field.disabled=currentAttendanceEvent.status==='closed');
  $('#attendance-save').disabled=currentAttendanceEvent.status==='closed';
}
$('#attendance-save').addEventListener('click',async()=>{
  if(!currentAttendanceEvent)return;
  const rows=currentAttendanceRows.map(row=>{
    const select=document.querySelector('[data-attendance-status="'+CSS.escape(row.member_id)+'"]');
    const reason=document.querySelector('[data-attendance-reason="'+CSS.escape(row.member_id)+'"]');
    return {event_id:currentAttendanceEvent.id,member_id:row.member_id,status:select?.value||row.status,reason:reason?.value.trim()||null,recorded_by:session?.user?.id||null,updated_at:new Date().toISOString()};
  });
  const button=$('#attendance-save');button.disabled=true;showMessage('#attendance-message','Menyimpan status kehadiran…');
  try{
    if(rows.length)await api('secretariat_attendance_records?on_conflict=event_id,member_id',{method:'POST',body:rows,extraHeaders:{Prefer:'resolution=merge-duplicates,return=minimal'}});
    currentAttendanceRows=await api('secretariat_attendance_records?select=*&event_id=eq.'+encodeURIComponent(currentAttendanceEvent.id));
    renderAttendanceRoster();showMessage('#attendance-message','Rekap kehadiran berhasil disimpan.','success');
  }catch(error){showMessage('#attendance-message',error.message,'error');}
  finally{button.disabled=false;}
});
$('#attendance-export').addEventListener('click',()=>{
  if(!currentAttendanceEvent)return;
  const rows=currentAttendanceRows.map(row=>{const m=memberById(row.member_id);return[m?.nia,m?.full_name,m?.cohort,attendanceStatusLabel(row.status),row.reason||''];});
  downloadCSV('absensi-'+currentAttendanceEvent.event_date+'.csv',[['NIA','Nama','Angkatan','Status','Catatan'],...rows]);
});

async function loadLetters(){
  loadedAdminData.delete('letters');
  const list=$('#letter-record-list');list.innerHTML='<p class="records-empty">Memuat surat…</p>';
  try{
    const letters=await api('secretariat_letters?select=*&order=issued_on.desc,sequence_number.desc');
    loadedAdminData.add('letters');
    $('#letter-count').textContent=letters.length+' surat';
    if(!letters.length){list.innerHTML='<p class="records-empty">Belum ada surat yang diberi nomor.</p>';return;}
    list.innerHTML=letters.map(letter=>'<article class="letter-record"><div class="letter-record-heading"><strong>'+escapeHTML(letter.letter_number)+'</strong><span class="record-status '+(letter.archive_status==='archived'?'published':'')+'">'+(letter.archive_status==='archived'?'SUDAH ARSIP':letter.archive_status==='void'?'DIBATALKAN':'BELUM ARSIP')+'</span></div><p>'+escapeHTML(letter.subject)+'</p><small>'+escapeHTML(letter.issued_on)+' · '+escapeHTML(letter.department_code)+' · '+escapeHTML(letter.recipient||'Tujuan belum diisi')+'</small><form class="letter-archive-form" data-letter-id="'+escapeHTML(letter.id)+'"><input name="archiveUrl" type="url" value="'+escapeHTML(letter.archive_url||'')+'" placeholder="Tautan arsip Drive"><select name="archiveStatus" aria-label="Status arsip surat"><option value="pending" '+(letter.archive_status==='pending'?'selected':'')+'>Belum diarsipkan</option><option value="archived" '+(letter.archive_status==='archived'?'selected':'')+'>Sudah diarsipkan</option><option value="void" '+(letter.archive_status==='void'?'selected':'')+'>Dibatalkan</option></select><button type="submit">Simpan arsip</button></form></article>').join('');
  }catch(error){list.innerHTML='<p class="records-empty">'+escapeHTML(error.message)+'</p>';}
}
$('#letters-refresh').addEventListener('click',loadLetters);
$('#letter-issued-on').value=localDateInput();
letterForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=$('#issue-letter');button.disabled=true;showMessage('#letter-message','Meminta nomor berikutnya…');
  try{
    const issued=await api('rpc/issue_secretariat_letter',{method:'POST',body:{
      p_issued_on:$('#letter-issued-on').value,p_subject:$('#letter-subject').value.trim(),
      p_scope_code:$('#letter-scope').value,p_type_code:$('#letter-type').value.trim().toUpperCase(),
      p_department_code:$('#letter-department').value.trim().toUpperCase(),
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

async function initialize(){
  if(!config?.url||!config?.publishableKey){showMessage('#auth-message','Konfigurasi Supabase belum tersedia.','error');return;}
  try{
    const stored=sessionStorage.getItem('cssmora-admin-session');
    if(stored){session=JSON.parse(stored);if(session.expires_at<Date.now()+60000)await refreshSession();await checkAdmin();}
  }catch(error){saveSession(null);authView.hidden=false;adminView.hidden=true;showMessage('#auth-message',error.message,'error');}
}
initialize();
