let competitions = [];

const $ = selector => document.querySelector(selector);
const grid = $('#competition-grid');
const dialog = $('#detail-dialog');
const isOpen = item => new Date(item.deadline) >= new Date();
const formatDate = date => new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Jakarta'}).format(new Date(date));
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const poster = item => item.posterImage
  ? `<img class="poster-image" src="${escapeHTML(item.posterImage)}" alt="Poster ${escapeHTML(item.title)}" loading="lazy">`
  : `<div class="poster-design palette-${item.palette}" role="img" aria-label="Poster lomba ${escapeHTML(item.title)}"><div class="design-top"><span>CSSMoRA / EXPLORE</span><span>✳</span></div><div class="design-symbol">${escapeHTML(item.mark)}</div><div class="design-main"><span>${escapeHTML(item.subtitle)}</span><strong>${escapeHTML(item.title)}</strong></div><div class="design-bottom"><span>OPEN CALL • ${escapeHTML(item.year)}</span><span>↗</span></div></div>`;

function render() {
  const query = $('#search').value.trim().toLocaleLowerCase('id');
  const category = $('#category').value;
  const status = $('#status').value;
  const items = competitions.filter(item => {
    const matchedText = `${item.title} ${item.organizer} ${item.category} ${item.subtitle}`.toLocaleLowerCase('id').includes(query);
    return matchedText && (category==='all'||item.category===category) && (status==='all'||(status==='open')===isOpen(item));
  }).sort((a,b) => Number(isOpen(b))-Number(isOpen(a)) || (isOpen(a)?a.deadline.localeCompare(b.deadline):b.deadline.localeCompare(a.deadline)));
  grid.innerHTML = items.map(item => `<button class="competition-card" type="button" data-id="${item.id}" aria-label="Lihat detail ${escapeHTML(item.title)}">
    <div class="card-poster">${poster(item)}<span class="status-badge ${isOpen(item)?'is-open':'is-closed'}">${isOpen(item)?'● Masih dibuka':'● Sudah ditutup'}</span></div>
    <div class="card-meta"><span>${escapeHTML(item.category)}</span><span>CSSMoRA UNAIR</span></div>
    <div class="card-title-row"><h3>${escapeHTML(item.title)}</h3><span aria-hidden="true">↗</span></div>
    <p>${escapeHTML(item.organizer)}</p><div class="card-bottom"><span>Batas pendaftaran</span><strong>${formatDate(item.deadline)}</strong></div>
  </button>`).join('');
  $('#result-count').textContent = `${items.length} lomba ditemukan`;
  $('#empty-state').hidden = items.length !== 0;
  const noPublishedItems = competitions.length === 0;
  $('#empty-title').textContent = noPublishedItems ? 'Belum ada lomba' : 'Tidak ada yang cocok';
  $('#empty-hint').hidden = noPublishedItems;
  $('#reset-filter').hidden = noPublishedItems;
  document.querySelectorAll('.quick-filter').forEach(button => {
    const active = button.dataset.category === category;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function detail(item, updateURL=true) {
  const open = isOpen(item);
  const url = /^https:\/\//i.test(item.registrationUrl) ? item.registrationUrl : '';
  $('#detail-content').innerHTML = `<div class="detail-poster">${poster(item)}</div><div class="detail-info">
    <span class="overline">INFO LOMBA</span>
    <span class="detail-status ${open?'is-open':'is-closed'}">● ${open?'Masih dibuka':'Sudah ditutup'}</span>
    <h2 id="detail-title">${escapeHTML(item.title)}</h2><p class="detail-subtitle">${escapeHTML(item.subtitle)}</p>
    <p class="detail-description">${escapeHTML(item.description)}</p>
    <dl class="detail-facts"><div><dt>Batas pendaftaran</dt><dd>${formatDate(item.deadline)}<small>23.59 WIB</small></dd></div><div><dt>Biaya pendaftaran</dt><dd>${escapeHTML(item.fee)}</dd></div><div><dt>Penyelenggara</dt><dd>${escapeHTML(item.organizer)}</dd></div><div><dt>Bidang</dt><dd>${escapeHTML(item.category)}</dd></div></dl>
    ${open&&url?`<a class="register-button" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Buka pendaftaran resmi <span aria-hidden="true">↗</span></a>`:`<span class="register-button disabled" aria-disabled="true">${open?'Tautan pendaftaran belum tersedia':'Pendaftaran telah ditutup'}</span>`}
    <p class="detail-caution">Pastikan kembali detail dan persyaratan pada laman resmi penyelenggara sebelum mendaftar.</p>
  </div>`;
  if (!dialog.open) dialog.showModal();
  if (updateURL) { const u = new URL(location.href); u.searchParams.set('lomba',item.id); history.pushState({lomba:item.id},'',u); }
}

function closeDetail(updateURL=true) {
  if(dialog.open) dialog.close();
  if(updateURL && new URL(location.href).searchParams.has('lomba')) { const u=new URL(location.href);u.searchParams.delete('lomba');history.pushState({},'',u); }
}

grid.addEventListener('click',event => {const card=event.target.closest('[data-id]');if(card){const item=competitions.find(x=>x.id===card.dataset.id);if(item)detail(item);}});
$('#close-dialog').addEventListener('click',()=>closeDetail());
dialog.addEventListener('click',event=>{if(event.target===dialog)closeDetail();});
dialog.addEventListener('close',()=>{if(new URL(location.href).searchParams.has('lomba'))closeDetail();});
window.addEventListener('popstate',()=>{const id=new URL(location.href).searchParams.get('lomba');const item=competitions.find(x=>x.id===id);if(item)detail(item,false);else closeDetail(false);});
['search','category','status'].forEach(id=>$('#'+id).addEventListener(id==='search'?'input':'change',render));
document.querySelectorAll('.quick-filter').forEach(button=>button.addEventListener('click',()=>{$('#category').value=button.dataset.category;render();}));
$('#reset-filter').addEventListener('click',()=>{$('#search').value='';$('#category').value='all';$('#status').value='all';render();$('#search').focus();});
render();

async function loadCompetitions() {
  const status = $('#data-status');
  const statusMessage = status.querySelector('p');
  const config = window.CSSMORA_SUPABASE;
  if (!config?.url || !config?.publishableKey) {
    statusMessage.innerHTML = '<strong>Konfigurasi katalog belum tersedia.</strong> Hubungi pengurus CSSMoRA.';
    return;
  }
  statusMessage.innerHTML = '<strong>Mengambil daftar lomba…</strong> Data katalog sedang diperbarui.';
  const params = new URLSearchParams({
    select: 'id,title,subtitle,category,organizer,deadline,fee,palette,mark,year,posterImage,registrationUrl,description',
    status: 'eq.published',
    order: 'deadline.asc'
  });
  try {
    const response = await fetch(`${config.url}/rest/v1/competitions?${params}`, {
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${config.publishableKey}`
      }
    });
    if (!response.ok) throw new Error(`Supabase request failed: ${response.status}`);
    competitions = await response.json();
    render();
    statusMessage.innerHTML = `<strong>Katalog terhubung.</strong> Menampilkan ${competitions.length} lomba terverifikasi CSSMoRA.`;
    const initial = competitions.find(item => item.id === new URL(location.href).searchParams.get('lomba'));
    if (initial) detail(initial, false);
  } catch (error) {
    console.error('Gagal memuat katalog lomba:', error);
    competitions = [];
    render();
    statusMessage.innerHTML = '<strong>Katalog belum dapat dimuat.</strong> Coba muat ulang halaman beberapa saat lagi.';
  }
}
loadCompetitions();

// Design Studio: per-browser preview, with a shareable URL for the palette.
const themeDefaults = {brand:'#544bd5',accent:'#ec5a88',heroA:'#e7e6ff',heroB:'#d9d7ff',bg:'#f5f6fb'};
const themePresets = {
  aurora:themeDefaults,
  ocean:{brand:'#1267dc',accent:'#ff9f5a',heroA:'#dceffd',heroB:'#c5dbfc',bg:'#f3f8fd'},
  berry:{brand:'#993eb8',accent:'#f26e8f',heroA:'#f8e3f4',heroB:'#e7d8f9',bg:'#faf5fb'},
  forest:{brand:'#26715c',accent:'#e88054',heroA:'#e1f3e7',heroB:'#cce9df',bg:'#f4f8f3'}
};
const themeKeys = Object.keys(themeDefaults);
let theme = {...themeDefaults};
const hexColor = value => /^#[0-9a-f]{6}$/i.test(value);
const validTheme = value => value && themeKeys.every(key => hexColor(value[key]));
function paletteFromURL() {
  const encoded = new URL(location.href).searchParams.get('tema');
  if(!encoded || !/^[0-9a-f]{6}(\.[0-9a-f]{6}){4}$/i.test(encoded)) return null;
  return Object.fromEntries(themeKeys.map((key,index)=>[key,'#'+encoded.split('.')[index]]));
}
function applyTheme(next,save=true) {
  if(!validTheme(next)) return;
  theme={...next};
  themeKeys.forEach(key=>document.documentElement.style.setProperty('--theme-'+key,theme[key]));
  const rgb=theme.brand.slice(1).match(/.{2}/g).map(part=>parseInt(part,16)/255);
  const luminance=rgb.map(channel=>channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4).reduce((sum,channel,index)=>sum+channel*[0.2126,0.7152,0.0722][index],0);
  document.documentElement.style.setProperty('--theme-on-brand',luminance>0.18?'#17234d':'#ffffff');
  document.querySelectorAll('input[data-theme]').forEach(input=>{
    input.value=theme[input.dataset.theme];
    const output=document.querySelector('output[for="'+input.id+'"]');
    if(output)output.value=input.value.toUpperCase();
  });
  document.querySelectorAll('[data-preset]').forEach(button=>{
    const selected=themeKeys.every(key=>theme[key].toLowerCase()===themePresets[button.dataset.preset][key].toLowerCase());
    button.setAttribute('aria-pressed',String(selected));
  });
  if(save){try{localStorage.setItem('cssmora-theme-v1',JSON.stringify(theme));}catch{}}
}
let savedTheme=null;
try{savedTheme=JSON.parse(localStorage.getItem('cssmora-theme-v1'));}catch{}
applyTheme(paletteFromURL() || (validTheme(savedTheme)?savedTheme:themeDefaults),false);

const studio=$('#studio-panel'), studioOpen=$('#studio-open'), studioScrim=$('#studio-scrim');
function toggleStudio(open) {
  studio.hidden=!open;studioScrim.hidden=!open;studioOpen.setAttribute('aria-expanded',String(open));
  if(open)$('#studio-close').focus();else studioOpen.focus();
}
studioOpen.addEventListener('click',()=>toggleStudio(true));
$('#studio-close').addEventListener('click',()=>toggleStudio(false));
studioScrim.addEventListener('click',()=>toggleStudio(false));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!studio.hidden)toggleStudio(false);});
document.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>applyTheme(themePresets[button.dataset.preset])));
document.querySelectorAll('input[data-theme]').forEach(input=>input.addEventListener('input',()=>applyTheme({...theme,[input.dataset.theme]:input.value})));
$('#studio-reset').addEventListener('click',()=>{
  applyTheme(themeDefaults);
  const url=new URL(location.href);url.searchParams.delete('tema');history.replaceState(history.state,'',url);
  $('#studio-share-fallback').hidden=true;
  $('#studio-feedback').textContent='Warna awal dipulihkan.';
});
$('#studio-share').addEventListener('click',async()=>{
  const url=new URL(location.href);
  url.searchParams.set('tema',themeKeys.map(key=>theme[key].slice(1)).join('.'));
  url.searchParams.set('studio','1');
  url.searchParams.delete('lomba');
  try{await navigator.clipboard.writeText(url.toString());$('#studio-share-fallback').hidden=true;$('#studio-feedback').textContent='Tautan tema tersalin. Kirimkan untuk memperlihatkan desainmu.';}
  catch{
    history.replaceState(history.state,'',url);
    $('#studio-share-fallback').hidden=false;
    $('#studio-share-url').value=url.toString();
    $('#studio-share-url').select();
    $('#studio-feedback').textContent='Salin tautan yang muncul di atas untuk membagikan tema.';
  }
});
if(new URL(location.href).searchParams.get('studio')==='1')toggleStudio(true);
