const config=window.CSSMORA_SUPABASE;
const $=selector=>document.querySelector(selector);
const form=$('#achievement-form');
const rosterSelect=$('#leader-member');
const memberList=$('#team-member-list');
let roster=[];
let selectedTeamIds=new Set();
const fmtMoney=value=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value)||0);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function subsidyRate(type,fee){if(type==='individu')return .5;if(fee<=20000)return 1;if(fee<=50000)return .75;if(fee<=80000)return .5;return .25;}
function updateSubsidy(){
  const type=form.elements.participation_type.value,fee=Math.max(0,Number($('#fee-amount').value)||0),rate=subsidyRate(type,fee);
  $('#subsidy-rate').textContent=`${Math.round(rate*100)}%`;
  $('#requested-amount').textContent=fmtMoney(Math.round(fee*rate));
  $('#subsidy-rules').textContent=type==='individu'?'Individu mendapat subsidi 50% dari biaya pendaftaran.':`Tim: ≤ Rp20.000 mendapat 100%; Rp20.001–50.000 mendapat 75%; Rp50.001–80.000 mendapat 50%; di atas Rp80.000 mendapat 25%.`;
}
function renderLeaderOptions(){
  const current=rosterSelect.value;
  rosterSelect.innerHTML='<option value="">Pilih nama dari roster anggota</option>'+roster.map(m=>`<option value="${escapeHTML(m.id)}">${escapeHTML(m.full_name)} · ${escapeHTML(m.cohort)}</option>`).join('');
  if(roster.some(m=>m.id===current))rosterSelect.value=current;
}
function renderTeamOptions(){
  const query=$('#member-search').value.trim().toLowerCase(),leader=rosterSelect.value;
  const options=roster.filter(m=>m.id!==leader&&`${m.full_name} ${m.cohort} ${m.study_program||''}`.toLowerCase().includes(query));
  memberList.innerHTML=options.length?options.map(m=>`<label class="team-member-option"><input type="checkbox" name="team_member_ids" value="${escapeHTML(m.id)}" ${selectedTeamIds.has(m.id)?'checked':''}><span><strong>${escapeHTML(m.full_name)}</strong><small>Angkatan ${escapeHTML(m.cohort)}${m.study_program?` · ${escapeHTML(m.study_program)}`:''}</small></span></label>`).join(''):'<p class="achievement-hint">Tidak ada nama yang cocok.</p>';
}
async function loadRoster(){
  try{
    const response=await fetch(`${config.url}/rest/v1/rpc/cssmora_achievement_member_roster`,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:'{}'});
    const rows=await response.json();if(!response.ok)throw new Error(rows.message||'Roster gagal dimuat.');
    roster=rows;renderLeaderOptions();renderTeamOptions();
  }catch(error){rosterSelect.innerHTML='<option value="">Roster tidak dapat dimuat</option>';$('#achievement-message').textContent=error.message;$('#achievement-message').dataset.kind='error';}
}
document.querySelectorAll('input[name="participation_type"]').forEach(input=>input.addEventListener('change',()=>{
  $('#team-fields').hidden=input.value!=='tim';updateSubsidy();
}));
$('#fee-amount').addEventListener('input',updateSubsidy);
rosterSelect.addEventListener('change',renderTeamOptions);
$('#member-search').addEventListener('input',renderTeamOptions);
memberList.addEventListener('change',event=>{const box=event.target.closest('input[name="team_member_ids"]');if(!box)return;if(box.checked)selectedTeamIds.add(box.value);else selectedTeamIds.delete(box.value);});
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const message=$('#achievement-message'),button=$('#submit-achievement'),file=$('#proof-file').files[0];
  message.textContent='';message.dataset.kind='';
  if(!form.reportValidity())return;
  if(!file){message.textContent='Lampirkan bukti pendaftaran terlebih dahulu.';message.dataset.kind='error';return;}
  if(file.size>5*1024*1024){message.textContent='Ukuran bukti maksimal 5 MB.';message.dataset.kind='error';return;}
  const ext={'image/jpeg':'jpg','image/png':'png','application/pdf':'pdf'}[file.type];
  if(!ext){message.textContent='Format bukti harus JPG, PNG, atau PDF.';message.dataset.kind='error';return;}
  const type=form.elements.participation_type.value;
  const teamIds=[...selectedTeamIds].filter(id=>id!==rosterSelect.value);
  if(type==='tim'&&!teamIds.length){message.textContent='Pilih minimal satu anggota tim dari roster CSSMoRA.';message.dataset.kind='error';return;}
  const id=crypto.randomUUID(),path=`applications/${id}/proof.${ext}`;
  button.disabled=true;button.textContent='Mengirim pengajuan…';message.textContent='Mengunggah bukti dan menyimpan pengajuan…';
  let uploaded=false;
  try{
    const upload=await fetch(`${config.url}/storage/v1/object/cssmora-prestasi-proofs/${path}`,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':file.type,'x-upsert':'false'},body:file});
    if(!upload.ok){const err=await upload.json().catch(()=>({}));throw new Error(err.message||'Bukti pendaftaran gagal diunggah.');}
    uploaded=true;
    const payload={p_id:id,p_competition_name:form.elements.competition_name.value.trim(),p_competition_type:form.elements.competition_type.value,
      p_participation_type:type,p_leader_member_id:rosterSelect.value,p_leader_phone:form.elements.leader_phone.value.trim(),
      p_official_email:form.elements.official_email.value.trim(),p_fee_amount:Number(form.elements.fee_amount.value),
      p_information_url:form.elements.information_url.value.trim(),p_proof_path:path,p_bank_name:form.elements.bank_name.value.trim(),
      p_account_number:form.elements.account_number.value.trim(),p_account_name:form.elements.account_name.value.trim(),
      p_return_agreement:form.elements.return_agreement.checked,p_team_member_ids:teamIds};
    const submit=await fetch(`${config.url}/rest/v1/rpc/submit_cssmora_achievement_application`,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const result=await submit.json().catch(()=>({}));
    if(!submit.ok)throw new Error(result.message||'Pengajuan belum berhasil disimpan.');
    message.innerHTML=`Pengajuan <strong>${escapeHTML(result.request_number)}</strong> terkirim. Nilai subsidi yang diajukan ${fmtMoney(result.requested_amount)}. Bendahara akan meninjau bukti terlebih dahulu.`;
    message.dataset.kind='success';form.reset();selectedTeamIds.clear();$('#team-fields').hidden=true;renderLeaderOptions();renderTeamOptions();updateSubsidy();
  }catch(error){
    if(uploaded)fetch(`${config.url}/storage/v1/object/cssmora-prestasi-proofs/${path}`,{method:'DELETE',headers:{apikey:config.publishableKey}}).catch(()=>{});
    message.textContent=error.message;message.dataset.kind='error';
  }finally{button.disabled=false;button.innerHTML='Kirim pengajuan <span aria-hidden="true">↗</span>';}
});
updateSubsidy();void loadRoster();
