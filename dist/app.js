let competitions = [];

const $ = selector => document.querySelector(selector);
const grid = $('#competition-grid');
const isOpen = item => new Date(item.deadline) >= new Date();
const formatDate = date => new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Jakarta'}).format(new Date(date));
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const poster = item => item.posterImage
  ? `<img class="poster-image" src="${escapeHTML(item.posterImage)}" alt="Poster ${escapeHTML(item.title)}" loading="lazy">`
  : `<div class="poster-missing" role="img" aria-label="Poster belum diunggah untuk ${escapeHTML(item.title)}"><span aria-hidden="true">▧</span><strong>Poster belum diunggah</strong></div>`;

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
  const open=isOpen(item);
  const url=/^https:\/\//i.test(item.registrationUrl)?item.registrationUrl:'';
  $('#catalog-page').hidden=true;
  $('#competition-detail-page').hidden=false;
  $('#detail-content').innerHTML=`<div class="detail-poster">${poster(item)}</div><div class="detail-info">
    <p class="overline">INFO LOMBA</p>
    <span class="detail-status ${open?'is-open':'is-closed'}">${open?'● Masih dibuka':'● Sudah ditutup'}</span>
    <h1 id="detail-title">${escapeHTML(item.title)}</h1>
    <div class="detail-organizer"><small>PENYELENGGARA</small><strong>${escapeHTML(item.organizer||item.subtitle||'Belum dicantumkan')}</strong></div>
    <p class="detail-description">${escapeHTML(item.description||'Informasi dan persyaratan lomba dapat dilihat pada laman resmi penyelenggara.')}</p>
    <dl class="detail-facts"><div><dt>Batas pendaftaran</dt><dd>${formatDate(item.deadline)}<small>23.59 WIB</small></dd></div><div><dt>Biaya pendaftaran</dt><dd>${escapeHTML(item.fee||'Belum dicantumkan')}</dd></div><div><dt>Bidang</dt><dd>${escapeHTML(item.category)}</dd></div></dl>
    ${open&&url?`<a class="register-button" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Buka pendaftaran resmi <span aria-hidden="true">↗</span></a>`:`<span class="register-button disabled" aria-disabled="true">${open?'Tautan pendaftaran belum tersedia':'Pendaftaran telah ditutup'}</span>`}
    <p class="detail-caution">Pastikan kembali persyaratan pada laman resmi penyelenggara sebelum mendaftar.</p>
  </div>`;
  document.title=`${item.title} — Info Lomba CSSMoRA UNAIR`;
  window.scrollTo({top:0,behavior:'auto'});
  if(updateURL){const u=new URL(location.href);u.searchParams.set('lomba',item.id);history.pushState({lomba:item.id},'',u);}
}
function closeDetail(updateURL=true){
  $('#competition-detail-page').hidden=true;
  $('#catalog-page').hidden=false;
  document.title='Info Lomba — CSSMoRA UNAIR';
  if(updateURL&&new URL(location.href).searchParams.has('lomba')){const u=new URL(location.href);u.searchParams.delete('lomba');history.pushState({},'',u);}
  window.scrollTo({top:0,behavior:'auto'});
}
grid.addEventListener('click',event=>{const card=event.target.closest('[data-id]');if(card){const item=competitions.find(x=>x.id===card.dataset.id);if(item)detail(item);}});
$('#detail-back').addEventListener('click',event=>{event.preventDefault();closeDetail();});
window.addEventListener('popstate',()=>{const id=new URL(location.href).searchParams.get('lomba');const item=competitions.find(x=>x.id===id);if(item)detail(item,false);else closeDetail(false);});
['search','category','status'].forEach(id=>$('#'+id).addEventListener(id==='search'?'input':'change',render));
document.querySelectorAll('.quick-filter').forEach(button=>button.addEventListener('click',()=>{$('#category').value=button.dataset.category;render();}));
$('#reset-filter').addEventListener('click',()=>{$('#search').value='';$('#category').value='all';$('#status').value='all';render();$('#search').focus();});
render();

async function loadCompetitions() {
  const status = $('#data-status');
  const statusMessage = status.querySelector('p');
  const config = window.CSSMORA_SUPABASE;
  status.hidden = true;
  if (!config?.url || !config?.publishableKey) {
    status.hidden = false;
    statusMessage.innerHTML = '<strong>Konfigurasi katalog belum tersedia.</strong> Hubungi pengurus CSSMoRA.';
    return;
  }
  status.hidden = false;
  statusMessage.innerHTML = '<strong>Memuat daftar lomba…</strong> Mohon tunggu sebentar.';
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
    status.hidden = true;
    statusMessage.innerHTML = '';
    const initial = competitions.find(item => item.id === new URL(location.href).searchParams.get('lomba'));
    if (initial) detail(initial, false);
  } catch (error) {
    console.error('Gagal memuat katalog lomba:', error);
    competitions = [];
    render();
    status.hidden = false;
    statusMessage.innerHTML = '<strong>Katalog belum dapat dimuat.</strong> Coba muat ulang halaman beberapa saat lagi.';
  }
}
loadCompetitions();
