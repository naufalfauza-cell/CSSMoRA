(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const api = () => window.CSSMoRAAdmin?.api;
  const context = () => window.CSSMoRAAdmin?.context?.() || {};
  const cfg = () => window.CSSMORA_SUPABASE || {};
  const money = value => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value)||0);
  const typeLabels={proposal:'Proposal',lpj:'LPJ'};
  const statusLabels={draft:'Draf',secretary_review:'Menunggu tanda tangan Sekretaris',treasurer_review:'Verifikasi Bendahara',chair_review:'Menunggu tanda tangan Ketua',revision:'Perlu revisi',approved:'Disetujui'};
  const activeBucket='cssmora-program-documentation';
  let programs=[],details=new Map(),members=[],documents=[],current=null,budget=[],committee=[],rundown=[],photos=[],pendingPhotos=[],finance={},subrecordsDirty=false;
  let loading=null;
  const committeeRoles=['Ketua Pelaksana','Wakil Ketua Pelaksana','Sekretaris Pelaksana','Bendahara Pelaksana','Koordinator Acara','Staf Acara','Staf Humas','Staf Publikasi dan Dokumentasi','Staf Konsumsi','Staf Perlengkapan','Staf Transportasi','Staf Keamanan','Anggota'];
  const committeeDivisions=[['BPH','BPH'],['PSDM','PSDM'],['P3M','P3M'],['ADVO','Advokasi'],['MEDINFO','Medinfo'],['SEKRETARIAT','Sekretariat'],['BENDAHARA','Bendahara'],['LAINNYA','Lainnya']];
  const budgetCategories={income:['Dana CSSMoRA','Sponsor','Tiket peserta','Iuran peserta','Donasi','Umum','Lainnya'],expense:['Konsumsi','Perlengkapan','Publikasi','Transportasi','Akomodasi','Honorarium','Sewa tempat','Operasional','Umum','Lainnya']};

  function message(text,kind='') { const node=$('#program-document-message');node.textContent=text;node.dataset.kind=kind; }
  function financeReviewer(){const roles=context().roles||[];return roles.includes('bendahara')||roles.includes('ketua')||roles.includes('wakil');}
  function mayReview(stage){const roles=context().roles||[];return stage==='sekretaris'?roles.includes('sekretaris'):stage==='bendahara'?roles.includes('bendahara'):roles.includes('ketua')||roles.includes('wakil');}
  function isEditable(){return !current||(['draft','revision'].includes(current.status)&&current.created_by===context().userId);}
  function setSelectOptions(select,rows,label,selected=''){
    select.innerHTML='<option value="">Pilih…</option>'+rows.map(row=>`<option value="${esc(row.id)}">${esc(label(row))}</option>`).join('');
    if(selected)select.value=selected;
  }
  function selectedType(){return $('#program-document-type').value||'proposal';}
  function selectedSections(){const out={};document.querySelectorAll(`.program-document-options [data-option-for="${selectedType()}"] input`).forEach(node=>out[node.name]=node.checked);return out;}
  function renderType(){
    const type=selectedType();
    document.querySelectorAll('.program-document-fields').forEach(section=>{
      const active=section.dataset.documentType===type;section.hidden=!active;
      section.querySelectorAll('input,textarea,select').forEach(field=>field.disabled=!active);
    });
    document.querySelectorAll('.program-document-options [data-option-for]').forEach(row=>row.hidden=row.dataset.optionFor!==type);
    document.querySelectorAll('.program-document-options [data-option-for] input').forEach(input=>input.disabled=input.closest('[data-option-for]').dataset.optionFor!==type);
    const options=selectedSections();
    $('#program-document-committee-section').hidden=!options.committee;
    $('#program-document-rundown-section').hidden=type!=='proposal'||!options.rundown_section;
    $('#program-document-budget-section').hidden=type!=='proposal'||!options.rab;
    const financeOn=type==='lpj'&&options.finance;
    $('#program-document-finance-section').hidden=!financeOn;
    $('#program-document-photos-section').hidden=type!=='lpj'||!options.documentation;
    $('#lpj-administration-field').hidden=type!=='lpj'||!options.administration;
    $('#lpj-administration').disabled=type!=='lpj'||!options.administration||!isEditable();
    $('#program-document-finance-message').textContent=financeOn&&current?.status==='secretary_review'?'Bendahara memeriksa bagian ini sebelum Sekretaris menandatangani. Setelah disimpan, perbarui Google Docs.':'';
    const mayEnterFinance=Boolean(current&&context().roles?.includes('bendahara')&&current.document_type==='lpj'&&current.optional_sections?.finance&&['secretary_review','treasurer_review'].includes(current.status));
    ['lpj-income','lpj-expense','lpj-akunpro','lpj-finance-note'].forEach(id=>{const field=$('#'+id);field.disabled=!financeOn||!mayEnterFinance;});
    $('#program-document-required-note').textContent=type==='proposal'
      ?'Wajib: proker, periode, deskripsi, tujuan, dan sasaran. Bagian kepanitiaan, rundown, dan RAB dapat dimatikan jika tidak dipakai.'
      :'Wajib: proker, periode, ringkasan pelaksanaan, dan dokumen Google Docs. Angka kehadiran dan keuangan harus mengikuti sumber data; AI tidak mengarang fakta.';
    renderActions();
  }
  function renderCommittee(){
    const list=$('#program-document-committee-list');
    if(!committee.length){list.innerHTML='<p class="records-empty">Belum ada anggota panitia dipilih.</p>';return;}
    list.innerHTML=`<div class="program-document-table-wrap"><table class="program-document-entry-table"><thead><tr><th>No.</th><th>Nama anggota</th><th>Jabatan / seksi</th><th>Divisi</th><th></th></tr></thead><tbody>${committee.map((row,index)=>{
      const selectedElsewhere=new Set(committee.filter((item,itemIndex)=>itemIndex!==index).map(item=>item.member_id));
      return `<tr data-index="${index}"><td>${index+1}</td><td><select data-committee-member aria-label="Pilih nama anggota"><option value="">Pilih anggota…</option>${members.map(member=>`<option value="${esc(member.id)}" ${member.id===row.member_id?'selected':''} ${selectedElsewhere.has(member.id)?'disabled':''}>${esc(member.full_name)}${member.nia?` · ${esc(member.nia)}`:''} · Angkatan ${esc(member.cohort)}</option>`).join('')}</select></td><td><select data-committee-role aria-label="Pilih jabatan atau seksi"><option value="">Pilih peran…</option>${committeeRoles.map(role=>`<option value="${esc(role)}" ${role===row.role_title?'selected':''}>${esc(role)}</option>`).join('')}</select></td><td><select data-committee-division aria-label="Pilih divisi">${committeeDivisions.map(([value,label])=>`<option value="${esc(value)}" ${(row.division||'BPH')===value?'selected':''}>${esc(label)}</option>`).join('')}</select></td><td><button type="button" data-remove-committee="${index}" aria-label="Hapus baris panitia">Hapus</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function renderRundown(){
    const list=$('#program-document-rundown-list');
    if(!rundown.length){list.innerHTML='<p class="records-empty">Belum ada susunan acara.</p>';return;}
    list.innerHTML=`<div class="program-document-table-wrap"><table class="program-document-entry-table program-document-rundown-table"><thead><tr><th>No.</th><th>Mulai</th><th>Selesai</th><th>Kegiatan</th><th>Penanggung jawab</th><th></th></tr></thead><tbody>${rundown.map((row,index)=>`<tr data-index="${index}"><td>${index+1}</td><td><input type="time" data-rundown-start aria-label="Jam mulai acara ${index+1}" value="${esc(row.start_time||'')}"></td><td><input type="time" data-rundown-end aria-label="Jam selesai acara ${index+1}" value="${esc(row.end_time||'')}"></td><td><input type="text" data-rundown-activity maxlength="180" aria-label="Kegiatan rundown ${index+1}" placeholder="Nama sesi / kegiatan" value="${esc(row.activity||'')}"></td><td><select data-rundown-pic aria-label="Penanggung jawab acara ${index+1}"><option value="">Pilih panitia…</option>${members.map(member=>`<option value="${esc(member.id)}" ${member.id===row.member_id?'selected':''}>${esc(member.full_name)}</option>`).join('')}</select></td><td><button type="button" data-remove-rundown="${index}" aria-label="Hapus acara ${index+1}">Hapus</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function renderBudget(){
    for(const direction of ['income','expense']){
      const list=$(`#program-document-${direction==='income'?'income':'expense'}-list`);
      const rows=budget.map((row,index)=>({row,index})).filter(item=>(item.row.direction||'expense')===direction);
      if(!rows.length){list.innerHTML=`<p class="records-empty">Belum ada ${direction==='income'?'sumber pemasukan':'rincian pengeluaran'}.</p>`;continue;}
      list.innerHTML=`<div class="program-document-table-wrap"><table class="program-document-entry-table program-document-budget-table"><thead><tr><th>No.</th><th>Kategori</th><th>Nama barang / sumber</th><th>Volume</th><th>Satuan</th><th>Harga satuan</th><th>Jumlah</th><th></th></tr></thead><tbody>${rows.map(({row,index},rowNo)=>`<tr data-index="${index}"><td>${rowNo+1}</td><td><select data-budget-category aria-label="Kategori anggaran">${budgetCategories[direction].map(category=>`<option value="${esc(category)}" ${(row.category||'Lainnya')===category?'selected':''}>${esc(category)}</option>`).join('')}</select></td><td><input data-budget-name maxlength="180" aria-label="Nama ${direction==='income'?'sumber pemasukan':'barang atau jasa'}" placeholder="${direction==='income'?'Contoh: Dana CSSMoRA':'Nama barang/jasa'}" value="${esc(row.item_name||'')}"></td><td><input data-budget-quantity type="number" min="0.01" step="0.01" aria-label="Volume" placeholder="0" value="${esc(row.quantity??1)}"></td><td><input data-budget-unit maxlength="40" aria-label="Satuan" placeholder="kali / orang / unit" value="${esc(row.unit||'kegiatan')}"></td><td><input data-budget-unit-price type="number" min="0" max="1000000000000" step="1" aria-label="Harga satuan rupiah" placeholder="Rp" value="${esc(row.unit_price??0)}"></td><td class="program-document-line-total">${money((Number(row.quantity)||0)*(Number(row.unit_price)||0))}</td><td><button type="button" data-remove-budget="${index}" aria-label="Hapus baris anggaran">Hapus</button></td></tr>`).join('')}</tbody></table></div>`;
    }
    renderBudgetTotal();
  }
  function renderBudgetTotal(){
    const totalFor=direction=>budget.filter(row=>(row.direction||'expense')===direction).reduce((sum,row)=>sum+(Number(row.quantity)||0)*(Number(row.unit_price)||0),0);
    $('#program-document-budget-total').textContent=`Pemasukan ${money(totalFor('income'))} · Pengeluaran ${money(totalFor('expense'))} · Selisih ${money(totalFor('income')-totalFor('expense'))}`;
  }
  function renderPhotos(){
    const list=$('#program-document-photo-list');
    if(!photos.length&&!pendingPhotos.length){list.innerHTML='<p class="records-empty">Belum ada foto diunggah.</p>';return;}
    list.innerHTML=[...photos.map((photo,index)=>`<div class="program-document-photo-row"><span aria-hidden="true">📷</span><input data-photo-caption="${esc(photo.id)}" maxlength="240" aria-label="Caption foto" value="${esc(photo.caption||'')}"><button type="button" data-remove-photo="${esc(photo.id)}">Hapus</button></div>`),...pendingPhotos.map((item,index)=>`<div class="program-document-photo-row"><img src="${item.preview}" alt="Pratinjau dokumentasi ${index+1}"><input data-pending-caption="${index}" maxlength="240" aria-label="Caption dokumentasi ${index+1}" value="${esc(item.caption)}"><button type="button" data-remove-pending-photo="${index}">Hapus</button></div>`)].join('');
  }
  function renderDocumentList(){
    $('#program-document-count').textContent=`${documents.length} dokumen`;
    const list=$('#program-document-list');
    if(!documents.length){list.innerHTML='<p class="records-empty">Belum ada proposal atau LPJ.</p>';return;}
    list.innerHTML=documents.map(doc=>{
      const program=programs.find(row=>row.id===doc.program_id);
      const creator=doc.created_by===context().userId?'Dibuat oleh Anda':'Draf pengurus';
      const roles=context().roles||[];
      const canOpenDoc=doc.created_by===context().userId||roles.includes('sekretaris')||roles.includes('ketua')||(roles.includes('bendahara')&&doc.document_type==='lpj'&&doc.optional_sections?.finance&&doc.status==='secretary_review');
      const canOpenPdf=roles.includes('sekretaris')||roles.includes('ketua');
      return `<article class="program-document-card ${current?.id===doc.id?'is-selected':''}"><header class="program-document-card-header"><button type="button" data-select-document="${esc(doc.id)}">${esc(typeLabels[doc.document_type])} · ${esc(doc.title)}</button><span class="record-status ${doc.status==='approved'?'published':doc.status==='revision'?'needs-review':''}">${esc(statusLabels[doc.status]||doc.status)}</span></header><small>${esc(program?.name||'Proker')} · ${esc(doc.period_label)} · ${new Date(doc.updated_at).toLocaleDateString('id-ID')} · ${creator}</small><div class="program-document-card-actions">${doc.google_doc_url&&canOpenDoc?`<a href="${esc(doc.google_doc_url)}" target="_blank" rel="noopener">Buka Google Docs ↗</a>`:''}${doc.google_pdf_url&&canOpenPdf?`<a href="${esc(doc.google_pdf_url)}" target="_blank" rel="noopener">Buka PDF di Drive ↗</a>`:''}${['secretary_review','treasurer_review','chair_review'].includes(doc.status)?'<small>Menunggu peninjauan tahap berikutnya</small>':''}</div></article>`;
    }).join('');
  }
  function renderAiPreview(){
    const root=$('#program-document-ai-preview');const content=$('#program-document-ai-preview-content');
    const sections=current?.ai_content?.sections;
    if(!sections||!Object.keys(sections).length){root.hidden=true;content.innerHTML='';return;}
    root.hidden=false;
    content.innerHTML=Object.entries(sections).filter(([,value])=>String(value||'').trim()).map(([key,value])=>`<section><strong>${esc(({background:'Latar belakang',approach:'Rencana pendekatan',opening:'Pendahuluan',implementation:'Pelaksanaan',outcome:'Luaran dan capaian',evaluation:'Evaluasi',recommendations:'Rekomendasi',closing:'Penutup'})[key]||key)}</strong><p>${esc(value)}</p></section>`).join('');
  }
  function renderReviewActions(){
    const root=$('#program-document-review-actions');
    if(!current){root.hidden=true;root.innerHTML='';return;}
    let stage=current.status==='secretary_review'?'sekretaris':current.status==='treasurer_review'?'bendahara':current.status==='chair_review'?'ketua':'';
    if(!stage||!mayReview(stage)||current.created_by===context().userId){root.hidden=true;root.innerHTML='';return;}
    root.hidden=false;
    const isTreasuryStage=stage==='bendahara';
    const financeGate=current.document_type==='lpj'&&current.optional_sections?.finance&&stage==='sekretaris';
    const canSign=stage==='sekretaris'?context().roles?.includes('sekretaris'):stage==='ketua'&&context().roles?.includes('ketua');
    const actionButton=isTreasuryStage?'<button type="button" class="admin-button" data-document-review="approved">Selesaikan verifikasi Bendahara ✓</button>':canSign?`<button type="button" class="admin-button" data-document-sign="${stage}">Tanda tangani &amp; ${stage==='sekretaris'?'teruskan ke Ketua':'selesaikan'} ✓</button>`:'';
    root.innerHTML=`${current.google_doc_url?`<a class="program-document-review-doc-link" href="${esc(current.google_doc_url)}" target="_blank" rel="noopener">Tinjau Google Docs ↗</a>`:''}${financeGate?'<p class="admin-muted">LPJ dengan realisasi keuangan harus diverifikasi Bendahara dan Docs diperbarui sebelum Sekretaris dapat menandatangani.</p>':''}<label for="program-document-review-note">Catatan peninjauan (wajib jika meminta revisi)</label><textarea id="program-document-review-note" rows="2" maxlength="2000" placeholder="Catatan untuk PIC"></textarea><div class="program-review-buttons"><button type="button" class="member-option-button" data-document-review="revision_requested">Minta revisi</button>${actionButton}</div>`;
  }
  function renderActions(){
    const editable=isEditable();
    const roles=context().roles||[];
    const canRefreshDoc=editable||Boolean(current&&((current.status==='treasurer_review'&&roles.includes('bendahara'))||(current.status==='secretary_review'&&current.document_type==='lpj'&&current.optional_sections?.finance&&roles.includes('bendahara'))));
    $('#program-document-save').disabled=!editable;$('#program-document-ai').disabled=!editable;$('#program-document-google').disabled=!canRefreshDoc;
    $('#program-document-google').textContent=current?.google_doc_id?'Perbarui Google Docs':'Buat Google Docs';
    $('#program-document-submit').hidden=!current||!editable||!['draft','revision'].includes(current.status);
    $('#program-document-submit').disabled=!editable;
    document.querySelectorAll('.program-document-fields').forEach(section=>section.querySelectorAll('input,textarea,select').forEach(field=>field.disabled=!editable||section.hidden));
    $('#program-document-type').disabled=!editable||Boolean(current);
    $('#program-document-program').disabled=!editable||Boolean(current);
    $('#program-document-period').disabled=!editable||Boolean(current);
    $('#program-document-title').disabled=!editable;
    $('#program-document-start').disabled=!editable;
    $('#program-document-end').disabled=!editable;
    document.querySelectorAll('.program-document-options input').forEach(input=>input.disabled=!editable||input.closest('[data-option-for]').dataset.optionFor!==selectedType());
    $('#program-document-add-committee').disabled=!editable;$('#program-document-add-income').disabled=!editable;$('#program-document-add-expense').disabled=!editable;$('#program-document-add-rundown').disabled=!editable;
    $('#program-document-photos').disabled=!editable;
    const mayEnterFinance=Boolean(current?.document_type==='lpj'&&current.optional_sections?.finance&&context().roles?.includes('bendahara')&&['secretary_review','treasurer_review'].includes(current.status));
    $('#program-document-finance-save').hidden=!mayEnterFinance;
    $('#program-document-finance-save').disabled=!mayEnterFinance;
    document.querySelectorAll('[data-remove-committee],[data-remove-budget],[data-remove-rundown],[data-remove-photo],[data-remove-pending-photo]').forEach(button=>button.disabled=!editable);
    document.querySelectorAll('[data-committee-member],[data-committee-role],[data-committee-division],[data-budget-category],[data-budget-name],[data-budget-quantity],[data-budget-unit],[data-budget-unit-price],[data-rundown-start],[data-rundown-end],[data-rundown-activity],[data-rundown-pic],[data-photo-caption],[data-pending-caption]').forEach(field=>field.disabled=!editable);
    ['lpj-income','lpj-expense','lpj-akunpro','lpj-finance-note'].forEach(id=>{const field=$('#'+id);field.disabled=!mayEnterFinance;});
    renderReviewActions();
  }
  function prefillProgram(programId){
    const program=programs.find(row=>row.id===programId);if(!program)return;
    const detail=details.get(programId)||{};
    if(!current){
      $('#program-document-title').value=program.name;
      if(detail.period_label)$('#program-document-period').value=detail.period_label;
      if(selectedType()==='proposal'){
        $('#proposal-description').value=detail.description||'';$('#proposal-goals').value=detail.goals||'';$('#proposal-target').value=detail.target||'';
        if(/^\d{4}-\d{2}-\d{2}$/.test(detail.planned_schedule||''))$('#program-document-start').value=detail.planned_schedule;
      }
    }
  }
  function setFormData(data={}){
    const form=$('#program-document-form');
    $('#program-document-start').value=data.event_date||data.actual_date||current?.period_start||'';
    $('#program-document-end').value=data.event_end_date||data.actual_end_date||current?.period_end||'';
    rundown=Array.isArray(data.rundown)?data.rundown.map(row=>({...row})):typeof data.rundown==='string'&&data.rundown.trim()?data.rundown.split(/\n+/).map(line=>({activity:line.replace(/^\s*\d{1,2}[.:]\d{2}\s*(?:-|–|—)\s*/,'').trim()})).filter(row=>row.activity):[];
    Object.entries(data).forEach(([name,value])=>{if(['event_date','event_end_date','actual_date','actual_end_date','rundown'].includes(name))return;const field=form.elements.namedItem(name);if(field&&field.type!=='checkbox')field.value=value??'';});
    if(data.event_time&&!data.event_time_start)form.elements.namedItem('event_time_start').value=data.event_time;
    if(data.actual_time&&!data.actual_time_start)form.elements.namedItem('actual_time_start').value=data.actual_time;
  }
  function getFormData(){
    const form=$('#program-document-form');const names=selectedType()==='proposal'
      ?['description','goals','materials','target','event_time_start','event_time_end','place','theme']
      :['realization_summary','outcome_summary','realization_by_division','obstacles','evaluation_by_division','administration_summary','evaluation','recommendations','attendance_target','attendance_count','actual_time_start','actual_time_end','actual_place'];
    const data=Object.fromEntries(names.map(name=>[name,form.elements.namedItem(name)?.value?.trim()||'']));
    if(selectedType()==='proposal')Object.assign(data,{event_date:$('#program-document-start').value||'',event_end_date:$('#program-document-end').value||'',rundown:rundown.map(row=>({start_time:row.start_time||'',end_time:row.end_time||'',activity:String(row.activity||'').trim(),member_id:row.member_id||''})).filter(row=>row.activity)});
    else Object.assign(data,{actual_date:$('#program-document-start').value||'',actual_end_date:$('#program-document-end').value||''});
    return data;
  }
  function clearEditor(){
    current=null;budget=[];committee=[];rundown=[];photos=[];pendingPhotos.forEach(item=>URL.revokeObjectURL(item.preview));pendingPhotos=[];finance={};subrecordsDirty=false;
    $('#program-document-form').reset();$('#program-document-id').value='';$('#program-document-type').value='proposal';
    $('#program-document-editor-title').textContent='Mulai proposal atau LPJ';
    $('#program-document-finance-message').textContent='';
    renderType();renderCommittee();renderRundown();renderBudget();renderPhotos();renderDocumentList();message('');
    renderAiPreview();
  }
  async function loadSubrecords(id){
    const docId=encodeURIComponent(id);
    const [budgetRows,committeeRows,photoRows,reviewRows]=await Promise.all([
      api()(`cssmora_program_document_budget_items?select=*&document_id=eq.${docId}&order=position.asc`).catch(()=>[]),
      api()(`cssmora_program_document_committee?select=id,member_id,role_title,division,position&document_id=eq.${docId}&order=position.asc`).catch(()=>[]),
      api()(`cssmora_program_document_photos?select=id,storage_path,caption,position&document_id=eq.${docId}&order=position.asc`).catch(()=>[]),
      api()(`cssmora_program_document_reviews?select=review_stage,decision,note,created_at&document_id=eq.${docId}&order=created_at.asc`).catch(()=>[])
    ]);
    budget=budgetRows||[];committee=committeeRows||[];photos=photoRows||[];
    renderBudget();renderCommittee();renderRundown();renderPhotos();
    const history=(reviewRows||[]).map(row=>`${row.review_stage}: ${row.decision==='approved'?'disetujui':'revisi diminta'}${row.note?` — ${row.note}`:''}`).join('\n');
    $('#program-document-review-actions').title=history;
    const historyNode=$('#program-document-review-history'),historyContent=$('#program-document-review-history-content');
    historyNode.hidden=!(reviewRows||[]).length;
    historyContent.innerHTML=(reviewRows||[]).map(row=>`<article class="program-document-history-row"><strong>${esc(row.review_stage)} · ${row.decision==='approved'?'Disetujui':'Revisi diminta'}</strong><small>${esc(new Date(row.created_at).toLocaleString('id-ID'))}</small>${row.note?`<p>${esc(row.note)}</p>`:''}</article>`).join('');
    const financeAvailable=financeReviewer()&&current.document_type==='lpj';
    if(financeAvailable){
      const financeRows=await api()(`cssmora_program_document_finance?select=*&document_id=eq.${docId}&limit=1`).catch(()=>[]);
      finance=financeRows?.[0]||{};
      $('#lpj-income').value=finance.income_amount??'';$('#lpj-expense').value=finance.expense_amount??'';$('#lpj-akunpro').value=finance.akunpro_url||'';$('#lpj-finance-note').value=finance.realization_note||'';
    }else finance={};
    renderType();
  }
  function selectDocument(id){
    current=documents.find(row=>row.id===id)||null;if(!current)return;
    pendingPhotos.forEach(item=>URL.revokeObjectURL(item.preview));pendingPhotos=[];finance={};
    $('#program-document-id').value=current.id;$('#program-document-type').value=current.document_type;$('#program-document-program').value=current.program_id;
    $('#program-document-period').value=current.period_label;$('#program-document-title').value=current.title;$('#program-document-start').value=current.period_start||'';$('#program-document-end').value=current.period_end||'';
    setFormData(current.form_data||{});
    document.querySelectorAll(`.program-document-options [data-option-for="${current.document_type}"] input`).forEach(input=>input.checked=Boolean(current.optional_sections?.[input.name]));
    $('#program-document-editor-title').textContent=`${typeLabels[current.document_type]} · ${current.title}`;
    renderType();renderAiPreview();renderDocumentList();message('Memuat rincian dokumen…');
    void loadSubrecords(current.id).then(()=>{renderActions();message('');}).catch(error=>message(error.message||'Rincian dokumen gagal dimuat.','error'));
  }
  async function load(){
    if(!$('#program-documents-panel'))return;
    const roles=context().roles||[];
    if(!roles.some(role=>['ketua','wakil','sekretaris','bendahara','bph_departemen'].includes(role))){$('#program-document-list').innerHTML='<p class="records-empty">Akses dokumen proker diperlukan.</p>';return;}
    if(loading)return loading;
    loading=(async()=>{
      try{
        const [programRows,detailRows,docRows,memberRows]=await Promise.all([
          api()('agenda_programs?select=id,name,division,is_active&order=name.asc'),
          api()('cssmora_program_details?select=program_id,period_label,description,goals,target,planned_schedule,pic,budget_amount'),
          api()('cssmora_program_documents?select=*&order=updated_at.desc'),
          api()('rpc/get_cssmora_program_document_members',{method:'POST',body:{}})
        ]);
        programs=programRows||[];details=new Map((detailRows||[]).map(row=>[row.program_id,row]));documents=docRows||[];members=memberRows||[];
        const selection=current?.id;
        setSelectOptions($('#program-document-program'),programs,row=>`${row.name}${row.division?` · ${row.division}`:''}`,current?.program_id||'');
        renderDocumentList();renderType();
        if(selection&&documents.some(row=>row.id===selection))selectDocument(selection);
      }catch(error){$('#program-document-list').innerHTML=`<p class="records-empty">${esc(error.message||'Dokumen belum dapat dimuat.')}</p>`;message(error.message||'Dokumen belum dapat dimuat.','error');}
      finally{loading=null;}
    })();
    return loading;
  }
  async function saveSubrecords(){
    if(!current)return;
    const id=encodeURIComponent(current.id),type=current.document_type,opts=current.optional_sections||{};
    const saveRows=async(table,rows)=>{
      await api()(`${table}?document_id=eq.${id}`,{method:'DELETE'});
      for(let index=0;index<rows.length;index++)await api()(table,{method:'POST',body:{...rows[index],document_id:current.id,position:index}});
    };
    if(subrecordsDirty&&type==='proposal'&&opts.rab){
      const rows=budget.filter(row=>String(row.item_name||'').trim()).map(row=>({direction:row.direction==='income'?'income':'expense',item_name:String(row.item_name).trim(),quantity:Number(row.quantity)||1,unit:String(row.unit||'kegiatan').trim(),unit_price:Number(row.unit_price)||0,category:String(row.category||'Umum')}));
      await saveRows('cssmora_program_document_budget_items',rows);
    }else if(subrecordsDirty&&type==='proposal')await api()(`cssmora_program_document_budget_items?document_id=eq.${id}`,{method:'DELETE'});
    if(subrecordsDirty&&opts.committee){
      const rows=committee.filter(row=>row.member_id).map(row=>({member_id:row.member_id,role_title:String(row.role_title||'Anggota').trim(),division:committeeDivisions.some(([value])=>value===row.division)?row.division:'BPH'}));
      await saveRows('cssmora_program_document_committee',rows);
    }else if(subrecordsDirty)await api()(`cssmora_program_document_committee?document_id=eq.${id}`,{method:'DELETE'});
    if(subrecordsDirty&&type==='lpj'&&opts.documentation){
      for(const photo of photos){
        if(photo.id)await api()(`cssmora_program_document_photos?id=eq.${encodeURIComponent(photo.id)}`,{method:'PATCH',body:{caption:String(photo.caption||'').trim(),position:Number(photo.position)||0}});
      }
      for(const item of pendingPhotos){
        if(item.file.size>8*1024*1024)throw new Error(`${item.file.name} melebihi batas 8 MB.`);
        if(!['image/jpeg','image/png'].includes(item.file.type))throw new Error('Format dokumentasi harus JPG atau PNG agar dapat tertanam di Google Docs.');
        const extension=item.file.type==='image/jpeg'?'jpg':item.file.type.split('/')[1];
        const path=`${current.id}/${crypto.randomUUID()}.${extension}`;
        const url=`${cfg().url}/storage/v1/object/${activeBucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
        const response=await window.CSSMoRAAdmin.request(url,{method:'POST',headers:{apikey:cfg().publishableKey,'Content-Type':item.file.type,'x-upsert':'false'},body:item.file});
        if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.message||'Foto dokumentasi gagal diunggah.');}
        const position=Math.max(-1,...photos.map(photo=>Number(photo.position)||0))+1;
        await api()('cssmora_program_document_photos',{method:'POST',body:{document_id:current.id,storage_path:path,caption:item.caption,position}});
        photos.push({storage_path:path,caption:item.caption,position});URL.revokeObjectURL(item.preview);
      }
      pendingPhotos=[];
    }
    if(subrecordsDirty){
      await api()(`cssmora_program_documents?id=eq.${id}`,{method:'PATCH',body:{ai_content:{}},extraHeaders:{Prefer:'return=minimal'}});
      current={...current,ai_content:{},google_doc_generated_at:null};subrecordsDirty=false;
    }
    await loadSubrecords(current.id);
  }
  async function saveFinance(){
    if(!current||current.document_type!=='lpj'||!current.optional_sections?.finance||!context().roles?.includes('bendahara')||!['secretary_review','treasurer_review'].includes(current.status))throw new Error('Verifikasi realisasi hanya dapat disimpan Bendahara sebelum dokumen ditandatangani Ketua.');
    const maxAmount=1_000_000_000_000;
    if([$('#lpj-income').value,$('#lpj-expense').value].some(value=>Number(value)<0||Number(value)>maxAmount))throw new Error('Nilai realisasi harus berada di antara Rp0 dan Rp1 triliun.');
    const payload={document_id:current.id,income_amount:Number($('#lpj-income').value)||0,expense_amount:Number($('#lpj-expense').value)||0,
      akunpro_url:$('#lpj-akunpro').value.trim()||null,realization_note:$('#lpj-finance-note').value.trim()};
    if(!payload.akunpro_url)throw new Error('Tautan AkunPro wajib dicantumkan agar realisasi dapat diverifikasi.');
    const url=new URL(payload.akunpro_url);if(url.protocol!=='https:')throw new Error('Tautan AkunPro harus menggunakan HTTPS.');
    await api()('cssmora_program_document_finance?on_conflict=document_id',{method:'POST',body:payload,extraHeaders:{Prefer:'resolution=merge-duplicates,return=minimal'}});
    finance=payload;message('Verifikasi Bendahara tersimpan. Perbarui Google Docs agar angkanya ikut masuk sebelum tanda tangan Sekretaris.','success');renderActions();
  }
  function formPayload(){
    const type=selectedType(),programId=$('#program-document-program').value;
    const title=$('#program-document-title').value.trim();
    const period=$('#program-document-period').value.trim();
    const formData=getFormData();
    const options=selectedSections();
    if(!programId||!title||period.length<4)throw new Error('Pilih proker dan lengkapi judul serta periode.');
    if(type==='proposal'&&(formData.description.length<20||!formData.goals||!formData.target))throw new Error('Proposal wajib memiliki deskripsi (minimal 20 karakter), tujuan, dan sasaran.');
    if(type==='proposal'&&!formData.event_date)throw new Error('Tanggal pelaksanaan proposal wajib diisi.');
    if($('#program-document-start').value&&$('#program-document-end').value&&$('#program-document-end').value<$('#program-document-start').value)throw new Error('Tanggal akhir tidak boleh lebih awal daripada tanggal pelaksanaan.');
    if(type==='proposal'&&formData.event_time_start&&formData.event_time_end&&formData.event_time_end<=formData.event_time_start)throw new Error('Jam selesai kegiatan harus sesudah jam mulai.');
    if(type==='lpj'&&formData.actual_time_start&&formData.actual_time_end&&formData.actual_time_end<=formData.actual_time_start)throw new Error('Jam selesai pelaksanaan harus sesudah jam mulai.');
    if(type==='lpj'&&formData.realization_summary.length<20)throw new Error('Ringkasan pelaksanaan LPJ minimal 20 karakter.');
    if(options.committee&&(!committee.some(row=>row.member_id)||committee.some(row=>(row.member_id||row.role_title)&&(!row.member_id||!row.role_title))))throw new Error('Lengkapi nama dan jabatan/divisi setiap panitia.');
    const enteredRundown=rundown.filter(row=>row.activity||row.start_time||row.end_time||row.member_id);
    if(type==='proposal'&&options.rundown_section&&(!enteredRundown.length||enteredRundown.some(row=>!String(row.activity||'').trim()||!row.start_time||!row.end_time)))throw new Error('Lengkapi setiap baris rundown dengan jam mulai, jam selesai, dan kegiatan.');
    if(type==='proposal'&&options.rab&&!budget.some(row=>row.direction==='expense'&&String(row.item_name||'').trim()))throw new Error('Tambahkan minimal satu baris pengeluaran atau matikan bagian RAB.');
    if(type==='lpj'&&options.documentation&&!photos.length&&!pendingPhotos.length)throw new Error('Unggah minimal satu foto dokumentasi atau matikan bagian Dokumentasi.');
    if(type==='proposal'&&options.rab&&budget.some(row=>String(row.item_name||'').trim()&&(!(Number(row.quantity)>0)||Number(row.unit_price)<0)))throw new Error('Periksa volume dan harga pada setiap baris RAB.');
    const hasFinancial=type==='proposal'?Boolean(options.rab&&budget.some(row=>String(row.item_name||'').trim())):Boolean(options.finance);
    return {program_id:programId,period_label:period,document_type:type,title,period_start:$('#program-document-start').value||null,period_end:$('#program-document-end').value||null,form_data:formData,optional_sections:options,has_financial_section:hasFinancial};
  }
  async function saveDraft(){
    if(!$('#program-document-form').reportValidity())throw new Error('Lengkapi isian yang wajib terlebih dahulu.');
    const payload=formPayload();
    let result;
    if(current){
      const {program_id,period_label,document_type,...updatePayload}=payload;
      const rows=await api()(`cssmora_program_documents?id=eq.${encodeURIComponent(current.id)}`,{method:'PATCH',body:updatePayload,extraHeaders:{Prefer:'return=representation'}});result=Array.isArray(rows)?rows[0]:rows;
    }else{
      const rows=await api()('cssmora_program_documents',{method:'POST',body:payload,extraHeaders:{Prefer:'return=representation'}});result=Array.isArray(rows)?rows[0]:rows;
    }
    if(!result?.id)throw new Error('Draf belum tersimpan.');
    current=result;
    renderAiPreview();
    await saveSubrecords();
    documents=[current,...documents.filter(doc=>doc.id!==current.id)];renderDocumentList();renderActions();
    return current;
  }
  async function assistant(action){
    const document=action==='generate_ai'||isEditable()?await saveDraft():current;
    if(!document)throw new Error('Pilih atau simpan draf terlebih dahulu.');
    const response=await window.CSSMoRAAdmin.request(`${cfg().url}/functions/v1/program-document-assistant`,{method:'POST',headers:{apikey:cfg().publishableKey,'Content-Type':'application/json'},body:JSON.stringify({action,document_id:document.id})});
    const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Dokumen AI belum dapat dibuat.');
    if(result.ai_content){
      await api()(`cssmora_program_documents?id=eq.${encodeURIComponent(document.id)}`,{method:'PATCH',body:{ai_content:result.ai_content},extraHeaders:{Prefer:'return=representation'}});
      current={...current,ai_content:result.ai_content,google_doc_generated_at:null};documents=documents.map(row=>row.id===current.id?current:row);
      renderAiPreview();
      message('Narasi AI siap. Tinjau isinya, lalu buat Google Docs.','success');
    }else if(result.google_doc_url){
      current={...current,google_doc_id:result.google_doc_id,google_doc_url:result.google_doc_url,google_doc_generated_at:result.google_doc_generated_at};documents=documents.map(row=>row.id===current.id?current:row);
      message('Google Docs berhasil dibuat atau diperbarui.','success');
    }else if(result.status){
      current={...current,status:result.status,google_pdf_id:result.google_pdf_id,google_pdf_url:result.google_pdf_url,google_pdf_generated_at:new Date().toISOString()};documents=documents.map(row=>row.id===current.id?current:row);
      message(`Tanda tangan tersimpan. PDF tersedia di Drive dan dokumen diteruskan ke ${result.status==='chair_review'?'Ketua':'arsip dokumen'}.`,'success');
    }
    renderDocumentList();renderActions();return result;
  }
  async function submitDocument(){
    if(!current)return;
    if(!$('#program-document-form').reportValidity()){message('Lengkapi isian yang wajib terlebih dahulu.','error');return;}
    if(!window.confirm('Simpan draf terbaru, buat Google Docs, lalu kirim tautannya ke Sekretaris untuk ditinjau dan ditandatangani?'))return;
    const button=$('#program-document-submit');button.disabled=true;message('Menyimpan data dan menyusun narasi…');
    try{
      await assistant('generate_ai');
      message('Membuat Google Docs dari data terbaru…');
      await assistant('create_doc');
      if(!current.google_doc_id||!current.google_doc_generated_at)throw new Error('Google Docs belum berhasil dibuat. Dokumen belum diajukan.');
      await api()('rpc/submit_cssmora_program_document',{method:'POST',body:{p_document_id:current.id}});
      message('Google Docs siap. Tautannya telah masuk ke antrean Sekretaris untuk ditinjau dan ditandatangani.','success');
      const id=current.id;await load();selectDocument(id);
    }
    catch(error){message(error.message||'Dokumen belum dapat diajukan.','error');button.disabled=false;}
  }
  async function reviewDocument(decision){
    if(!current)return;
    if(decision==='approved'&&current.status!=='treasurer_review')return;
    const note=$('#program-document-review-note')?.value.trim()||'';
    if(decision==='revision_requested'&&!note){message('Isi catatan sebelum meminta revisi.','error');return;}
    try{
      const result=await api()('rpc/review_cssmora_program_document',{method:'POST',body:{p_document_id:current.id,p_decision:decision,p_note:note||null}});
      message(`Keputusan tersimpan. Status berikutnya: ${statusLabels[result]||result}.`,'success');
      const id=current.id;await load();selectDocument(id);
    }catch(error){message(error.message||'Keputusan peninjauan gagal.','error');}
  }
  async function signDocument(stage){
    if(!current)return;
    const title=stage==='sekretaris'?'Sekretaris':'Ketua';
    const destination=stage==='sekretaris'?'meneruskan dokumen dan PDF ke Ketua':'menyelesaikan dokumen';
    if(!window.confirm(`Gunakan tanda tangan ${title} yang tersimpan untuk dokumen ini dan ${destination}?`))return;
    const button=$(`[data-document-sign="${stage}"]`);if(button)button.disabled=true;
    message(`Membubuhkan tanda tangan ${title} dan menyiapkan PDF di Drive…`);
    try{
      const result=await assistant('sign_document');
      const id=current.id;await load();selectDocument(id);
      if(result.google_pdf_url)message(`PDF sudah disimpan di Drive dan dibagikan. Tidak ada unduhan otomatis.`,'success');
    }catch(error){message(error.message||`Tanda tangan ${title} gagal disimpan.`,'error');}
    finally{renderActions();}
  }
  function refreshBudgetFromInputs(){
    document.querySelectorAll('.program-document-budget-table tbody tr[data-index]').forEach(row=>{
      const target=budget[Number(row.dataset.index)];if(!target)return;
      target.category=row.querySelector('[data-budget-category]').value;
      target.item_name=row.querySelector('[data-budget-name]').value;target.quantity=row.querySelector('[data-budget-quantity]').value;
      target.unit=row.querySelector('[data-budget-unit]').value;target.unit_price=row.querySelector('[data-budget-unit-price]').value;
    });renderBudget();
  }
  $('#program-document-type').addEventListener('change',()=>{renderType();if(!current)prefillProgram($('#program-document-program').value);});
  $('#program-document-program').addEventListener('change',event=>prefillProgram(event.target.value));
  document.querySelectorAll('.program-document-options input').forEach(input=>input.addEventListener('change',()=>{renderType();}));
  $('#program-document-reset').addEventListener('click',clearEditor);
  $('#program-documents-refresh').addEventListener('click',()=>void load());
  $('#program-document-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('#program-document-save');button.disabled=true;message('Menyimpan draf…');
    try{await saveDraft();message('Draf dan rincian tersimpan.','success');await load();selectDocument(current.id);}
    catch(error){message(error.message||'Draf belum tersimpan.','error');}
    finally{button.disabled=false;renderActions();}
  });
  $('#program-document-add-committee').addEventListener('click',()=>{committee.push({member_id:'',role_title:'',division:'BPH'});subrecordsDirty=true;renderCommittee();renderActions();});
  $('#program-document-committee-list').addEventListener('change',event=>{
    const row=event.target.closest('[data-index]');if(!row)return;const item=committee[Number(row.dataset.index)];if(!item)return;
    if(event.target.matches('[data-committee-member]'))item.member_id=event.target.value;
    if(event.target.matches('[data-committee-role]'))item.role_title=event.target.value;
    if(event.target.matches('[data-committee-division]'))item.division=event.target.value;
    subrecordsDirty=true;
    renderCommittee();renderActions();
  });
  $('#program-document-committee-list').addEventListener('click',event=>{const button=event.target.closest('[data-remove-committee]');if(button){committee.splice(Number(button.dataset.removeCommittee),1);subrecordsDirty=true;renderCommittee();}});
  $('#program-document-add-income').addEventListener('click',()=>{refreshBudgetFromInputs();budget.push({direction:'income',item_name:'',quantity:1,unit:'kegiatan',unit_price:0});subrecordsDirty=true;renderBudget();renderActions();});
  $('#program-document-add-expense').addEventListener('click',()=>{refreshBudgetFromInputs();budget.push({direction:'expense',item_name:'',quantity:1,unit:'kegiatan',unit_price:0});subrecordsDirty=true;renderBudget();renderActions();});
  $('#program-document-budget-section').addEventListener('input',event=>{
    const row=event.target.closest('[data-index]');if(!row)return;const item=budget[Number(row.dataset.index)];if(!item)return;
    if(event.target.matches('[data-budget-name]'))item.item_name=event.target.value;
    if(event.target.matches('[data-budget-quantity]'))item.quantity=event.target.value;
    if(event.target.matches('[data-budget-unit]'))item.unit=event.target.value;
    if(event.target.matches('[data-budget-unit-price]'))item.unit_price=event.target.value;
    subrecordsDirty=true;
    row.querySelector('.program-document-line-total').textContent=money((Number(item.quantity)||0)*(Number(item.unit_price)||0));
    renderBudgetTotal();
  });
  $('#program-document-budget-section').addEventListener('change',event=>{
    if(!event.target.matches('[data-budget-category]'))return;
    const row=event.target.closest('[data-index]');if(!row)return;
    const item=budget[Number(row.dataset.index)];if(item){item.category=event.target.value;subrecordsDirty=true;}
  });
  $('#program-document-budget-section').addEventListener('click',event=>{const button=event.target.closest('[data-remove-budget]');if(button){refreshBudgetFromInputs();budget.splice(Number(button.dataset.removeBudget),1);subrecordsDirty=true;renderBudget();renderActions();}});
  $('#program-document-add-rundown').addEventListener('click',()=>{rundown.push({start_time:'',end_time:'',activity:'',member_id:''});subrecordsDirty=true;renderRundown();renderActions();});
  $('#program-document-rundown-list').addEventListener('input',event=>{
    const row=event.target.closest('[data-index]');if(!row)return;const item=rundown[Number(row.dataset.index)];if(!item)return;
    if(event.target.matches('[data-rundown-start]'))item.start_time=event.target.value;
    if(event.target.matches('[data-rundown-end]'))item.end_time=event.target.value;
    if(event.target.matches('[data-rundown-activity]'))item.activity=event.target.value;
    subrecordsDirty=true;
  });
  $('#program-document-rundown-list').addEventListener('change',event=>{
    const row=event.target.closest('[data-index]');if(!row)return;const item=rundown[Number(row.dataset.index)];if(!item)return;
    if(event.target.matches('[data-rundown-pic]'))item.member_id=event.target.value;
    subrecordsDirty=true;
  });
  $('#program-document-rundown-list').addEventListener('click',event=>{const button=event.target.closest('[data-remove-rundown]');if(button){rundown.splice(Number(button.dataset.removeRundown),1);subrecordsDirty=true;renderRundown();renderActions();}});
  $('#program-document-photos').addEventListener('change',event=>{
    for(const file of event.target.files||[]){pendingPhotos.push({file,caption:file.name.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').slice(0,240)||`Dokumentasi ${photos.length+pendingPhotos.length+1}`,preview:URL.createObjectURL(file)});subrecordsDirty=true;}
    event.target.value='';renderPhotos();renderActions();
  });
  $('#program-document-photo-list').addEventListener('input',event=>{
    const id=event.target.dataset.photoCaption;if(id){const row=photos.find(photo=>photo.id===id);if(row)row.caption=event.target.value;}
    const index=event.target.dataset.pendingCaption;if(index!==undefined&&pendingPhotos[index])pendingPhotos[index].caption=event.target.value;
    if(id||index!==undefined)subrecordsDirty=true;
  });
  $('#program-document-photo-list').addEventListener('click',async event=>{
    const pending=event.target.closest('[data-remove-pending-photo]');if(pending){const [item]=pendingPhotos.splice(Number(pending.dataset.removePendingPhoto),1);if(item)URL.revokeObjectURL(item.preview);subrecordsDirty=true;renderPhotos();return;}
    const remove=event.target.closest('[data-remove-photo]');if(!remove||!current)return;
    const row=photos.find(photo=>photo.id===remove.dataset.removePhoto);if(!row)return;
    remove.disabled=true;
    try{
      const path=row.storage_path.split('/').map(encodeURIComponent).join('/');
      await window.CSSMoRAAdmin.request(`${cfg().url}/storage/v1/object/${activeBucket}/${path}`,{method:'DELETE',headers:{apikey:cfg().publishableKey}});
      await api()(`cssmora_program_document_photos?id=eq.${encodeURIComponent(row.id)}`,{method:'DELETE'});
      photos=photos.filter(photo=>photo.id!==row.id);current={...current,ai_content:{},google_doc_generated_at:null};documents=documents.map(doc=>doc.id===current.id?current:doc);renderPhotos();renderAiPreview();renderDocumentList();renderActions();
    }catch(error){message(error.message||'Foto tidak dapat dihapus.','error');remove.disabled=false;}
  });
  $('#program-document-ai').addEventListener('click',async()=>{
    const button=$('#program-document-ai');button.disabled=true;message('AI sedang menyusun narasi dari fakta yang diisi…');
    try{await assistant('generate_ai');}
    catch(error){message(error.message||'Narasi AI gagal dibuat.','error');}
    finally{button.disabled=false;renderActions();}
  });
  $('#program-document-google').addEventListener('click',async()=>{
    const button=$('#program-document-google');button.disabled=true;message('Membuat Google Docs dan menata halaman…');
    try{await assistant('create_doc');}
    catch(error){message(error.message||'Google Docs gagal dibuat.','error');}
    finally{button.disabled=false;renderActions();}
  });
  $('#program-document-submit').addEventListener('click',()=>void submitDocument());
  $('#program-document-finance-save').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;message('Menyimpan verifikasi Bendahara…');
    try{await saveFinance();}
    catch(error){message(error.message||'Verifikasi keuangan gagal disimpan.','error');}
    finally{renderActions();}
  });
  $('#program-document-review-actions').addEventListener('click',event=>{const sign=event.target.closest('[data-document-sign]');if(sign){void signDocument(sign.dataset.documentSign);return;}const button=event.target.closest('[data-document-review]');if(button)void reviewDocument(button.dataset.documentReview);});
  $('#program-document-list').addEventListener('click',event=>{const button=event.target.closest('[data-select-document]');if(button)selectDocument(button.dataset.selectDocument);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('#program-documents-panel').hidden)void load();});
  window.CSSMoRAProgramDocuments={load};
  renderType();
})();
