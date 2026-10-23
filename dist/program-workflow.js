(() => {
  const $ = selector => document.querySelector(selector);
  const domain = window.CSSMoRAProgramWorkflowDomain;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const dateLabel = value => value ? new Intl.DateTimeFormat('id-ID', {timeZone:'Asia/Jakarta',day:'numeric',month:'short',year:'numeric'}).format(new Date(`${value.slice(0,10)}T00:00:00+07:00`)) : '—';
  const dateTimeLabel = value => value ? new Intl.DateTimeFormat('id-ID', {timeZone:'Asia/Jakarta',weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)) : '—';
  const todayWib = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const currentPeriod = () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));
    const year=Number(parts.year),month=Number(parts.month);
    return month>=7?`${year}/${year+1}`:`${year-1}/${year}`;
  };
  const statusClass = status => ['lpj_review','completed'].includes(status)?'published':status==='revision'?'needs-review':'';
  const statusLabel = status => domain.labels[status]||status||'—';
  const showMessage = (message,kind='') => { const node=$('#program-cycle-message');node.textContent=message;node.dataset.kind=kind; };
  let programs=[];
  let cycles=[];
  let milestones=[];
  let history=[];
  let recap=[];
  let currentCycle=null;
  let programPeriods=new Map();
  const downloadButton=$('#download-program-lpj');
  let pendingLoad=null;

  const api=()=>window.CSSMoRAAdmin?.api;
  const context=()=>window.CSSMoRAAdmin?.context?.()||{};
  const dateField=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?value:'';
  const programFor=id=>programs.find(program=>program.id===id);
  const cyclesWithNames=()=>cycles.map(cycle=>({...cycle,program_name:programFor(cycle.program_id)?.name||'Proker'}));
  const milestonesWithNames=()=>milestones.map(milestone=>({...milestone,program_name:programFor(cycles.find(cycle=>cycle.id===milestone.cycle_id)?.program_id)?.name||'Proker'}));

  function renderProgramSelect(selected='') {
    const select=$('#program-cycle-program');
    select.innerHTML='<option value="">Pilih proker…</option>'+programs.map(program=>`<option value="${escape(program.id)}">${escape(program.name)}${program.division?` · ${escape(program.division)}`:''}</option>`).join('');
    if(selected)select.value=selected;
  }
  function renderReminders() {
    const rows=domain.reminderRows(cyclesWithNames(),milestonesWithNames(),todayWib());
    const list=$('#program-reminder-list');
    if(!rows.length){list.innerHTML='<p class="program-reminder-clear">Tidak ada tenggat dalam tujuh hari ke depan.</p>';return;}
    list.innerHTML=rows.map(row=>`<button class="program-reminder-item ${row.days<0?'is-overdue':row.days===0?'is-today':''}" type="button" data-reminder-cycle="${escape(row.cycle_id)}"><span class="program-reminder-icon" aria-hidden="true">${row.days<0?'!':'◷'}</span><span><strong>${escape(row.title)}</strong><small>${row.days<0?`Terlambat ${Math.abs(row.days)} hari`:row.days===0?'Tenggat hari ini':`${row.days} hari lagi`} · ${dateLabel(row.due_date)}</small></span><span aria-hidden="true">→</span></button>`).join('');
  }
  function renderCycles() {
    const list=$('#program-cycle-list');
    $('#program-cycle-count').textContent=`${cycles.length} siklus`;
    renderReminders();
    if(!cycles.length){list.innerHTML='<p class="records-empty">Belum ada siklus monitoring. Pilih proker, lalu mulai siklus periode ini.</p>';return;}
    list.innerHTML=cyclesWithNames().map(cycle=>{
      const stepRows=milestones.filter(row=>row.cycle_id===cycle.id);
      const progress=domain.progressPercent(stepRows);
      const due=cycle.lpj_due_date?domain.daysUntil(cycle.lpj_due_date,todayWib()):null;
      return `<button type="button" class="program-cycle-card ${currentCycle?.id===cycle.id?'is-selected':''}" data-cycle-id="${escape(cycle.id)}"><span class="program-cycle-card-top"><strong>${escape(cycle.program_name)}</strong><span class="record-status ${statusClass(cycle.status)}">${escape(statusLabel(cycle.status))}</span></span><span class="program-cycle-card-meta">${escape(cycle.period_label)}${cycle.lpj_due_date?` · LPJ ${due<0?`terlambat ${Math.abs(due)} hari`:dateLabel(cycle.lpj_due_date)}`:''}</span><span class="program-cycle-progress-track"><i style="width:${progress}%"></i></span><small>${progress}% · ${stepRows.filter(row=>row.status==='completed').length}/${stepRows.length} tahapan selesai</small></button>`;
    }).join('');
  }
  function renderMilestones() {
    const list=$('#program-milestone-list');
    const rows=milestones.filter(row=>row.cycle_id===currentCycle?.id).sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.position-b.position);
    $('#program-cycle-progress').textContent=`Progres ${domain.progressPercent(rows)}% · ${rows.filter(row=>row.status==='completed').length} dari ${rows.length} tahapan selesai`;
    if(!currentCycle){list.innerHTML='<p class="records-empty">Pilih siklus untuk mengelola tahapan.</p>';return;}
    if(!rows.length){list.innerHTML='<p class="records-empty">Belum ada tahapan. Tambahkan checkpoint dan tenggatnya.</p>';return;}
    const labels={pending:'Belum mulai',in_progress:'Berjalan',completed:'Selesai'};
    const canEdit=!['lpj_review','completed'].includes(currentCycle.status);
    list.innerHTML=rows.map(row=>`<article class="program-milestone-row"><div class="program-milestone-copy"><strong>${escape(row.title)}</strong><small>${dateLabel(row.due_date)} · ${labels[row.status]||row.status}</small>${row.completion_note?`<p>${escape(row.completion_note)}</p>`:''}</div>${canEdit?`<div class="program-milestone-actions"><button type="button" data-milestone-action="edit" data-id="${escape(row.id)}" aria-label="Edit tahapan ${escape(row.title)}">Edit</button><button type="button" data-milestone-action="toggle" data-id="${escape(row.id)}">${row.status==='completed'?'Buka lagi':'Selesaikan'}</button><button type="button" class="is-delete" data-milestone-action="delete" data-id="${escape(row.id)}" aria-label="Hapus tahapan ${escape(row.title)}">Hapus</button></div>`:''}</article>`).join('');
  }
  function renderHistory() {
    const details=$('#program-cycle-history');
    details.hidden=!currentCycle;
    const list=$('#program-cycle-history-list');
    if(!history.length){list.innerHTML='<p class="records-empty">Belum ada riwayat persetujuan.</p>';return;}
    const labels={status_updated:'Status diperbarui',lpj_submitted:'LPJ diajukan',lpj_approved:'LPJ disetujui',lpj_revision_requested:'LPJ perlu revisi'};
    list.innerHTML=history.map(row=>`<article class="program-history-row"><span class="program-history-dot"></span><div><strong>${escape(labels[row.action]||row.action)} · ${escape(statusLabel(row.to_status))}</strong><small>${dateTimeLabel(row.created_at)} · ${escape(row.actor_role)}</small>${row.note?`<p>${escape(row.note)}</p>`:''}</div></article>`).join('');
  }
  function renderRecap() {
    const section=$('#program-cycle-recap');
    section.hidden=!currentCycle;
    const list=$('#program-cycle-recap-list');
    if(!currentCycle)return;
    if(!recap.length){list.innerHTML='<p class="records-empty">Belum ada agenda terbit yang selesai pada periode ini.</p>';return;}
    list.innerHTML=`<div class="program-recap-list">${recap.map(row=>{
      const percent=Number(row.eligible_count)>0?Math.round(Number(row.present_count)*100/Number(row.eligible_count)):0;
      return `<article class="program-recap-row"><div><strong>${escape(row.agenda_title)}</strong><small>${dateTimeLabel(row.starts_at)}</small></div><span>${Number(row.present_count)} hadir</span><small>${Number(row.eligible_count)?`${percent}% dari ${Number(row.eligible_count)} data absensi`:'Belum ada data absensi'}</small></article>`;
    }).join('')}</div>`;
  }
  function renderActions() {
    const node=$('#program-cycle-actions');
    node.hidden=!currentCycle;
    if(!currentCycle){node.innerHTML='';return;}
    const {isLeadership}=context();
    const canSubmit=['ongoing','revision'].includes(currentCycle.status);
    if(currentCycle.status==='lpj_review'&&isLeadership){
      node.innerHTML='<label for="program-cycle-review-note">Catatan peninjauan (wajib jika meminta revisi)</label><textarea id="program-cycle-review-note" rows="2" maxlength="2000" placeholder="Catatan untuk pengurus proker"></textarea><div class="program-review-buttons"><button type="button" class="member-option-button" data-cycle-review="revision_requested">Minta revisi</button><button type="button" class="admin-button" data-cycle-review="approved">Setujui LPJ <span aria-hidden="true">✓</span></button></div>';
    } else if(canSubmit){
      node.innerHTML='<button type="button" class="member-option-button" data-cycle-submit>Ajukan LPJ untuk ditinjau</button>';
    } else node.innerHTML='';
    const save=$('#save-program-cycle');
    save.disabled=['lpj_review','completed'].includes(currentCycle.status);
    save.title=save.disabled?'Data dikunci selama peninjauan atau setelah LPJ disetujui.':'';
  }
  function renderSelectedCycle() {
    const form=$('#program-cycle-form');
    downloadButton.hidden=!currentCycle;
    if(!currentCycle){
      form.querySelectorAll('input,textarea,select').forEach(input=>input.disabled=false);
      $('#program-cycle-status').innerHTML='<option value="planning">Rencana</option><option value="ongoing">Berjalan</option>';
      form.reset();$('#program-cycle-id').value='';$('#program-cycle-period').value=currentPeriod();$('#program-cycle-status').value='planning';
      $('#program-cycle-editor-title').textContent='Mulai monitoring proker';
      $('#program-cycle-program').disabled=false;$('#program-cycle-period').readOnly=false;
      $('#program-cycle-status').disabled=false;$('#program-cycle-status').value='planning';
      $('#program-milestone-form').hidden=true;$('#program-cycle-actions').hidden=true;
      $('#program-cycle-recap').hidden=true;$('#program-cycle-history').hidden=true;
      $('#program-milestone-list').innerHTML='<p class="records-empty">Pilih siklus untuk mengelola tahapan.</p>';
      $('#program-cycle-progress').textContent='Progres 0% · 0 dari 0 tahapan selesai';
      $('#save-program-cycle').disabled=false;showMessage('');return;
    }
    $('#program-cycle-id').value=currentCycle.id;
    $('#program-cycle-program').value=currentCycle.program_id;
    $('#program-cycle-period').value=currentCycle.period_label;
    $('#program-cycle-start').value=dateField(currentCycle.period_start);
    $('#program-cycle-end').value=dateField(currentCycle.period_end);
    $('#program-cycle-deadline').value=dateField(currentCycle.lpj_due_date);
    $('#program-cycle-akunpro').value=currentCycle.akunpro_url||'';
    $('#program-cycle-summary').value=currentCycle.lpj_summary||'';
    $('#program-cycle-outputs').value=currentCycle.output_summary||'';
    $('#program-cycle-lessons').value=currentCycle.lesson_learned||'';
    const statusSelect=$('#program-cycle-status');
    if(['planning','ongoing'].includes(currentCycle.status)){
      statusSelect.innerHTML='<option value="planning">Rencana</option><option value="ongoing">Berjalan</option>';
      statusSelect.value=currentCycle.status;
    }else{
      statusSelect.innerHTML=`<option value="${escape(currentCycle.status)}">${escape(statusLabel(currentCycle.status))}</option>`;
      statusSelect.value=currentCycle.status;
    }
    const locked=['lpj_review','completed'].includes(currentCycle.status);
    statusSelect.disabled=!['planning','ongoing'].includes(currentCycle.status);
    $('#program-cycle-form').querySelectorAll('input:not([type="hidden"]),textarea').forEach(input=>input.disabled=locked);
    $('#program-cycle-program').disabled=true;$('#program-cycle-period').readOnly=true;
    $('#program-cycle-program').disabled=true;$('#program-cycle-period').readOnly=true;
    $('#program-cycle-editor-title').textContent=`${programFor(currentCycle.program_id)?.name||'Proker'} · ${currentCycle.period_label}`;
    $('#program-milestone-form').hidden=locked;
    $('#program-cycle-actions').hidden=false;
    renderActions();renderMilestones();renderRecap();renderHistory();
    showMessage('');
  }
  async function refreshCycleDetails() {
    if(!currentCycle){milestones=[];history=[];recap=[];renderSelectedCycle();return;}
    const cycleId=encodeURIComponent(currentCycle.id);
    const [milestoneRows,historyRows,recapRows]=await Promise.all([
      api()(`cssmora_program_milestones?select=*&cycle_id=eq.${cycleId}&order=due_date.asc,position.asc`),
      api()(`cssmora_program_cycle_history?select=*&cycle_id=eq.${cycleId}&order=created_at.desc&limit=50`),
      api()(`rpc/get_cssmora_program_cycle_attendance`,{method:'POST',body:{p_cycle_id:currentCycle.id}})
    ]);
    milestones=[...milestones.filter(row=>row.cycle_id!==currentCycle.id),...(milestoneRows||[])];
    history=historyRows||[];recap=recapRows||[];
    renderCycles();renderSelectedCycle();
  }
  async function load({selectedId=currentCycle?.id}={}) {
    if(!$('#program-workflow-panel'))return;
    if(!context().canManageProgramCycles){$('#program-cycle-list').innerHTML='<p class="records-empty">Akses pengelolaan proker diperlukan.</p>';return;}
    if(pendingLoad)return pendingLoad;
    pendingLoad=(async()=>{
      $('#program-cycle-list').setAttribute('aria-busy','true');
      if(!cycles.length)$('#program-cycle-list').innerHTML='<p class="records-empty">Memuat siklus proker…</p>';
      try{
        const [programRows,cycleRows,detailRows]=await Promise.all([
          api()('agenda_programs?select=id,name,division,is_active&order=name.asc'),
          api()('cssmora_program_cycles?select=*&order=updated_at.desc'),
          api()('cssmora_program_details?select=program_id,period_label&order=updated_at.desc')
        ]);
        programs=programRows||[];cycles=cycleRows||[];
        programPeriods=new Map();for(const row of detailRows||[])if(row.period_label&&!programPeriods.has(row.program_id))programPeriods.set(row.program_id,row.period_label);
        renderProgramSelect(currentCycle?.program_id||'');
        const cycleIds=cycles.map(row=>row.id);
        milestones=cycleIds.length?await api()(`cssmora_program_milestones?select=*&cycle_id=in.(${cycleIds.map(encodeURIComponent).join(',')})&order=due_date.asc,position.asc`):[];
        currentCycle=cycles.find(row=>row.id===selectedId)||null;
        renderCycles();renderSelectedCycle();
        if(currentCycle)await refreshCycleDetails();
        else {history=[];recap=[];renderReminders();}
        $('#program-cycle-period').placeholder=programPeriods.get($('#program-cycle-program').value)||currentPeriod();
      }catch(error){
        $('#program-cycle-list').innerHTML=`<p class="records-empty">${escape(error.message||'Data monitoring belum dapat dimuat.')}</p>`;
        showMessage(error.message||'Data monitoring belum dapat dimuat.','error');
      }finally{$('#program-cycle-list').removeAttribute('aria-busy');pendingLoad=null;}
    })();
    return pendingLoad;
  }
  function selectCycle(id) {
    currentCycle=cycles.find(row=>row.id===id)||null;
    history=[];recap=[];$('#program-milestone-form').reset();$('#program-milestone-id').value='';$('#save-program-milestone').textContent='Tambah tahapan';
    renderCycles();renderSelectedCycle();
    void refreshCycleDetails().catch(error=>showMessage(error.message,'error'));
  }
  function clearCycleForm() {
    currentCycle=null;history=[];recap=[];$('#program-cycle-form').reset();$('#program-cycle-program').disabled=false;$('#program-cycle-period').readOnly=false;$('#program-milestone-form').reset();$('#program-milestone-id').value='';
    renderCycles();renderSelectedCycle();
  }
  function cyclePayload() {
    const f=$('#program-cycle-form');
    const payload={period_start:f.elements.period_start.value||null,period_end:f.elements.period_end.value||null,
      lpj_due_date:f.elements.lpj_due_date.value||null,akunpro_url:f.elements.akunpro_url.value.trim()||null,
      lpj_summary:f.elements.lpj_summary.value.trim(),output_summary:f.elements.output_summary.value.trim(),lesson_learned:f.elements.lesson_learned.value.trim()};
    if(!currentCycle){payload.program_id=f.elements.program_id.value;payload.period_label=f.elements.period_label.value.trim();payload.status=f.elements.status.value;}
    else if(['planning','ongoing'].includes(currentCycle.status))payload.status=f.elements.status.value;
    if(payload.akunpro_url){let parsed;try{parsed=new URL(payload.akunpro_url);}catch{throw new Error('Tautan AkunPro tidak valid.');}if(parsed.protocol!=='https:')throw new Error('Tautan AkunPro harus menggunakan HTTPS.');}
    if(payload.period_start&&payload.period_end&&payload.period_end<payload.period_start)throw new Error('Akhir periode harus setelah tanggal mulai.');
    return payload;
  }
  $('#program-cycle-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('#save-program-cycle');if(!event.currentTarget.reportValidity())return;
    button.disabled=true;showMessage('Menyimpan monitoring…');
    try{
      const payload=cyclePayload();
      const rows=currentCycle?await api()(`cssmora_program_cycles?id=eq.${encodeURIComponent(currentCycle.id)}`,{method:'PATCH',body:payload,extraHeaders:{Prefer:'return=representation'}}):await api()('cssmora_program_cycles',{method:'POST',body:payload,extraHeaders:{Prefer:'return=representation'}});
      const saved=Array.isArray(rows)?rows[0]:rows;if(!saved?.id)throw new Error('Siklus belum tersimpan.');
      showMessage('Monitoring proker tersimpan.','success');await load({selectedId:saved.id});
    }catch(error){showMessage(error.message||'Siklus belum tersimpan.','error');}
    finally{button.disabled=false;renderActions();}
  });
  $('#program-cycle-program').addEventListener('change',()=>{
    const detailsPeriod=programPeriods.get($('#program-cycle-program').value);
    if(detailsPeriod)$('#program-cycle-period').value=detailsPeriod;
  });
  $('#program-cycle-reset').addEventListener('click',clearCycleForm);
  $('#program-workflow-refresh').addEventListener('click',()=>void load());
  $('#program-cycle-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-cycle-id]');if(button)selectCycle(button.dataset.cycleId);
  });
  $('#program-reminder-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-reminder-cycle]');if(button)selectCycle(button.dataset.reminderCycle);
  });
  $('#program-cycle-recap-refresh').addEventListener('click',()=>void refreshCycleDetails().catch(error=>showMessage(error.message,'error')));
  $('#program-milestone-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!currentCycle||!event.currentTarget.reportValidity())return;
    const f=event.currentTarget,body={title:f.elements.title.value.trim(),due_date:f.elements.due_date.value,status:f.elements.status.value,completion_note:f.elements.completion_note.value.trim()};
    const id=f.elements.id.value;const button=$('#save-program-milestone');button.disabled=true;
    try{
      if(id)await api()(`cssmora_program_milestones?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body,extraHeaders:{Prefer:'return=representation'}});
      else await api()('cssmora_program_milestones',{method:'POST',body:{...body,cycle_id:currentCycle.id,position:milestones.filter(row=>row.cycle_id===currentCycle.id).length},extraHeaders:{Prefer:'return=representation'}});
      f.reset();$('#program-milestone-id').value='';$('#save-program-milestone').textContent='Tambah tahapan';
      await load({selectedId:currentCycle.id});showMessage('Tahapan tersimpan.','success');
    }catch(error){showMessage(error.message||'Tahapan belum tersimpan.','error');}
    finally{button.disabled=false;}
  });
  $('#program-milestone-list').addEventListener('click',async event=>{
    const button=event.target.closest('[data-milestone-action]');if(!button)return;
    const row=milestones.find(item=>item.id===button.dataset.id);if(!row)return;
    const action=button.dataset.milestoneAction;
    if(action==='edit'){
      const f=$('#program-milestone-form');f.hidden=false;f.elements.id.value=row.id;f.elements.title.value=row.title;f.elements.due_date.value=dateField(row.due_date);f.elements.status.value=row.status;f.elements.completion_note.value=row.completion_note||'';$('#save-program-milestone').textContent='Simpan tahapan';f.elements.title.focus();return;
    }
    if(action==='delete'&&!window.confirm(`Hapus tahapan “${row.title}”?`))return;
    button.disabled=true;
    try{
      if(action==='delete')await api()(`cssmora_program_milestones?id=eq.${encodeURIComponent(row.id)}`,{method:'DELETE'});
      else await api()(`cssmora_program_milestones?id=eq.${encodeURIComponent(row.id)}`,{method:'PATCH',body:{status:row.status==='completed'?'pending':'completed'},extraHeaders:{Prefer:'return=representation'}});
      await load({selectedId:currentCycle?.id});
    }catch(error){showMessage(error.message||'Perubahan tahapan gagal.','error');button.disabled=false;}
  });
  $('#program-cycle-actions').addEventListener('click',async event=>{
    const submit=event.target.closest('[data-cycle-submit]');
    const review=event.target.closest('[data-cycle-review]');
    if(submit){
      if($('#program-cycle-summary').value.trim().length<30){showMessage('Lengkapi ringkasan LPJ minimal 30 karakter sebelum mengajukan.','error');return;}
      submit.disabled=true;
      try{await api()(`cssmora_program_cycles?id=eq.${encodeURIComponent(currentCycle.id)}`,{method:'PATCH',body:{status:'lpj_review'},extraHeaders:{Prefer:'return=representation'}});showMessage('LPJ dikirim untuk ditinjau Ketua atau Wakil.','success');await load({selectedId:currentCycle.id});}
      catch(error){showMessage(error.message||'LPJ belum dapat diajukan.','error');submit.disabled=false;}
      return;
    }
    if(review){
      const decision=review.dataset.cycleReview,note=$('#program-cycle-review-note')?.value.trim()||'';
      if(decision==='revision_requested'&&!note){showMessage('Isi catatan sebelum meminta revisi.','error');return;}
      review.disabled=true;
      try{await api()('rpc/review_cssmora_program_lpj',{method:'POST',body:{p_cycle_id:currentCycle.id,p_decision:decision,p_note:note||null}});showMessage(decision==='approved'?'LPJ disetujui dan siklus ditandai selesai.':'LPJ dikembalikan untuk revisi.','success');await load({selectedId:currentCycle.id});}
      catch(error){showMessage(error.message||'Peninjauan LPJ gagal.','error');review.disabled=false;}
    }
  });
  function downloadLpj() {
    if(!currentCycle)return;
    const program=programFor(currentCycle.program_id)||{};
    const milestoneRows=milestones.filter(row=>row.cycle_id===currentCycle.id);
    const agendaRows=recap;
    const safe=value=>escape(value||'—');
    const rowHtml=(title,body)=>`<section><h2>${safe(title)}</h2><p>${safe(body)}</p></section>`;
    const html=`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LPJ ${safe(program.name)} ${safe(currentCycle.period_label)}</title><style>body{max-width:850px;margin:40px auto;padding:0 24px;color:#183328;font:15px/1.65 Arial,sans-serif}h1{font-size:28px}h2{font-size:18px;margin-bottom:5px}header{padding-bottom:18px;border-bottom:2px solid #1c6b43}small{color:#597467}.tag{display:inline-block;padding:4px 9px;border-radius:30px;background:#e9f3e8;color:#28563b}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{padding:9px;border-bottom:1px solid #dce8de;text-align:left}footer{margin-top:32px;color:#597467;font-size:12px}@media print{body{margin:0 auto;padding:0 12mm}}</style><body><header><small>CSSMoRA UNAIR · REKAP PELAKSANAAN PROKER</small><h1>${safe(program.name)}</h1><p>${safe(program.division||'')} · Periode ${safe(currentCycle.period_label)} · <span class="tag">${safe(statusLabel(currentCycle.status))}</span></p></header>${rowHtml('Ringkasan pelaksanaan',currentCycle.lpj_summary)}${rowHtml('Luaran dan capaian',currentCycle.output_summary)}${rowHtml('Evaluasi dan tindak lanjut',currentCycle.lesson_learned)}<section><h2>Tahapan kerja</h2>${milestoneRows.length?`<table><thead><tr><th>Tahapan</th><th>Tenggat</th><th>Status</th><th>Catatan</th></tr></thead><tbody>${milestoneRows.map(row=>`<tr><td>${safe(row.title)}</td><td>${safe(dateLabel(row.due_date))}</td><td>${safe(row.status==='completed'?'Selesai':row.status==='in_progress'?'Berjalan':'Belum mulai')}</td><td>${safe(row.completion_note)}</td></tr>`).join('')}</tbody></table>`:'<p>Belum ada checkpoint.</p>'}</section><section><h2>Agenda dan absensi</h2>${agendaRows.length?`<table><thead><tr><th>Kegiatan</th><th>Waktu</th><th>Hadir</th><th>Persentase</th></tr></thead><tbody>${agendaRows.map(row=>{const total=Number(row.eligible_count)||0,present=Number(row.present_count)||0;return `<tr><td>${safe(row.agenda_title)}</td><td>${safe(dateTimeLabel(row.starts_at))}</td><td>${present}/${total}</td><td>${total?Math.round(present*100/total):0}%</td></tr>`;}).join('')}</tbody></table>`:'<p>Belum ada agenda selesai yang terhubung pada periode ini.</p>'}</section>${currentCycle.akunpro_url?`<section><h2>Referensi anggaran</h2><p><a href="${safe(currentCycle.akunpro_url)}">Buka AkunPro</a></p></section>`:''}<footer>Disusun dari data monitoring CSSMoRA. Angka keuangan dirujuk di AkunPro dan tidak disalin ke sistem ini.<br>Diekspor ${safe(dateTimeLabel(new Date().toISOString()))}.</footer></body></html>`;
    const blob=new Blob([html],{type:'text/html;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`LPJ-${String(program.name||'proker').replace(/[^a-z0-9-]+/gi,'-')}-${currentCycle.period_label.replace(/[^a-z0-9-]+/gi,'-')}.html`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  downloadButton.addEventListener('click',downloadLpj);
  window.CSSMoRAProgramWorkflow={load};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&$('#program-workflow-panel')&&!$('#program-workflow-panel').hidden)void load();});
})();
