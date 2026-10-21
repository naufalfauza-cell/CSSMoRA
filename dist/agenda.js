(() => {
  const box = document.getElementById('agenda-list');
  const cfg = window.CSSMORA_SUPABASE;
  if (!box || !cfg) return;
  const tz = 'Asia/Jakarta';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const part = (d, o) => new Intl.DateTimeFormat('id-ID', {timeZone: tz, ...o}).format(d);
  const dayKey = d => new Intl.DateTimeFormat('en-CA', {timeZone: tz}).format(d);
  const hm = d => part(d, {hour: '2-digit', minute: '2-digit'}).replace(':', '.');
  const when = e => {
    const s = new Date(e.starts_at), f = e.ends_at ? new Date(e.ends_at) : null;
    if (f && dayKey(f) !== dayKey(s)) {
      const lab = d => `${part(d, {weekday: 'short'})}, ${part(d, {day: 'numeric', month: 'short'})} ${hm(d)}`;
      return `${lab(s)} sampai ${lab(f)} WIB`;
    }
    return `${part(s, {weekday: 'long'})}, ${hm(s)}${f ? ' sampai ' + hm(f) : ''} WIB`;
  };
  const state = (icon, title, text) => { box.innerHTML = `<div class="event-empty"><span class="event-icon" aria-hidden="true">${icon}</span><div><strong>${title}</strong><p>${text}</p></div></div>`; };
  const render = items => {
    box.innerHTML = items.map((e, i) => {
      const d = new Date(e.starts_at);
      return `<article class="event-item${i ? '' : ' on'}"><div class="event-date"><b>${part(d, {day:'numeric'})}</b><span>${part(d, {month:'short'})}</span></div>
        <div class="event-body"><strong>${esc(e.title)}</strong><p>${when(e)}${e.location ? ' di ' + esc(e.location) : ''}</p></div></article>`;
    }).join('') + (items.length > 1 ? `<div class="event-dots">${items.map((_, i) => `<button type="button" aria-label="Agenda ${i + 1}"${i ? '' : ' class="on"'}></button>`).join('')}</div>` : '');
    if (items.length < 2) return;
    const slides = [...box.querySelectorAll('.event-item')], dots = [...box.querySelectorAll('.event-dots button')];
    let n = 0, timer;
    const show = i => { n = i; slides.forEach((s, k) => s.classList.toggle('on', k === i)); dots.forEach((b, k) => b.classList.toggle('on', k === i)); };
    const start = () => { if (!matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => show((n + 1) % slides.length), 7000); };
    dots.forEach((b, i) => b.addEventListener('click', () => { clearInterval(timer); show(i); start(); }));
    box.addEventListener('mouseenter', () => clearInterval(timer));
    box.addEventListener('mouseleave', () => { clearInterval(timer); start(); });
    start();
  };
  (async () => {
    state('…', 'Memuat agenda', 'Mohon tunggu sebentar.');
    try {
      const nowIso = new Date().toISOString(), dayStart = new Date(dayKey(new Date()) + 'T00:00:00+07:00').toISOString();
      const q = new URLSearchParams({select: 'id,title,starts_at,ends_at,location', status: 'eq.published', or: `(ends_at.gte.${nowIso},and(ends_at.is.null,starts_at.gte.${dayStart}))`, order: 'starts_at.asc', limit: '3'});
      const res = await fetch(`${cfg.url}/rest/v1/agenda?${q}`, {headers: {apikey: cfg.publishableKey, Authorization: 'Bearer ' + cfg.publishableKey}});
      if (!res.ok) throw new Error(res.status);
      // Tanpa jam selesai, agenda dianggap berlangsung sampai akhir hari mulainya (WIB).
      const endOf = e => e.ends_at ? new Date(e.ends_at) : new Date(dayKey(new Date(e.starts_at)) + 'T23:59:59+07:00');
      const items = (await res.json()).filter(e => endOf(e).getTime() >= Date.now()).slice(0, 3);
      items.length ? render(items) : state('▦', 'Belum ada agenda terbit', 'Agenda yang diumumkan pengurus akan tampil di sini.');
    } catch (err) {
      state('!', 'Agenda belum bisa dimuat', 'Muat ulang halaman beberapa saat lagi.');
    }
  })();
})();
