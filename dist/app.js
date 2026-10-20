// Contoh data tampilan. Ganti dengan entri terverifikasi sebelum dibuka untuk publik.
// posterImage dan registrationUrl dapat diisi dengan URL resmi ketika tersedia.
const competitions = [
  {id:'cakrawala-riset',title:'Cakrawala Riset',subtitle:'National Research Challenge',category:'Esai & Riset',organizer:'Penyelenggara contoh A',deadline:'2026-11-18',fee:'Gratis',palette:'lime',mark:'CR',year:'2026',posterImage:'',registrationUrl:'',description:'Contoh katalog lomba riset untuk memperlihatkan informasi yang akan dilihat pengunjung.'},
  {id:'ide-berdampak',title:'Ide Berdampak',subtitle:'Social Innovation Competition',category:'Bisnis & Inovasi',organizer:'Penyelenggara contoh B',deadline:'2026-11-02',fee:'Rp50.000 / tim',palette:'coral',mark:'IB',year:'2026',posterImage:'',registrationUrl:'',description:'Contoh kompetisi inovasi sosial dengan informasi biaya dan tenggat.'},
  {id:'suara-muda',title:'Suara Muda',subtitle:'University Debate Open',category:'Debat & Public Speaking',organizer:'Penyelenggara contoh C',deadline:'2026-12-08',fee:'Gratis',palette:'purple',mark:'SM',year:'2026',posterImage:'',registrationUrl:'',description:'Contoh kompetisi debat bagi mahasiswa.'},
  {id:'ruang-visual',title:'Ruang Visual',subtitle:'Creative Poster Festival',category:'Desain & Media',organizer:'Penyelenggara contoh D',deadline:'2026-10-31',fee:'Rp25.000',palette:'blue',mark:'RV',year:'2026',posterImage:'',registrationUrl:'',description:'Contoh lomba desain poster dan komunikasi visual.'},
  {id:'future-finance',title:'Future Finance',subtitle:'Accounting Case Challenge',category:'Bisnis & Inovasi',organizer:'Penyelenggara contoh E',deadline:'2026-11-25',fee:'Rp75.000 / tim',palette:'yellow',mark:'FF',year:'2026',posterImage:'',registrationUrl:'',description:'Contoh kompetisi studi kasus keuangan dan bisnis.'},
  {id:'nalar-hijau',title:'Nalar Hijau',subtitle:'Sustainability Essay',category:'Esai & Riset',organizer:'Penyelenggara contoh F',deadline:'2026-12-15',fee:'Gratis',palette:'forest',mark:'NH',year:'2026',posterImage:'',registrationUrl:'',description:'Contoh lomba esai bertema keberlanjutan.'},
  {id:'panggung-kata',title:'Panggung Kata',subtitle:'Public Speaking Festival',category:'Debat & Public Speaking',organizer:'Penyelenggara contoh G',deadline:'2026-09-30',fee:'Rp30.000',palette:'pink',mark:'PK',year:'2026',posterImage:'',registrationUrl:'',description:'Contoh lomba public speaking dengan pendaftaran yang sudah berakhir.'},
  {id:'lensa-kota',title:'Lensa Kota',subtitle:'Photography Challenge',category:'Desain & Media',organizer:'Penyelenggara contoh H',deadline:'2026-10-10',fee:'Gratis',palette:'ink',mark:'LK',year:'2026',posterImage:'',registrationUrl:'',description:'Contoh lomba fotografi dengan pendaftaran yang sudah berakhir.'},
  {id:'peta-perubahan',title:'Peta Perubahan',subtitle:'Policy Paper Competition',category:'Esai & Riset',organizer:'Penyelenggara contoh I',deadline:'2026-11-12',fee:'Rp40.000 / tim',palette:'sky',mark:'PP',year:'2026',posterImage:'',registrationUrl:'',description:'Contoh kompetisi policy paper untuk mahasiswa.'},
  {id:'usaha-bersama',title:'Usaha Bersama',subtitle:'Business Plan Competition',category:'Bisnis & Inovasi',organizer:'Penyelenggara contoh J',deadline:'2026-09-16',fee:'Rp60.000 / tim',palette:'orange',mark:'UB',year:'2026',posterImage:'',registrationUrl:'',description:'Contoh kompetisi rencana bisnis dengan pendaftaran yang telah ditutup.'},
  {id:'aksara-digital',title:'Aksara Digital',subtitle:'Digital Campaign Challenge',category:'Desain & Media',organizer:'Penyelenggara contoh K',deadline:'2026-11-05',fee:'Gratis',palette:'mint',mark:'AD',year:'2026',posterImage:'',registrationUrl:'',description:'Contoh tantangan kampanye digital.'},
  {id:'argumen-baru',title:'Argumen Baru',subtitle:'National Speech Contest',category:'Debat & Public Speaking',organizer:'Penyelenggara contoh L',deadline:'2026-10-04',fee:'Rp35.000',palette:'red',mark:'AB',year:'2026',posterImage:'',registrationUrl:'',description:'Contoh lomba pidato dengan masa pendaftaran yang telah usai.'},
];

