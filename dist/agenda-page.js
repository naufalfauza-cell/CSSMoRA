(() => {
  const config=window.CSSMORA_SUPABASE;
  const list=document.getElementById('agenda-list');
  const grid=document.getElementById('calendar-grid');
  if(!config||!list||!grid)return;

  const tz='Asia/Jakarta';
  const monthFormat=new Intl.DateTimeFormat('id-ID',{timeZone:'UTC',month:'long',year:'numeric'});
  const fullDate=new Intl.DateTimeFormat('id-ID',{timeZone:tz,weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const shortDate=new Intl.DateTimeFormat('id-ID',{timeZone:tz,weekday:'short',day:'numeric',month:'short'});
  const dateTime=new Intl.DateTimeFormat('id-ID',{timeZone:tz,day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dayKey=date=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
  const keyOf=(year,month,day)=>`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const dateFromKey=key=>{const [year,month,day]=key.split('-').map(Number);return new Date(Date.UTC(year,month-1,day,12));};
  const dayDiff=(from,to)=>Math.round((dateFromKey(to)-dateFromKey(from))/86400000);
  const timeOf=value=>new Intl.DateTimeFormat('id-ID',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
  const todayLabel=document.getElementById('today-label');
  const monthLabel=document.getElementById('month-label');
  const filterNote=document.getElementById('agenda-filter-note');
  const resetFilter=document.getElementById('show-month-agenda');
  let events=[];
  let viewYear=Number(dayKey(new Date()).slice(0,4));
  let viewMonth=Number(dayKey(new Date()).slice(5,7))-1;
  let selectedDay=null;

  const monthKey=()=>`${viewYear}-${String(viewMonth+1).padStart(2,'0')}`;
  const eventEnd=event=>event.ends_at?new Date(event.ends_at):new Date(event.starts_at);
  const overlapsDay=(event,key)=>dayKey(new Date(event.starts_at))<=key&&dayKey(eventEnd(event))>=key;
  const eventsInView=()=>{
    const first=keyOf(viewYear,viewMonth,1);
    const last=keyOf(viewYear,viewMonth,new Date(viewYear,viewMonth+1,0).getDate());
    const now=Date.now();
    return events.filter(event=>dayKey(new Date(event.starts_at))<=last&&dayKey(eventEnd(event))>=first)
      .sort((a,b)=>{
        const aStart=new Date(a.starts_at).getTime(),bStart=new Date(b.starts_at).getTime();
        const aPast=eventEnd(a).getTime()<now,bPast=eventEnd(b).getTime()<now;
        if(aPast!==bPast)return aPast?1:-1;
        return aPast?bStart-aStart:aStart-bStart;
      });
  };
  const countdown=event=>{
    const now=Date.now(),start=new Date(event.starts_at).getTime(),end=eventEnd(event).getTime();
    if(start<=now&&end>now)return {day:'Sedang berlangsung',time:'Sedang berlangsung',live:true};
    if(end<=now)return {day:'Selesai',time:'Agenda telah berlangsung',live:false};
    const ms=start-now,days=dayDiff(dayKey(new Date()),dayKey(new Date(start)));
    const hours=Math.floor(ms/3600000),minutes=Math.floor((ms%3600000)/60000);
    const day=days<=0?'Hari ini':`H-${days}`;
    const time=days>0?`${days} hari ${hours%24} jam lagi`:hours>0?`${hours} jam ${minutes} menit lagi`:`${Math.max(minutes,1)} menit lagi`;
    return {day,time,live:false};
  };
  const dateRange=event=>{
    const start=new Date(event.starts_at),end=event.ends_at?new Date(event.ends_at):null;
    const sameDay=!end||dayKey(start)===dayKey(end);
    if(sameDay)return `${fullDate.format(start)} · ${timeOf(event.starts_at)} WIB${end?`–${timeOf(event.ends_at)} WIB`:''}`;
    return `${dateTime.format(start)} sampai ${dateTime.format(end)} WIB`;
  };
  const renderList=()=>{
    const base=eventsInView();
    const shown=selectedDay?base.filter(event=>overlapsDay(event,selectedDay)):base;
    filterNote.hidden=!selectedDay;
    resetFilter.hidden=!selectedDay;
    if(selectedDay)filterNote.textContent=`Agenda pada ${fullDate.format(dateFromKey(selectedDay))}`;
    if(!shown.length){
      const title=selectedDay?'Belum ada agenda pada tanggal ini':'Belum ada agenda bulan ini';
      const copy=selectedDay?'Pilih tanggal bertanda titik di kalender atau tampilkan kembali semua agenda bulan ini.':'Agenda yang diterbitkan pengurus akan muncul di sini.';
      list.innerHTML=`<div class="agenda-empty"><strong>${title}</strong>${copy}</div>`;
      return;
    }
    list.innerHTML=shown.map(event=>{
      const count=countdown(event);
      const program=event.program||null;
      const image=program?.photo_url||'./assets/cssmora-logo.png';
      const label=program?.name||'CSSMoRA UNAIR';
      const location=event.location?`<span><b aria-hidden="true">⌖</b>${esc(event.location)}</span>`:'';
      return `<article class="agenda-event-card">
        <div class="agenda-card-photo"><img src="${esc(image)}" alt="${esc(label)}" loading="lazy"><span class="agenda-photo-tag">${esc(label)}</span></div>
        <div class="agenda-card-body">
          <div class="agenda-card-top"><span class="agenda-date-line">${esc(dateRange(event))}</span><span class="agenda-countdowns"><span class="${count.live?'countdown-live':'countdown-day'}">${count.day}</span><span class="countdown-time">${count.time}</span></span></div>
          <h3>${esc(event.title)}</h3>
          ${program?`<p class="agenda-program-name">${esc(program.name)}</p>`:''}
          ${event.description?`<p class="agenda-event-description">${esc(event.description)}</p>`:''}
          <div class="agenda-event-meta">${location}</div>
        </div>
      </article>`;
    }).join('');
    list.querySelectorAll('.agenda-card-photo img').forEach(image=>image.addEventListener('error',()=>{
      if(image.dataset.fallback)return;
      image.dataset.fallback='true';image.src='./assets/cssmora-logo.png';
    },{once:true}));
  };
  const renderCalendar=()=>{
    const monthStart=new Date(viewYear,viewMonth,1).getDay();
    const offset=(monthStart+6)%7;
    const count=new Date(viewYear,viewMonth+1,0).getDate();
    const today=dayKey(new Date());
    const eventDates=new Set();
    eventsInView().forEach(event=>{
      const start=dayKey(new Date(event.starts_at)),end=dayKey(eventEnd(event));
      for(let day=1;day<=count;day++){
        const key=keyOf(viewYear,viewMonth,day);
        if(start<=key&&end>=key)eventDates.add(key);
      }
    });
    monthLabel.textContent=monthFormat.format(new Date(Date.UTC(viewYear,viewMonth,15,12)));
    todayLabel.textContent=fullDate.format(new Date());
    const cells=[];
    for(let cell=0;cell<42;cell++){
      const day=cell-offset+1;
      if(day<1||day>count){cells.push('<span class="calendar-day calendar-day-outside" aria-hidden="true"></span>');continue;}
      const key=keyOf(viewYear,viewMonth,day),has=eventDates.has(key);
      const classes=['calendar-day'];
      if(key===today)classes.push('is-today');
      if(key===selectedDay)classes.push('is-selected');
      cells.push(`<button type="button" class="${classes.join(' ')}" data-date="${key}" aria-label="${esc(fullDate.format(dateFromKey(key)))}${has?', ada agenda':''}" aria-pressed="${key===selectedDay}"><span>${day}</span>${has?'<i aria-hidden="true"></i>':''}</button>`);
    }
    grid.innerHTML=cells.join('');
  };
  const render=()=>{renderCalendar();renderList();};
  const setMonth=offset=>{
    const next=new Date(Date.UTC(viewYear,viewMonth+offset,1,12));
    viewYear=next.getUTCFullYear();viewMonth=next.getUTCMonth();selectedDay=null;render();
  };

  document.getElementById('month-prev').addEventListener('click',()=>setMonth(-1));
  document.getElementById('month-next').addEventListener('click',()=>setMonth(1));
  grid.addEventListener('click',event=>{
    const button=event.target.closest('[data-date]');
    if(!button)return;
    selectedDay=button.dataset.date;render();
    document.getElementById('month-title').scrollIntoView({behavior:'smooth',block:'start'});
  });
  resetFilter.addEventListener('click',()=>{selectedDay=null;render();});

  (async()=>{
    try{
      const headers={apikey:config.publishableKey,Authorization:`Bearer ${config.publishableKey}`};
      const agendaQuery=new URLSearchParams({select:'id,title,starts_at,ends_at,location,description,program_id,status',status:'eq.published',order:'starts_at.asc',limit:'1000'});
      const programsQuery=new URLSearchParams({select:'id,name,photo_url,is_active'});
      const [agendaResponse,programResponse]=await Promise.all([
        fetch(`${config.url}/rest/v1/agenda?${agendaQuery}`,{headers}),
        fetch(`${config.url}/rest/v1/agenda_programs?${programsQuery}`,{headers})
      ]);
      if(!agendaResponse.ok||!programResponse.ok)throw new Error('Agenda belum bisa dimuat.');
      const [rows,programRows]=await Promise.all([agendaResponse.json(),programResponse.json()]);
      const programMap=new Map(programRows.map(program=>[program.id,program]));
      events=rows.map(event=>({...event,program:programMap.get(event.program_id)||null}));
      render();
    }catch(error){
      list.innerHTML='<div class="agenda-empty"><strong>Agenda belum bisa dimuat</strong>Coba muat ulang halaman beberapa saat lagi.</div>';
    }
  })();
  setInterval(()=>{todayLabel.textContent=fullDate.format(new Date());renderList();},60000);
  renderCalendar();
})();
