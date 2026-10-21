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

async function authRequest(path,body) {
  const response=await fetch(`${config.url}/auth/v1/${path}`,{
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

async function api(path,{method='GET',body,allowRetry=true}={}) {
  const headers={...baseHeaders()};
  if(session?.access_token)headers.Authorization=`Bearer ${session.access_token}`;
  const response=await fetch(`${config.url}/rest/v1/${path}`,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)
  });
  if(response.status===401&&allowRetry&&session?.refresh_token){
    await refreshSession();
    return api(path,{method,body,allowRetry:false});
  }
  const raw=await response.text();
  const result=raw?JSON.parse(raw):null;
  if(!response.ok)throw new Error(result?.message||result?.hint||result?.details||'Permintaan gagal. Coba lagi.');
  return result;
}

async function checkAdmin() {
  const user=session?.user;
  if(!user?.email)throw new Error('Akun tidak memiliki alamat email yang terverifikasi.');
  const rows=await api(`competition_admins?select=email&email=eq.${encodeURIComponent(user.email.toLowerCase())}`);
  if(!rows?.length)throw new Error('Akun ini belum diberi akses admin CSSMoRA. Hubungi pengurus utama.');
  $('#signed-in-as').textContent=user.email;
  authView.hidden=true;
  adminView.hidden=false;
  await Promise.all([loadRecords(),loadPrograms()]);
  await loadAgenda();
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
  recordList.innerHTML='<p class="records-empty">Memuat data…</p>';
  try{
    competitions=await api('competitions?select=*&order=deadline.desc');
    renderRecords();
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
  programRecordList.innerHTML='<p class="records-empty">Memuat proker…</p>';
  try {
    programs=await api('agenda_programs?select=*&order=name.asc');
    renderPrograms();
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
  agendaRecordList.innerHTML='<p class="records-empty">Memuat agenda…</p>';
  try {
    const rows=await api('agenda?select=*&order=starts_at.asc');
    agendas=rows.map(item=>({...item,program:programs.find(program=>program.id===item.program_id)||null}));
    renderAgendas();
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

document.querySelectorAll('.admin-tab').forEach(tab=>tab.addEventListener('click',()=>{
  document.querySelectorAll('.admin-tab').forEach(item=>{
    const selected=item===tab;
    item.classList.toggle('is-active',selected);
    item.setAttribute('aria-selected',String(selected));
  });
  document.querySelectorAll('.management-panel').forEach(panel=>{
    panel.hidden=panel.id!==tab.getAttribute('aria-controls');
  });
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

async function initialize(){
  if(!config?.url||!config?.publishableKey){showMessage('#auth-message','Konfigurasi Supabase belum tersedia.','error');return;}
  try{
    const stored=sessionStorage.getItem('cssmora-admin-session');
    if(stored){session=JSON.parse(stored);if(session.expires_at<Date.now()+60000)await refreshSession();await checkAdmin();}
  }catch(error){saveSession(null);authView.hidden=false;adminView.hidden=true;showMessage('#auth-message',error.message,'error');}
}
initialize();