const $ = selector => document.querySelector(selector);
const grid = $('#competition-grid');
const dialog = $('#detail-dialog');
const jakartaToday = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const isOpen = item => item.deadline >= jakartaToday();
const formatDate = date => new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const poster = item => item.posterImage
  ? `<img class="poster-image" src="${escapeHTML(item.posterImage)}" alt="Poster ${escapeHTML(item.title)}" loading="lazy">`
  : `<div class="poster-design palette-${item.palette}" role="img" aria-label="Poster contoh ${escapeHTML(item.title)}"><div class="design-top"><span>CSSMoRA / EXPLORE</span><span>✳</span></div><div class="design-symbol">${escapeHTML(item.mark)}</div><div class="design-main"><span>${escapeHTML(item.subtitle)}</span><strong>${escapeHTML(item.title)}</strong></div><div class="design-bottom"><span>OPEN CALL • ${escapeHTML(item.year)}</span><span>↗</span></div></div>`;

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
    <div class="card-meta"><span>${escapeHTML(item.category)}</span><span>CONTOH</span></div>
    <div class="card-title-row"><h3>${escapeHTML(item.title)}</h3><span aria-hidden="true">↗</span></div>
    <p>${escapeHTML(item.organizer)}</p><div class="card-bottom"><span>Batas pendaftaran</span><strong>${formatDate(item.deadline)}</strong></div>
  </button>`).join('');
  $('#result-count').textContent = `${items.length} lomba ditemukan`;
  $('#empty-state').hidden = items.length !== 0;
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
    <span class="overline">INFO LOMBA / CONTOH TAMPILAN</span>
    <span class="detail-status ${open?'is-open':'is-closed'}">● ${open?'Masih dibuka':'Sudah ditutup'}</span>
    <h2 id="detail-title">${escapeHTML(item.title)}</h2><p class="detail-subtitle">${escapeHTML(item.subtitle)}</p>
    <p class="detail-description">${escapeHTML(item.description)}</p>
    <dl class="detail-facts"><div><dt>Batas pendaftaran</dt><dd>${formatDate(item.deadline)}<small>23.59 WIB</small></dd></div><div><dt>Biaya pendaftaran</dt><dd>${escapeHTML(item.fee)}</dd></div><div><dt>Penyelenggara</dt><dd>${escapeHTML(item.organizer)}</dd></div><div><dt>Bidang</dt><dd>${escapeHTML(item.category)}</dd></div></dl>
    ${open&&url?`<a class="register-button" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Buka pendaftaran resmi <span aria-hidden="true">↗</span></a>`:`<span class="register-button disabled" aria-disabled="true">${open?'Tautan pendaftaran belum tersedia':'Pendaftaran telah ditutup'}</span>`}
    <p class="detail-caution">Ini data contoh untuk pratinjau. Pastikan informasi dari penyelenggara sebelum mendaftar.</p>
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
const initial=competitions.find(x=>x.id===new URL(location.href).searchParams.get('lomba'));
if(initial)detail(initial,false);

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
