const config=window.CSSMORA_SUPABASE;
const $=selector=>document.querySelector(selector);
const token=new URLSearchParams(location.search).get('t');
const form=$('#checkin-form');
const message=(text,kind='')=>{const node=$('#checkin-message');node.textContent=text;node.dataset.kind=kind;};
async function invoke(method,body){
  const response=await fetch(config.url+'/functions/v1/attendance-checkin?token='+encodeURIComponent(token),{
    method,headers:{apikey:config.publishableKey,'Content-Type':'application/json'},
    body:body?JSON.stringify(body):undefined
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||'Permintaan absensi gagal.');
  return result;
}
async function init(){
  if(!token){$('#event-title').textContent='Tautan absensi tidak valid';message('Buka tautan yang dibagikan oleh sekretaris.','error');return;}
  if(!config?.url||!config?.publishableKey){message('Layanan absensi belum siap.','error');return;}
  try{
    const event=await invoke('GET');
    $('#event-title').textContent=event.title;
    $('#event-meta').textContent=event.event_date+' · '+(event.session_name||'Umum')+' · WIB';
    form.hidden=false;
  }catch(error){$('#event-title').textContent='Absensi tidak tersedia';message(error.message,'error');}
}
form.addEventListener('submit',async event=>{
  event.preventDefault();const button=$('#checkin-submit');button.disabled=true;
  message('Menyimpan kehadiran…');
  try{
    const result=await invoke('POST',{nia:$('#checkin-nia').value.trim(),full_name:$('#checkin-name').value.trim(),checkin_code:$('#checkin-code').value.trim()});
    message(result.message||'Absensi berhasil dicatat.','success');form.reset();form.hidden=true;
  }catch(error){message(error.message,'error');button.disabled=false;}
});
init();
