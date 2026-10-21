(() => {
  const grid = document.getElementById('opportunity-grid');
  const count = document.getElementById('open-count');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateLabel = value => new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Jakarta'}).format(new Date(value+'T12:00:00+07:00'));
  const openNow = value => new Date(value+'T23:59:59+07:00').getTime() >= Date.now();
  const poster = item => {
    const image = /^https:\/\//i.test(item.posterImage || '') ? '<img src="'+esc(item.posterImage)+'" alt="" loading="lazy">' : '';
    return '<div class="opp-poster">'+image+'<span class="opp-state '+(openNow(item.deadline)?'':'closed')+'">'+(openNow(item.deadline)?'Masih dibuka':'Ditutup')+'</span>'+(image?'':'<span class="poster-mark">'+esc(item.mark || '✳')+'</span><span class="poster-title">'+esc(item.title)+'</span>')+'</div>';
  };
  const card = item => '<a class="opportunity-card opp-link" href="./lomba.html?lomba='+encodeURIComponent(item.id)+'" aria-label="Lihat detail '+esc(item.title)+'">'+poster(item)+'<div class="opp-body"><span class="opp-category">'+esc(item.category || 'Lomba')+'</span><h3>'+esc(item.title)+'</h3><p>'+esc(item.organizer || 'CSSMoRA UNAIR')+'</p><div class="opp-foot"><span>Batas pendaftaran</span><b>'+dateLabel(item.deadline)+'</b></div></div></a>';
  const empty = (title, body) => { grid.innerHTML='<div class="no-opportunities"><div><strong>'+title+'</strong><p>'+body+'</p></div><a href="./lomba.html">Buka katalog lomba ↗</a></div>'; };
  async function load() {
    const config = window.CSSMORA_SUPABASE;
    if (!config?.url || !config?.publishableKey) {
      count.textContent='Info lomba belum tersedia';
      empty('Katalog sedang disiapkan','Coba buka kembali beberapa saat lagi.');
      return;
    }
    const params = new URLSearchParams({select:'id,title,category,organizer,deadline,mark,posterImage',status:'eq.published',order:'deadline.asc',limit:'30'});
    try {
      const res = await fetch(config.url+'/rest/v1/competitions?'+params,{headers:{apikey:config.publishableKey,Authorization:'Bearer '+config.publishableKey}});
      if (!res.ok) throw new Error('Competition data unavailable');
      const items = await res.json();
      const open = items.filter(item=>openNow(item.deadline)).sort((a,b)=>a.deadline.localeCompare(b.deadline));
      const closed = items.filter(item=>!openNow(item.deadline)).sort((a,b)=>b.deadline.localeCompare(a.deadline));
      const featured = [...open,...closed].slice(0,3);
      count.textContent=open.length+' lomba masih dibuka';
      if (!featured.length) {
        empty('Belum ada lomba yang dipublikasikan','Info poster dan pendaftaran akan tampil di sini saat tersedia.');
        return;
      }
      grid.innerHTML=featured.map(card).join('');
    } catch (_) {
      count.textContent='Katalog lomba';
      empty('Info lomba belum dapat dimuat','Silakan coba lagi nanti atau buka halaman katalog.');
    }
  }
  load();
})();