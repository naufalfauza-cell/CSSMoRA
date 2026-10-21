(() => {
  const box = document.getElementById('agenda-list');
  const cfg = window.CSSMORA_SUPABASE;
  if (!box || !cfg) return;

  const tz = 'Asia/Jakarta';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const parts = (date, options) => new Intl.DateTimeFormat('id-ID', {timeZone:tz,...options}).format(date);
  const dateKey = date => {
    const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
    return values.year+'-'+values.month+'-'+values.day;
  };
  const monthLabel = date => parts(date,{month:'long',year:'numeric'});
  const timeLabel = date => parts(date,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).replace(':','.');
  const eventTime = event => {
    const start = new Date(event.starts_at), end = event.ends_at ? new Date(event.ends_at) : null;
    const startDay = dateKey(start), endDay = end ? dateKey(end) : startDay;
    const datePart = date => parts(date,{weekday:'short',day:'numeric',month:'short'});
    if (end && startDay !== endDay) return datePart(start)+' '+timeLabel(start)+' sampai '+datePart(end)+' '+timeLabel(end)+' WIB';
    return parts(start,{weekday:'long',day:'numeric',month:'long'})+' · '+timeLabel(start)+' WIB'+(end?'–'+timeLabel(end)+' WIB':'');
  };
  const eventEnd = event => event.ends_at ? new Date(event.ends_at) : new Date(event.starts_at);
  const monthBounds = () => {
    const now = new Date();
    const currentDay = dateKey(now);
    const year = Number(currentDay.slice(0,4)), month = Number(currentDay.slice(5,7))-1;
    const first = year+'-'+String(month+1).padStart(2,'0')+'-01';
    const after = new Date(Date.UTC(year,month+1,1)).toISOString().slice(0,10);
    return {first, after, start:first+'T00:00:00+07:00', end:after+'T00:00:00+07:00', label:monthLabel(new Date(Date.UTC(year,month,15,12)))};
  };
  const state = (icon,title,copy) => {
    box.innerHTML='<div class="event-empty"><span class="event-icon" aria-hidden="true">'+icon+'</span><div><strong>'+title+'</strong><p>'+copy+'</p></div></div>';
  };

  const render = (items, month) => {
    box.innerHTML = items.map((event,index) => {
      const start = new Date(event.starts_at);
      const date = '<div class="event-date"><b>'+parts(start,{day:'numeric'})+'</b><span>'+parts(start,{month:'short'})+'</span></div>';
      const program=event.program||null;
      const photo=program?.photo_url||'./assets/cssmora-logo.png';
      const photoName=program?.name||'CSSMoRA UNAIR';
      return '<article class="event-item'+(index===0?' on':'')+'" role="group" aria-roledescription="slide" aria-label="Agenda '+(index+1)+' dari '+items.length+'"><img class="event-photo" src="'+esc(photo)+'" alt="Foto '+esc(photoName)+'"><div class="event-content">'+date+'<div class="event-body"><span class="event-when">'+esc(eventTime(event))+'</span><strong>'+esc(event.title)+'</strong><p>'+esc(event.location||'CSSMoRA UNAIR')+'</p></div></div></article>';
    }).join('') + (items.length>1 ? '<div class="event-carousel-tools"><button type="button" class="event-arrow" data-step="-1" aria-label="Agenda sebelumnya">‹</button><span class="event-position" aria-live="polite">1 dari '+items.length+' · '+esc(month)+'</span><button type="button" class="event-arrow" data-step="1" aria-label="Agenda berikutnya">›</button></div><div class="event-dots" aria-label="Pilih agenda">'+items.map((_,index)=>'<button type="button" data-slide="'+index+'" aria-label="Tampilkan agenda '+(index+1)+'"'+(index===0?' class="on" aria-current="true"':'')+'></button>').join('')+'</div>' : '');
    box.querySelectorAll('.event-photo').forEach(image=>image.addEventListener('error',()=>{image.src='./assets/cssmora-logo.png';},{once:true}));
    if(items.length<2) return;

    const slides = Array.from(box.querySelectorAll('.event-item'));
    const dots = Array.from(box.querySelectorAll('[data-slide]'));
    const position = box.querySelector('.event-position');
    let index = 0, timer = null, pointerStart = null;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const show = next => {
      index = (next+slides.length)%slides.length;
      slides.forEach((slide,i)=>slide.classList.toggle('on',i===index));
      dots.forEach((dot,i)=>{
        dot.classList.toggle('on',i===index);
        if(i===index)dot.setAttribute('aria-current','true');else dot.removeAttribute('aria-current');
      });
      position.textContent=(index+1)+' dari '+slides.length+' · '+month;
    };
    const stop = () => {if(timer){clearInterval(timer);timer=null;}};
    const start = () => {
      stop();
      if(!reducedMotion.matches&&!document.hidden)timer=setInterval(()=>show(index+1),5000);
    };
    box.querySelectorAll('.event-arrow').forEach(button=>button.addEventListener('click',()=>{show(index+Number(button.dataset.step));start();}));
    dots.forEach((button,i)=>button.addEventListener('click',()=>{show(i);start();}));
    box.addEventListener('mouseenter',stop);
    box.addEventListener('mouseleave',start);
    box.addEventListener('focusin',stop);
    box.addEventListener('focusout',event=>{if(!box.contains(event.relatedTarget))start();});
    document.addEventListener('visibilitychange',()=>document.hidden?stop():start());
    reducedMotion.addEventListener?.('change',start);
    box.addEventListener('pointerdown',event=>{if(event.pointerType==='touch')pointerStart=event.clientX;},{passive:true});
    box.addEventListener('pointerup',event=>{
      if(pointerStart===null)return;
      const distance=event.clientX-pointerStart;pointerStart=null;
      if(Math.abs(distance)>42){show(index+(distance<0?1:-1));start();}
    },{passive:true});
    box.addEventListener('pointercancel',()=>{pointerStart=null;},{passive:true});
    start();
  };

  (async()=>{
    const bounds=monthBounds();
    const heading=document.querySelector('.screen-kicker');
    if(heading)heading.textContent='AGENDA '+bounds.label.toLocaleUpperCase('id-ID');
    state('…','Memuat agenda','Mohon tunggu sebentar.');
    try{
      const params=new URLSearchParams({
        select:'id,title,starts_at,ends_at,location,program_id',
        status:'eq.published',
        starts_at:'lt.'+bounds.end,
        or:'(starts_at.gte.'+bounds.start+',ends_at.gte.'+bounds.start+')',
        order:'starts_at.asc',
        limit:'1000'
      });
      const headers={apikey:cfg.publishableKey,Authorization:'Bearer '+cfg.publishableKey};
      const programsQuery=new URLSearchParams({select:'id,name,photo_url'});
      const [response,programResponse]=await Promise.all([
        fetch(cfg.url+'/rest/v1/agenda?'+params,{headers}),
        fetch(cfg.url+'/rest/v1/agenda_programs?'+programsQuery,{headers})
      ]);
      if(!response.ok||!programResponse.ok)throw new Error('Supabase request failed: '+response.status+' '+programResponse.status);
      const [rows,programs]=await Promise.all([response.json(),programResponse.json()]);
      const programMap=new Map(programs.map(program=>[program.id,program]));
      const now=Date.now();
      const items=rows.filter(event=>eventEnd(event).getTime()>=now).map(event=>({...event,program:programMap.get(event.program_id)||null})).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
      if(!items.length)state('▦','Belum ada agenda mendatang','Agenda bulan '+bounds.label+' yang diterbitkan pengurus akan tampil di sini.');
      else render(items,bounds.label);
    }catch(error){
      console.error('Gagal memuat agenda videotron:',error);
      state('!','Agenda belum bisa dimuat','Muat ulang halaman beberapa saat lagi.');
    }
  })();
})();
