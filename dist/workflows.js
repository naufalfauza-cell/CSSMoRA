(()=>{
  const $=selector=>document.querySelector(selector);
  const config=window.CSSMORA_SUPABASE;
  const domain=window.CSSMoRADomain;
  const escape=window.CSSMORA_ESCAPE||((value)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])));
  const money=value=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value)||0);
  const dateLabel=value=>value?new Date(`${value}T00:00:00+07:00`).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Jakarta'}):'—';
  const divisions={BPH:'BPH',PSDM:'PSDM',P3M:'P3M',ADVO:'Advokasi',MEDINFO:'Medinfo'};
  let budgets=[];
  let transactions=[];
  let accounts=[];
  let records=[];
  let participants=[];
  let recordFilter='pending';

  async function requestAkunPro(payload){
    if(!window.CSSMORA_SUPABASE?.url||!window.CSSMORA_SUPABASE?.publishableKey)throw new Error('Konfigurasi Supabase CSSMoRA tidak tersedia.');
    const response=await authenticatedFetch(`${config.url}/functions/v1/akunpro-integration`,{
      method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify(payload)
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(result.error||'Koneksi AkunPro belum siap.');error.status=response.status;throw error;}
    return result;
  }
  function setConnection(message,kind=''){
    const node=$('#finance-integration-status');if(!node)return;
    node.dataset.state=kind;node.innerHTML=`<span class="finance-connection-dot" aria-hidden="true"></span><span>${escape(message)}</span>`;
  }
  function accountCodeControl(side,values,placeholder){
    const select=$(`#finance-${side}-account`),manual=$(`#finance-${side}-account-manual`);
    const old=select.value||manual.value||'';
    const options=values.map(account=>`<option value="${escape(account.code)}">${escape(account.code)} · ${escape(account.name)}</option>`).join('');
    if(values.length){
      select.innerHTML=`<option value="">Pilih akun…</option>${options}`;select.hidden=false;select.required=true;
      manual.hidden=true;manual.required=false;select.value=values.some(a=>a.code===old)?old:'';
    }else{
      select.innerHTML='<option value="">Masukkan kode akun manual</option>';select.hidden=true;select.required=false;
      manual.hidden=false;manual.required=true;manual.placeholder=placeholder;manual.value=old;
    }
  }
  function renderFinanceAccounts(){
    const direction=$('#finance-direction')?.value||'expense';
    const cash=accounts.filter(row=>row.category==='Aset');
    const category=accounts.filter(row=>row.category===(direction==='income'?'Pendapatan':'Beban'));
    accountCodeControl('cash',cash,'Kode akun aset kas / bank AkunPro');
    accountCodeControl('category',category,`Kode akun ${direction==='income'?'pendapatan':'beban'} AkunPro`);
    if(!accounts.length)setConnection('AkunPro belum terhubung. Transaksi tetap tersimpan di antrean; isi kode akun yang benar untuk sinkronisasi.','pending');
  }
  function renderFinance(){
    const totalIncome=transactions.filter(row=>row.direction==='income').reduce((sum,row)=>sum+Number(row.amount||0),0);
    const totalExpense=transactions.filter(row=>row.direction==='expense').reduce((sum,row)=>sum+Number(row.amount||0),0);
    $('#finance-total-income').textContent=money(totalIncome);
    $('#finance-total-expense').textContent=money(totalExpense);
    $('#finance-net-balance').textContent=money(totalIncome-totalExpense);
    const pending=transactions.filter(row=>row.sync_status!=='synced').length;
    $('#finance-pending-count').textContent=String(pending);
    $('#finance-budget-count').textContent=`${budgets.length} pos`;
    $('#finance-transaction-count').textContent=`${transactions.length} transaksi`;
    const budgetSelect=$('#finance-budget-link');
    const previous=budgetSelect.value;
    budgetSelect.innerHTML='<option value="">Tanpa pos anggaran</option>'+budgets.map(row=>`<option value="${escape(row.id)}">${escape(row.fiscal_year)} · ${escape(divisions[row.division]||row.division)} · ${escape(row.budget_label)}</option>`).join('');
    if(budgets.some(row=>row.id===previous))budgetSelect.value=previous;
    const budgetBody=$('#finance-budget-list');
    budgetBody.innerHTML=budgets.length?budgets.map(row=>{
      const comparison=domain.budgetComparison(row.planned_amount,row.forecast_amount,transactions,row.id);
      const actual=comparison.actual,delta=comparison.variance;
      return `<tr><td>${escape(row.fiscal_year)}<small>${escape(divisions[row.division]||row.division)}</small></td><td><strong>${escape(row.budget_label)}</strong>${row.note?`<small>${escape(row.note)}</small>`:''}</td><td>${money(row.planned_amount)}</td><td>${money(row.forecast_amount)}</td><td>${money(actual)}</td><td class="${delta>0?'is-over-budget':'is-within-budget'}">${delta>0?'+':''}${money(delta)}</td><td><div class="workflow-row-actions"><button type="button" data-budget-action="edit" data-id="${escape(row.id)}">Edit</button><button type="button" data-budget-action="delete" data-id="${escape(row.id)}" aria-label="Hapus anggaran ${escape(row.budget_label)}">Hapus</button></div></td></tr>`;
    }).join(''):'<tr><td colspan="7" class="records-empty">Belum ada anggaran.</td></tr>';
    const txBody=$('#finance-transaction-list');
    txBody.innerHTML=transactions.length?transactions.map(row=>{
      const syncLabel=row.sync_status==='synced'?'TERKIRIM':row.sync_status==='syncing'?'SEDANG DIKIRIM':'ANTREAN';
      const action=row.sync_status==='synced'?`<small>${escape(row.akunpro_transaction_id||'AkunPro')}</small>`:`<button type="button" data-transaction-action="sync" data-id="${escape(row.id)}">${row.sync_status==='syncing'?'Cek status':'Kirim'}</button>${row.sync_status==='pending'?`<button type="button" data-transaction-action="edit" data-id="${escape(row.id)}">Edit</button>`:''}`;
      return `<tr><td>${dateLabel(row.transaction_date)}</td><td><strong>${escape(row.reference)}</strong><small>${escape(row.description)}</small>${row.last_sync_error?`<small class="finance-sync-error">${escape(row.last_sync_error)}</small>`:''}</td><td><span class="finance-direction-pill ${row.direction}">${row.direction==='income'?'Masuk':'Keluar'}</span></td><td>${money(row.amount)}</td><td><span class="record-status ${row.sync_status==='synced'?'published':row.sync_status==='syncing'?'finance-syncing':''}">${syncLabel}</span></td><td><div class="workflow-row-actions">${action}</div></td></tr>`;
    }).join(''):'<tr><td colspan="6" class="records-empty">Belum ada transaksi.</td></tr>';
  }
  async function loadFinanceDashboard(){
    const status=$('#finance-integration-status');if(!status)return;
    setConnection('Memuat buku kas dan koneksi AkunPro…');
    try{
      const [budgetRows,transactionRows]=await Promise.all([
        api('cssmora_finance_budgets?select=*&order=fiscal_year.desc,division.asc,budget_label.asc'),
        api('cssmora_finance_transactions?select=*&order=transaction_date.desc,created_at.desc')
      ]);
      budgets=budgetRows||[];transactions=transactionRows||[];
      try{
        const result=await requestAkunPro({action:'accounts'});
        accounts=Array.isArray(result.accounts)?result.accounts:[];
        setConnection(`Terhubung ke AkunPro · ${accounts.length} akun tersedia`,'connected');
      }catch(error){accounts=[];setConnection(error.message||'Integrasi AkunPro menunggu konfigurasi.','pending');}
      renderFinanceAccounts();renderFinance();
      if(accounts.length)setConnection(`Terhubung ke AkunPro · ${accounts.length} akun tersedia`,'connected');
    }catch(error){setConnection('Data keuangan belum dapat dimuat.','error');showMessage('#finance-message',error.message,'error');}
  }
  async function syncFinanceTransaction(id){
    const result=await requestAkunPro({action:'sync',transaction_id:id});
    if(result.busy){showMessage('#finance-message','Transaksi sedang dikirim. Muat ulang sebentar lagi untuk melihat hasilnya.','');await loadFinanceDashboard();return;}
    showMessage('#finance-message',result.duplicate?'Transaksi sudah tercatat di AkunPro.':'Transaksi berhasil dikirim ke AkunPro.','success');
    await loadFinanceDashboard();
  }
  $('#finance-refresh')?.addEventListener('click',()=>void loadFinanceDashboard());
  $('#finance-direction')?.addEventListener('change',renderFinanceAccounts);
  $('#finance-budget-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=$('#save-finance-budget'),id=$('#budget-record-id').value;
    if(!form.reportValidity())return;
    button.disabled=true;
    const body={fiscal_year:Number(form.elements.fiscal_year.value),division:form.elements.division.value,budget_label:form.elements.budget_label.value.trim(),
      planned_amount:Number(form.elements.planned_amount.value),forecast_amount:Number(form.elements.forecast_amount.value),note:form.elements.note.value.trim()};
    try{
      if(id)await api(`cssmora_finance_budgets?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body});
      else await api('cssmora_finance_budgets',{method:'POST',body,extraHeaders:{Prefer:'return=representation'}});
      form.reset();$('#budget-record-id').value='';$('#save-finance-budget').innerHTML='Simpan anggaran <span aria-hidden="true">↗</span>';
      await loadFinanceDashboard();showMessage('#finance-message','Anggaran dan prognosa tersimpan.','success');
    }catch(error){showMessage('#finance-message',error.message,'error');}finally{button.disabled=false;}
  });
  $('#finance-budget-list')?.addEventListener('click',async event=>{
    const button=event.target.closest('[data-budget-action]');if(!button)return;
    const row=budgets.find(item=>item.id===button.dataset.id);if(!row)return;
    if(button.dataset.budgetAction==='edit'){
      const form=$('#finance-budget-form');$('#budget-record-id').value=row.id;
      form.elements.fiscal_year.value=row.fiscal_year;form.elements.division.value=row.division;form.elements.budget_label.value=row.budget_label;
      form.elements.planned_amount.value=row.planned_amount;form.elements.forecast_amount.value=row.forecast_amount;form.elements.note.value=row.note||'';
      $('#save-finance-budget').innerHTML='Simpan perubahan <span aria-hidden="true">↗</span>';form.scrollIntoView({behavior:'smooth',block:'center'});return;
    }
    if(!window.confirm(`Hapus pos anggaran “${row.budget_label}”? Transaksi terkait akan tetap tersimpan tanpa tautan pos.`))return;
    button.disabled=true;try{await api(`cssmora_finance_budgets?id=eq.${encodeURIComponent(row.id)}`,{method:'DELETE'});await loadFinanceDashboard();showMessage('#finance-message','Pos anggaran dihapus.','success');}catch(error){showMessage('#finance-message',error.message,'error');button.disabled=false;}
  });
  $('#finance-entry-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=$('#save-finance-entry');if(!form.reportValidity())return;
    const id=$('#finance-transaction-id').value,direction=form.elements.direction.value;
    const cashCode=$('#finance-cash-account').hidden?$('#finance-cash-account-manual').value.trim():$('#finance-cash-account').value;
    const categoryCode=$('#finance-category-account').hidden?$('#finance-category-account-manual').value.trim():$('#finance-category-account').value;
    try{domain.createJournal(direction,Number(form.elements.amount.value),cashCode,categoryCode);}catch(error){showMessage('#finance-message',error.message,'error');return;}
    const body={transaction_date:form.elements.transaction_date.value,reference:form.elements.reference.value.trim(),description:form.elements.description.value.trim(),direction,
      amount:Number(form.elements.amount.value),cash_account_code:cashCode,category_account_code:categoryCode,budget_id:form.elements.budget_id.value||null};
    button.disabled=true;
    try{
      let transactionId=id;
      if(id){await api(`cssmora_finance_transactions?id=eq.${encodeURIComponent(id)}&sync_status=eq.pending`,{method:'PATCH',body});}
      else {const inserted=await api('cssmora_finance_transactions',{method:'POST',body,extraHeaders:{Prefer:'return=representation'}});transactionId=inserted?.[0]?.id;if(!transactionId)throw new Error('Transaksi belum tersimpan.');}
      form.reset();$('#finance-transaction-id').value='';$('#finance-date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date());
      $('#save-finance-entry').innerHTML='Simpan transaksi <span aria-hidden="true">↗</span>';
      await loadFinanceDashboard();
    try{await syncFinanceTransaction(transactionId);}catch(error){showMessage('#finance-message',`Transaksi tersimpan dan menunggu koneksi AkunPro: ${error.message}`,'');await loadFinanceDashboard();}
    }catch(error){showMessage('#finance-message',error.message,'error');}finally{button.disabled=false;}
  });
  $('#finance-transaction-list')?.addEventListener('click',async event=>{
    const button=event.target.closest('[data-transaction-action]');if(!button)return;
    const row=transactions.find(item=>item.id===button.dataset.id);if(!row)return;
    if(button.dataset.transactionAction==='edit'){
      const form=$('#finance-entry-form');$('#finance-transaction-id').value=row.id;form.elements.transaction_date.value=row.transaction_date;
      form.elements.reference.value=row.reference;form.elements.description.value=row.description;form.elements.direction.value=row.direction;form.elements.amount.value=row.amount;form.elements.budget_id.value=row.budget_id||'';
      renderFinanceAccounts();
      if($('#finance-cash-account').hidden)$('#finance-cash-account-manual').value=row.cash_account_code;else $('#finance-cash-account').value=row.cash_account_code;
      if($('#finance-category-account').hidden)$('#finance-category-account-manual').value=row.category_account_code;else $('#finance-category-account').value=row.category_account_code;
      $('#save-finance-entry').innerHTML='Simpan perubahan <span aria-hidden="true">↗</span>';form.scrollIntoView({behavior:'smooth',block:'center'});return;
    }
    button.disabled=true;try{await syncFinanceTransaction(row.id);}catch(error){showMessage('#finance-message',error.message,'error');await loadFinanceDashboard();button.disabled=false;}
  });

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
  window.CSSMoRAWorkflows={loadFinanceDashboard,loadAchievementRecords};
  $('#finance-budget-form')?.addEventListener('reset',()=>setTimeout(()=>{$('#budget-record-id').value='';$('#save-finance-budget').innerHTML='Simpan anggaran <span aria-hidden="true">↗</span>';},0));
  $('#finance-entry-form')?.addEventListener('reset',()=>setTimeout(()=>{$('#finance-transaction-id').value='';$('#save-finance-entry').innerHTML='Simpan transaksi <span aria-hidden="true">↗</span>';},0));
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
  if($('#finance-date'))$('#finance-date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date());
  if($('#public-achievement-date'))$('#public-achievement-date').max=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date());
  if($('#budget-year'))$('#budget-year').value=String(new Date().getFullYear());
})();
