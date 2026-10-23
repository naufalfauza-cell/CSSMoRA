(()=>{
  const $=selector=>document.querySelector(selector);
  const config=window.CSSMORA_SUPABASE;
  const domain=window.CSSMoRADomain;
  const escape=window.CSSMORA_ESCAPE||((value)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])));
  const dateLabel=value=>value?new Date(`${value}T00:00:00+07:00`).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Jakarta'}):'—';
  let records=[];
  let participants=[];
  let recordFilter='pending';

  function renderAchievementRecords(){
    const query=$('#achievement-record-search').value.trim().toLowerCase();
    let rows=recordFilter==='all'?records:records.filter(row=>row.status===recordFilter);
    rows=rows.filter(row=>{
      const names=participants.filter(person=>person.record_id===row.id).map(person=>person.member_name).join(' ');
      return `${row.competition_name} ${row.award_title} ${names}`.toLowerCase().includes(query);
    });
    $('#achievement-record-count').textContent=`${rows.length} capaian`;
    const list=$('#achievement-record-list');
    if(!rows.length){list.innerHTML='<p class="records-empty">Tidak ada capaian pada filter ini.</p>';return;}
    const labels={pending:'MENUNGGU VERIFIKASI',approved:'DISETUJUI',rejected:'DITOLAK'};
    list.innerHTML=rows.map(row=>{
      const team=participants.filter(person=>person.record_id===row.id);
      const names=team.map(person=>`${escape(person.member_name)} · ${escape(person.cohort)}`).join(', ');
      return `<article class="achievement-record-card" data-record-id="${escape(row.id)}"><header><div><span class="record-status ${row.status==='approved'?'published':''}">${labels[row.status]||escape(row.status)}</span><h4>${escape(row.competition_name)}</h4><p>${escape(row.award_title)} · ${dateLabel(row.event_date)} · ${escape(row.competition_level)}</p></div><button type="button" data-record-action="certificate" data-id="${escape(row.id)}">Lihat sertifikat ↗</button></header><div class="achievement-record-meta"><span>${row.participation_type==='tim'?'Tim':'Individu'}</span>${row.competition_category?`<span>${escape(row.competition_category)}</span>`:''}</div><p class="achievement-record-members"><small>Peserta</small>${names||'Nama tidak tersedia'}</p>${row.contact_email?`<p class="achievement-record-email">${escape(row.contact_email)}</p>`:''}${row.review_note?`<p class="achievement-record-note">Catatan: ${escape(row.review_note)}</p>`:''}${row.status==='pending'?`<div class="achievement-record-review"><label>Catatan peninjauan<input type="text" maxlength="1000" data-review-note placeholder="Wajib diisi jika ditolak"></label><button type="button" data-record-action="reject" data-id="${escape(row.id)}" class="achievement-record-reject">Tolak</button><button type="button" data-record-action="approve" data-id="${escape(row.id)}" class="achievement-record-approve">Setujui</button></div>`:''}</article>`;
    }).join('');
  }
  async function loadAchievementRecords(){
    const list=$('#achievement-record-list');if(!list)return;
    list.setAttribute('aria-busy','true');if(!records.length)list.innerHTML='<p class="records-empty">Memuat capaian prestasi…</p>';
    try{
      const rows=await api('cssmora_achievement_records?select=*&order=created_at.desc');
      const ids=rows.map(row=>row.id);
      const people=ids.length?await api(`cssmora_achievement_record_members?select=record_id,member_id,member_name,cohort&record_id=in.(${ids.map(encodeURIComponent).join(',')})&order=cohort.desc,member_name.asc`):[];
      records=rows;participants=people;renderAchievementRecords();
    }catch(error){list.innerHTML=`<p class="records-empty">${escape(error.message)}</p>`;}
    finally{list.removeAttribute('aria-busy');}
  }
  window.CSSMoRAWorkflows={loadAchievementRecords};
  $('#achievement-record-refresh')?.addEventListener('click',()=>void loadAchievementRecords());
  $('#achievement-record-search')?.addEventListener('input',renderAchievementRecords);
  document.querySelectorAll('[data-achievement-record-filter]').forEach(button=>button.addEventListener('click',()=>{
    recordFilter=button.dataset.achievementRecordFilter;
    document.querySelectorAll('[data-achievement-record-filter]').forEach(item=>item.classList.toggle('is-active',item===button));renderAchievementRecords();
  }));
  $('#achievement-record-list')?.addEventListener('click',async event=>{
    const button=event.target.closest('[data-record-action]');if(!button)return;
    const row=records.find(item=>item.id===button.dataset.id);if(!row)return;
    if(button.dataset.recordAction==='certificate'){
      try{
        const path=row.certificate_path.split('/').map(encodeURIComponent).join('/');
        const response=await authenticatedFetch(`${config.url}/storage/v1/object/sign/cssmora-achievement-certificates/${path}`,{method:'POST',headers:{...baseHeaders(),Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({expiresIn:3600})});
        const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||'Sertifikat belum dapat dibuka.');
        const url=data.signedURL?.startsWith('http')?data.signedURL:`${config.url}/storage/v1${data.signedURL}`;
        $('#achievement-record-proof-frame').src=url;$('#achievement-record-proof-dialog').showModal();
      }catch(error){showMessage('#achievement-record-message',error.message,'error');}return;
    }
    const decision=button.dataset.recordAction==='approve'?'approved':'rejected';
    const card=button.closest('.achievement-record-card'),note=card.querySelector('[data-review-note]')?.value.trim()||'';
    if(decision==='rejected'&&!note){showMessage('#achievement-record-message','Isi catatan alasan sebelum menolak capaian.','error');return;}
    card.querySelectorAll('[data-record-action="approve"],[data-record-action="reject"]').forEach(item=>item.disabled=true);
    try{await api('rpc/review_cssmora_achievement_record',{method:'POST',body:{p_id:row.id,p_decision:decision,p_note:note||null}});showMessage('#achievement-record-message',decision==='approved'?'Capaian disetujui dan akan tampil di halaman publik.':'Capaian ditolak.','success');await loadAchievementRecords();}
    catch(error){showMessage('#achievement-record-message',error.message,'error');card.querySelectorAll('[data-record-action="approve"],[data-record-action="reject"]').forEach(item=>item.disabled=false);}
  });
  $('#achievement-record-proof-close')?.addEventListener('click',()=>{$('#achievement-record-proof-frame').src='';$('#achievement-record-proof-dialog').close();});

  const publicForm=$('#public-achievement-form');
  if(publicForm){
    const memberSelect=$('#public-achievement-leader'),memberList=$('#public-achievement-team-list'),selected=new Set();let roster=[];
    const renderLeader=()=>{const old=memberSelect.value;memberSelect.innerHTML='<option value="">Pilih nama anggota</option>'+roster.map(person=>`<option value="${escape(person.id)}">${escape(person.full_name)}</option>`).join('');if(roster.some(person=>person.id===old))memberSelect.value=old;};
    const renderTeam=()=>{const term=$('#public-achievement-member-search').value.trim().toLowerCase(),leader=memberSelect.value;const available=roster.filter(person=>person.id!==leader&&person.full_name.toLowerCase().includes(term));memberList.innerHTML=available.length?available.map(person=>`<label class="public-achievement-member"><input type="checkbox" value="${escape(person.id)}" ${selected.has(person.id)?'checked':''}><span><strong>${escape(person.full_name)}</strong></span></label>`).join(''):'<p>Tidak ada nama yang cocok.</p>';};
    async function loadPublicAchievements(){
      try{
        const response=await fetch(`${config.url}/rest/v1/rpc/cssmora_public_achievement_recap`,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:'{}'});
        const rows=await response.json();if(!response.ok)throw new Error('Rekap prestasi belum dapat dimuat.');
        const list=$('#public-achievement-recap-list');
        list.innerHTML=rows.length?rows.map(row=>`<article class="public-achievement-card"><span class="public-achievement-rank">${escape(row.award_title)}</span><h3>${escape(row.competition_name)}</h3><p>${dateLabel(row.event_date)} · ${escape(row.competition_level)}${row.competition_category?` · ${escape(row.competition_category)}`:''}</p><small>${escape((row.participant_names||[]).join(', '))}</small></article>`).join(''):'<p class="records-empty">Belum ada capaian yang dipublikasikan.</p>';
      }catch{const list=$('#public-achievement-recap-list');if(list)list.innerHTML='<p class="records-empty">Rekap prestasi belum dapat dimuat.</p>';}
    }
    async function loadPublicRoster(){
      try{const response=await fetch(`${config.url}/rest/v1/rpc/cssmora_public_achievement_member_roster`,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:'{}'});const rows=await response.json();if(!response.ok)throw new Error(rows.message||'Roster anggota tidak dapat dimuat.');roster=rows;renderLeader();renderTeam();}
      catch(error){memberSelect.innerHTML='<option value="">Roster tidak dapat dimuat</option>';$('#public-achievement-message').textContent=error.message;$('#public-achievement-message').dataset.kind='error';}
    }
    document.querySelectorAll('input[name="public_participation_type"]').forEach(input=>input.addEventListener('change',()=>{$('#public-achievement-team-fields').hidden=publicForm.elements.public_participation_type.value!=='tim';if(publicForm.elements.public_participation_type.value!=='tim')selected.clear();renderTeam();}));
    memberSelect.addEventListener('change',renderTeam);$('#public-achievement-member-search').addEventListener('input',renderTeam);
    memberList.addEventListener('change',event=>{const input=event.target.closest('input[type="checkbox"]');if(!input)return;if(input.checked)selected.add(input.value);else selected.delete(input.value);});
    publicForm.addEventListener('submit',async event=>{
      event.preventDefault();const message=$('#public-achievement-message'),button=$('#public-achievement-submit'),source=$('#public-achievement-certificate').files[0];message.textContent='';message.dataset.kind='';
      if(!publicForm.reportValidity())return;if(!source){message.textContent='Unggah sertifikat atau bukti penghargaan.';message.dataset.kind='error';return;}
      if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(source.type)){message.textContent='Format berkas harus JPG, PNG, WebP, atau PDF.';message.dataset.kind='error';return;}
      const type=publicForm.elements.public_participation_type.value;let ids=[];
      try{ids=domain.participantIds(type,memberSelect.value,type==='tim'?[...selected]:[]);}catch(error){message.textContent=error.message;message.dataset.kind='error';return;}
      const id=crypto.randomUUID();button.disabled=true;button.textContent='Mengirim…';
      try{
        let file=source;if(source.type!=='application/pdf')file=await window.CSSMoRAUpload.compressImage(source,{maxBytes:2*1024*1024});
        if(file.size>5*1024*1024)throw new Error('Sertifikat maksimal 5 MB setelah dikompres.');
        const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'}[file.type];if(!extension)throw new Error('Format berkas sertifikat tidak didukung.');
        const payload={id,competition_name:publicForm.elements.competition_name.value.trim(),competition_level:publicForm.elements.competition_level.value,
          competition_category:publicForm.elements.competition_category.value.trim(),participation_type:type,award_title:publicForm.elements.award_title.value.trim(),
          event_date:publicForm.elements.event_date.value,contact_email:publicForm.elements.contact_email.value.trim()||null,member_ids:ids};
        const body=new FormData();body.append('payload',JSON.stringify(payload));body.append('certificate',file,`certificate.${extension}`);
        const response=await fetch(`${config.url}/functions/v1/submit-achievement-record`,{method:'POST',headers:{apikey:config.publishableKey},body});
        const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Capaian belum berhasil dikirim.');
        message.innerHTML=`Laporan <strong>${escape(result.request_number||'')}</strong> terkirim dan menunggu verifikasi pengurus.`;message.dataset.kind='success';publicForm.reset();selected.clear();$('#public-achievement-team-fields').hidden=true;renderLeader();renderTeam();
      }catch(error){message.textContent=error.message;message.dataset.kind='error';}finally{button.disabled=false;button.innerHTML='Kirim capaian <span aria-hidden="true">↗</span>';}
    });
    void loadPublicRoster();void loadPublicAchievements();
  }
  if($('#public-achievement-date'))$('#public-achievement-date').max=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date());
})();
