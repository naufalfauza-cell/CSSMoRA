(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const admin = window.CSSMoRAAdmin;
  const config = window.CSSMORA_SUPABASE;
  const base = new URL('./', document.currentScript.src);
  const pdfBucket = 'cssmora-letter-pdfs';
  const assetBucket = 'cssmora-signer-assets';
  const MAX_PDF = 10485760;
  const MAX_IMAGE = 2097152;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const message = (selector, value, kind='') => admin.showMessage(selector, value, kind);
  let letters = [], requests = [], signers = [];
  let pdfjs, pdfDocument, originalBytes, currentRequest, currentPage = 1, renderTask, renderVersion = 0;
  let signature, stamp, selectedMark='signature', positions={signature:null,stamp:null};
  const objectUrls = [];

  async function storage(bucket, path, {method='GET',body,upsert=false,fresh=false}={}) {
    const url = new URL(`/storage/v1/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`,config.url);
    if(fresh)url.searchParams.set('_refresh',`${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const response=await admin.request(url,{
      method,cache:fresh?'no-store':undefined,
      headers:{apikey:config.publishableKey,...(body?{'Content-Type':body.type||'application/octet-stream','x-upsert':String(upsert)}:{})},body
    });
    if (!response.ok) {
      const result=await response.json().catch(()=>({}));
      const error=new Error(result.message||result.error||'Berkas tidak dapat diakses.');
      error.status=response.status;
      error.code=String(result.error||result.code||'').toLowerCase();
      throw error;
    }
    return response;
  }
  async function upload(bucket,path,blob,upsert=false) {
    await storage(bucket,path,{method:'POST',body:blob,upsert});
  }
  async function download(bucket,path,{fresh=false}={}) {
    return (await storage(bucket,path,{fresh})).blob();
  }
  async function validatePdf(file) {
    if (!file || file.size < 5 || file.size > MAX_PDF || (file.type && file.type !== 'application/pdf'))
      throw new Error('Pilih PDF berukuran maksimal 10 MB.');
    const signature=new TextDecoder().decode(await file.slice(0,5).arrayBuffer());
    if (signature !== '%PDF-') throw new Error('Berkas ini bukan PDF yang valid.');
  }
  const requestPath = (id,kind) => `${id}/${kind}.pdf`;
  const assetPath = kind => `${admin.context().userId}/${kind}.png`;
  function requestLabel(request) {
    return letters.find(item=>item.id===request.letter_id)?.letter_number || 'Surat terarsip';
  }
  const statusLabels={draft:'Unggahan tertunda',pending:'Menunggu tanda tangan',signed:'Sudah ditandatangani',rejected:'Ditolak',cancelled:'Dibatalkan'};

  function renderQueue() {
    const list=$('#letter-sign-requests');
    if (!requests.length) {list.innerHTML='<p class="records-empty">Belum ada pengajuan tanda tangan.</p>';return;}
    const {userId,isLeadership}=admin.context();
    list.innerHTML=requests.map(item=>{
      const canSign=isLeadership && item.signer_id===userId && item.status==='pending';
      const canCancel=['draft','pending'].includes(item.status) && (item.created_by===userId || isLeadership);
      const canRetry=item.status==='draft' && item.created_by===userId;
      const email=signers.find(signer=>signer.id===item.signer_id)?.email || 'Akun penandatangan';
      return `<article class="letter-sign-item" data-request-id="${esc(item.id)}">
        <div><strong>${esc(requestLabel(item))}</strong><span class="letter-sign-status" data-state="${esc(item.status)}">${esc(statusLabels[item.status]||item.status)}</span></div>
        <small>${esc(email)} · ${esc(new Date(item.created_at).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Jakarta'}))}</small>
        ${item.rejection_reason?`<p class="letter-sign-reason">${esc(item.rejection_reason)}</p>`:''}
        <div class="letter-sign-actions">
          ${canSign?'<button type="button" data-sign="1">Tinjau &amp; tandatangani</button><button type="button" data-reject="1">Tolak</button>':''}
          ${canRetry?'<button type="button" data-resume="1">Lanjutkan unggah</button>':''}
          ${item.status==='signed'?'<button type="button" data-download="signed">Unduh hasil PDF</button>':''}
          ${['pending','signed','rejected','cancelled'].includes(item.status)?'<button type="button" data-download="original">Lihat PDF asli</button>':''}
          ${canCancel?'<button type="button" data-cancel="1">Batalkan</button>':''}
        </div>
      </article>`;
    }).join('');
  }
  async function loadRequests() {
    requests=await admin.api('cssmora_letter_signature_requests?select=*&order=created_at.desc&limit=100');
    renderQueue();
  }
  async function load(currentLetters) {
    letters=currentLetters;
    const previous=$('#letter-sign-letter').value;
    $('#letter-sign-letter').replaceChildren(new Option('Pilih surat',''),...letters.filter(letter=>letter.archive_status!=='void').map(letter=>new Option(`${letter.letter_number} · ${letter.subject}`,letter.id)));
    if (letters.some(letter=>letter.id===previous)) $('#letter-sign-letter').value=previous;
    try {
      signers=await admin.api('rpc/cssmora_letter_signers',{method:'POST',body:{}})||[];
      $('#letter-sign-signer').replaceChildren(new Option('Pilih Ketua / Wakil',''),...signers.map(signer=>new Option(signer.email,signer.id)));
      await loadRequests();
      message('#letter-sign-message','');
    } catch(error) {
      $('#letter-sign-requests').innerHTML='<p class="records-empty">Daftar pengajuan belum dapat dimuat.</p>';
      message('#letter-sign-message',error.message,'error');
    }
  }
  window.CSSMoRALetterSignatures={load,reset};
  $('#letter-sign-refresh').addEventListener('click',async()=>{
    try {await loadRequests();message('#letter-sign-message','Daftar diperbarui.','success');}
    catch(error){message('#letter-sign-message',error.message,'error');}
  });
  $('#letter-sign-request-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget, button=form.querySelector('[type=submit]');
    button.disabled=true;
    try {
      const file=$('#letter-sign-pdf').files[0];
      await validatePdf(file);
      message('#letter-sign-message','Mengunggah PDF…');
      const id=await admin.api('rpc/cssmora_create_letter_signature_request',{method:'POST',body:{p_letter_id:$('#letter-sign-letter').value,p_signer_id:$('#letter-sign-signer').value}});
      try {
        await upload(pdfBucket,requestPath(id,'original'),new Blob([file],{type:'application/pdf'}));
        await admin.api('rpc/cssmora_submit_letter_signature_request',{method:'POST',body:{p_request_id:id}});
      } catch(error) {
        message('#letter-sign-message',`Pengajuan dibuat tetapi unggahan belum selesai: ${error.message} Gunakan “Lanjutkan unggah” di daftar.`, 'error');
        await loadRequests();
        return;
      }
      form.reset();
      await loadRequests();
      message('#letter-sign-message','PDF berhasil diajukan kepada penandatangan.','success');
    } catch(error){message('#letter-sign-message',error.message,'error');}
    finally {button.disabled=false;}
  });
  const retryInput=document.createElement('input');
  retryInput.type='file';retryInput.accept='application/pdf,.pdf';retryInput.hidden=true;
  $('.letter-signatures').append(retryInput);
  let retryRequest;
  retryInput.addEventListener('change',async()=>{
    const id=retryRequest, file=retryInput.files[0]; retryInput.value='';
    if (!id || !file) return;
    try {
      await validatePdf(file);
      await upload(pdfBucket,requestPath(id,'original'),new Blob([file],{type:'application/pdf'}));
      await admin.api('rpc/cssmora_submit_letter_signature_request',{method:'POST',body:{p_request_id:id}});
      await loadRequests();
      message('#letter-sign-message','PDF berhasil diajukan.','success');
    } catch(error){message('#letter-sign-message',error.message,'error');}
  });
  $('#letter-sign-requests').addEventListener('click',async event=>{
    const button=event.target.closest('button');
    const card=button?.closest('[data-request-id]');
    if (!card) return;
    const item=requests.find(request=>request.id===card.dataset.requestId);
    if (!item) return;
    button.disabled=true;
    try {
      if (button.dataset.sign) await openViewer(item);
      else if (button.dataset.download) {
        const kind=button.dataset.download;
        const blob=await download(pdfBucket,requestPath(item.id,kind));
        const href=URL.createObjectURL(blob), anchor=document.createElement('a');
        anchor.href=href;anchor.download=`${requestLabel(item).replace(/[^a-z0-9-]/gi,'-')}-${kind}.pdf`;
        document.body.append(anchor);anchor.click();anchor.remove();
        setTimeout(()=>URL.revokeObjectURL(href),60000);
      } else if (button.dataset.resume) {
        try {
          await admin.api('rpc/cssmora_submit_letter_signature_request',{method:'POST',body:{p_request_id:item.id}});
          await loadRequests();message('#letter-sign-message','PDF berhasil diajukan.','success');
        } catch(error) {
          if (!error.message.includes('PDF asli')) throw error;
          retryRequest=item.id;retryInput.click();
        }
      } else if (button.dataset.reject) {
        const reason=window.prompt('Alasan penolakan (minimal 3 karakter):');
        if (reason===null) return;
        await admin.api('rpc/cssmora_reject_letter_signature_request',{method:'POST',body:{p_request_id:item.id,p_reason:reason.trim()}});
        await loadRequests();message('#letter-sign-message','Pengajuan ditolak.','success');
      } else if (button.dataset.cancel) {
        if (!window.confirm('Batalkan pengajuan tanda tangan ini? Nomor surat tetap tersimpan.')) return;
        await admin.api('rpc/cssmora_cancel_letter_signature_request',{method:'POST',body:{p_request_id:item.id}});
        await loadRequests();message('#letter-sign-message','Pengajuan dibatalkan.','success');
      }
    } catch(error){message('#letter-sign-message',error.message,'error');}
    finally {button.disabled=false;}
  });

  async function getPdfjs() {
    if (!pdfjs) {
      pdfjs=await import(new URL('./vendor/pdfjs/pdf.min.mjs',base).href);
      pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.mjs',base).href;
    }
    return pdfjs;
  }
  async function getPdfLib() {
    if (window.PDFLib) return window.PDFLib;
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=new URL('./vendor/pdf-lib.min.js',base).href;
      script.onload=resolve;script.onerror=()=>reject(new Error('Penyunting PDF belum dapat dimuat.'));
      document.head.append(script);
    });
    return window.PDFLib;
  }
  async function loadMark(kind,{fresh=false}={}) {
    const previous=kind==='signature'?signature:stamp;
    if (previous?.url) URL.revokeObjectURL(previous.url);
    let next=null;
    try {
      const blob=await download(assetBucket,assetPath(kind),{fresh});
      const url=URL.createObjectURL(blob), image=new Image();
      image.src=url;
      await image.decode();
      next={bytes:new Uint8Array(await blob.arrayBuffer()),url,image};
      objectUrls.push(url);
    } catch(error) {
      if (error.status!==404 && !['not_found','not found'].includes(error.code) && !/object not found/i.test(error.message)) throw error;
    }
    if (kind==='signature') signature=next; else stamp=next;
    renderMarks();
  }
  async function useLocalMark(kind,blob,isCurrent) {
    const url=URL.createObjectURL(blob), image=new Image();
    image.src=url;
    await image.decode();
    if (isCurrent && !isCurrent()) {URL.revokeObjectURL(url);return false;}
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if (isCurrent && !isCurrent()) {URL.revokeObjectURL(url);return false;}
    const next={bytes,url,image};
    objectUrls.push(url);
    const previous=kind==='signature'?signature:stamp;
    if(kind==='signature')signature=next;else stamp=next;
    if (previous?.url) URL.revokeObjectURL(previous.url);
    renderMarks();
    return true;
  }
  function showSavedSignatureInPad() {
    const canvas=$('#letter-sign-pad'),context=canvas.getContext('2d');
    context.clearRect(0,0,canvas.width,canvas.height);
    if(signature)context.drawImage(signature.image,0,0,canvas.width,canvas.height);
    padDirty=false;
  }
  async function openViewer(item) {
    const {isLeadership,userId}=admin.context();
    if (!isLeadership || item.signer_id!==userId || item.status!=='pending') return;
    closeViewer();
    currentRequest=item;currentPage=1;positions={signature:null,stamp:null};selectedMark='signature';
    $('#letter-sign-consent').checked=false;
    $('#letter-sign-dialog-title').textContent=`Tandatangani ${requestLabel(item)}`;
    message('#letter-sign-dialog-message','Memuat PDF…');
    $('#letter-sign-dialog').showModal();
    try {
      originalBytes=new Uint8Array(await (await download(pdfBucket,requestPath(item.id,'original'))).arrayBuffer());
      const library=await getPdfjs();
      pdfDocument=await library.getDocument({data:new Uint8Array(originalBytes),isEvalSupported:false}).promise;
      await Promise.all([loadMark('signature',{fresh:true}),loadMark('stamp',{fresh:true})]);
      showSavedSignatureInPad();
      await renderPage();
      message('#letter-sign-dialog-message',signature?'Tempatkan tanda tangan pada halaman.':'Gambar atau unggah tanda tangan, lalu simpan.');
    } catch(error){message('#letter-sign-dialog-message',error.message,'error');}
  }
  async function renderPage() {
    if (!pdfDocument) return;
    const version=++renderVersion;
    if (renderTask) {renderTask.cancel();await renderTask.promise.catch(()=>{});}
    const page=await pdfDocument.getPage(currentPage);
    if (version!==renderVersion) return;
    const width=Math.min(840,Math.max(260,$('.letter-sign-preview').clientWidth-24));
    const viewport=page.getViewport({scale:width/page.getViewport({scale:1}).width});
    const canvas=$('#letter-sign-pdf-canvas'), paper=$('#letter-sign-paper');
    const ratio=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);
    canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;
    paper.style.width=`${viewport.width}px`;paper.style.height=`${viewport.height}px`;
    renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0]});
    try {await renderTask.promise;} catch(error){if (version===renderVersion) throw error;return;}
    $('#letter-sign-page-count').textContent=`Halaman ${currentPage} / ${pdfDocument.numPages}`;
    $('#letter-sign-prev').disabled=currentPage===1;
    $('#letter-sign-next').disabled=currentPage===pdfDocument.numPages;
    renderMarks();
  }
  function renderMarks() {
    for (const [kind,mark,element] of [['signature',signature,$('#letter-sign-mark')],['stamp',stamp,$('#letter-stamp-mark')]]) {
      const position=positions[kind];
      element.hidden=!position || position.page!==currentPage || !mark;
      if (element.hidden) continue;
      element.src=mark.url;
      element.style.left=`${position.x*100}%`;element.style.top=`${position.y*100}%`;
      element.style.width=`${position.w*100}%`;element.style.height=`${position.h*100}%`;
      element.classList.toggle('is-selected',selectedMark===kind);
      element.tabIndex=0;
    }
  }
  function place(kind) {
    const asset=kind==='signature'?signature:stamp;
    if (!asset || !pdfDocument) {message('#letter-sign-dialog-message',`Simpan ${kind==='signature'?'tanda tangan':'stempel'} terlebih dahulu.`,'error');return;}
    selectedMark=kind;
    const paper=$('#letter-sign-paper');
    const w=Number($(kind==='signature'?'#letter-sign-size':'#letter-stamp-size').value)/100;
    const h=Math.min(.5,w*paper.clientWidth/paper.clientHeight*asset.image.naturalHeight/asset.image.naturalWidth);
    positions[kind]={page:currentPage,x:Math.max(0,.84-w),y:Math.max(0,.8-h),w,h};
    renderMarks();message('#letter-sign-dialog-message','Geser gambar sampai tepat di area surat.');
  }
  function resize(kind) {
    const position=positions[kind],asset=kind==='signature'?signature:stamp;
    if (!position || !asset || position.page!==currentPage) return;
    const paper=$('#letter-sign-paper');
    position.w=Number($(kind==='signature'?'#letter-sign-size':'#letter-stamp-size').value)/100;
    position.h=Math.min(.5,position.w*paper.clientWidth/paper.clientHeight*asset.image.naturalHeight/asset.image.naturalWidth);
    position.x=Math.min(position.x,1.5-position.w);position.y=Math.min(position.y,1-position.h);
    renderMarks();
  }
  function move(kind,x,y) {
    const p=positions[kind];if (!p) return;
    p.x=Math.max(0,Math.min(1.5-p.w,x));p.y=Math.max(0,Math.min(1-p.h,y));renderMarks();
  }
  for (const [kind,element] of [['signature',$('#letter-sign-mark')],['stamp',$('#letter-stamp-mark')]]) {
    element.addEventListener('pointerdown',event=>{
      const p=positions[kind],paper=$('#letter-sign-paper');if (!p) return;
      selectedMark=kind;renderMarks();event.preventDefault();
      element.setPointerCapture(event.pointerId);
      const startX=event.clientX,startY=event.clientY,x=p.x,y=p.y;
      const onMove=moveEvent=>move(kind,x+(moveEvent.clientX-startX)/paper.clientWidth,y+(moveEvent.clientY-startY)/paper.clientHeight);
      const onEnd=()=>{element.removeEventListener('pointermove',onMove);element.removeEventListener('pointerup',onEnd);element.removeEventListener('pointercancel',onEnd);};
      element.addEventListener('pointermove',onMove);element.addEventListener('pointerup',onEnd);element.addEventListener('pointercancel',onEnd);
    });
    element.addEventListener('keydown',event=>{
      const step=event.shiftKey?.05:.01,p=positions[kind];if (!p) return;
      if (event.key==='ArrowLeft') move(kind,p.x-step,p.y);
      else if (event.key==='ArrowRight') move(kind,p.x+step,p.y);
      else if (event.key==='ArrowUp') move(kind,p.x,p.y-step);
      else if (event.key==='ArrowDown') move(kind,p.x,p.y+step);
      else return;
      event.preventDefault();
    });
  }
  const showPage=()=>void renderPage().catch(error=>message('#letter-sign-dialog-message',error.message,'error'));
  $('#letter-sign-prev').addEventListener('click',()=>{if (currentPage>1){currentPage--;showPage();}});
  $('#letter-sign-next').addEventListener('click',()=>{if (pdfDocument && currentPage<pdfDocument.numPages){currentPage++;showPage();}});
  $('#letter-sign-place').addEventListener('click',()=>place('signature'));
  $('#letter-stamp-place').addEventListener('click',()=>place('stamp'));
  $('#letter-stamp-remove').addEventListener('click',()=>{positions.stamp=null;renderMarks();});
  $('#letter-sign-size').addEventListener('input',()=>resize('signature'));
  $('#letter-stamp-size').addEventListener('input',()=>resize('stamp'));
  window.addEventListener('resize',()=>{if ($('#letter-sign-dialog').open && pdfDocument) showPage();});

  const pad=$('#letter-sign-pad'),context=pad.getContext('2d');
  let drawing=false, padDirty=false, signatureDraftVersion=0, signaturePreviewTimer;
  function padPoint(event) {
    const box=pad.getBoundingClientRect();
    return {x:(event.clientX-box.left)*pad.width/box.width,y:(event.clientY-box.top)*pad.height/box.height};
  }
  pad.addEventListener('pointerdown',event=>{
    event.preventDefault();pad.setPointerCapture(event.pointerId);drawing=true;padDirty=true;
    const point=padPoint(event);context.beginPath();context.moveTo(point.x,point.y);
    context.lineWidth=4;context.lineCap='round';context.lineJoin='round';context.strokeStyle='#142d24';
    context.lineTo(point.x+.01,point.y+.01);context.stroke();
  });
  pad.addEventListener('pointermove',event=>{
    if (!drawing) return;
    const point=padPoint(event);context.lineTo(point.x,point.y);context.stroke();
    clearTimeout(signaturePreviewTimer);
    signaturePreviewTimer=setTimeout(()=>void previewSignatureDraft().catch(error=>message('#letter-sign-dialog-message',error.message,'error')),140);
  });
  const canvasBlob=(canvas)=>new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  async function previewSignatureDraft() {
    const version=++signatureDraftVersion;
    const blob=await canvasBlob(pad);
    if (!blob || version!==signatureDraftVersion || !padDirty) return;
    const previous=positions.signature?{...positions.signature}:null;
    const applied=await useLocalMark('signature',blob,()=>version===signatureDraftVersion);
    if (!applied || version!==signatureDraftVersion || !pdfDocument) return;
    if (previous && previous.page===currentPage) {
      positions.signature=previous;
      resize('signature');
    } else place('signature');
    message('#letter-sign-dialog-message','Pratinjau diperbarui. Klik “Simpan tanda tangan” untuk menyimpan perubahan.');
  }
  for (const type of ['pointerup','pointercancel']) pad.addEventListener(type,()=>{
    drawing=false;clearTimeout(signaturePreviewTimer);
    if (padDirty) void previewSignatureDraft().catch(error=>message('#letter-sign-dialog-message',error.message,'error'));
  });
  $('#letter-sign-clear').addEventListener('click',()=>{
    ++signatureDraftVersion;clearTimeout(signaturePreviewTimer);
    context.clearRect(0,0,pad.width,pad.height);padDirty=false;
    if (signature?.url) URL.revokeObjectURL(signature.url);
    signature=null;positions.signature=null;renderMarks();
    message('#letter-sign-dialog-message','Pratinjau tanda tangan dihapus. Tanda tangan tersimpan di akun Anda tetap aman.');
  });
  async function normalizeImage(file,maxWidth,maxHeight) {
    if (!file || !['image/png','image/jpeg'].includes(file.type) || file.size>MAX_IMAGE) throw new Error('Pilih PNG atau JPG maksimal 2 MB.');
    const bitmap=await createImageBitmap(file);
    const factor=Math.min(1,maxWidth/bitmap.width,maxHeight/bitmap.height);
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*factor));canvas.height=Math.max(1,Math.round(bitmap.height*factor));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    const blob=await canvasBlob(canvas);
    if (!blob || blob.size>MAX_IMAGE) throw new Error('Gambar terlalu besar setelah diolah.');
    return blob;
  }
  $('#letter-sign-image-file').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if (!file) return;
    try {
      const blob=await normalizeImage(file,pad.width,pad.height), bitmap=await createImageBitmap(blob);
      context.clearRect(0,0,pad.width,pad.height);
      context.drawImage(bitmap,(pad.width-bitmap.width)/2,(pad.height-bitmap.height)/2);bitmap.close();padDirty=true;
      await previewSignatureDraft();
    } catch(error){message('#letter-sign-dialog-message',error.message,'error');}
  });
  $('#letter-sign-save').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    try {
      if (!padDirty) throw new Error('Gambar atau unggah tanda tangan dahulu.');
      const blob=await canvasBlob(pad);
      if (!blob || blob.size>MAX_IMAGE) throw new Error('Tanda tangan melebihi 2 MB.');
      ++signatureDraftVersion;clearTimeout(signaturePreviewTimer);
      await useLocalMark('signature',blob);
      if(pdfDocument)place('signature');
      $('#letter-sign-confirm').disabled=true;
      try {await upload(assetBucket,assetPath('signature'),blob,true);}
      catch(error){signature=null;positions.signature=null;renderMarks();throw error;}
      finally {$('#letter-sign-confirm').disabled=false;}
      message('#letter-sign-dialog-message','Tanda tangan tersimpan hanya untuk akun Anda.','success');
    } catch(error){message('#letter-sign-dialog-message',error.message,'error');}
    finally {button.disabled=false;}
  });
  $('#letter-stamp-file').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if (!file) return;
    try {
      const blob=await normalizeImage(file,700,700);
      await useLocalMark('stamp',blob);
      if(pdfDocument)place('stamp');
      await upload(assetBucket,assetPath('stamp'),blob,true);
      message('#letter-sign-dialog-message','Stempel tersimpan. Klik “Tempatkan” jika diperlukan.','success');
    } catch(error){message('#letter-sign-dialog-message',error.message,'error');}
  });

  async function generateSignedPdf() {
    const library=await getPdfLib();
    const document=await library.PDFDocument.load(originalBytes);
    const items=[['signature',signature],['stamp',stamp]];
    for (const [kind,asset] of items) {
      const position=positions[kind];if (!position) continue;
      if (!asset) throw new Error(`Aset ${kind} tidak tersedia.`);
      const page=await pdfDocument.getPage(position.page);
      const viewport=page.getViewport({scale:1});
      const geometry=window.CSSMoRALetterPlacement.placementToPdf(viewport,position);
      const embedded=await document.embedPng(asset.bytes);
      document.getPage(position.page-1).drawImage(embedded,{
        x:geometry.x,y:geometry.y,width:geometry.width,height:geometry.height,rotate:library.degrees(geometry.rotation)
      });
    }
    const bytes=await document.save();
    if (bytes.length>MAX_PDF) throw new Error('PDF hasil melebihi batas 10 MB. Perkecil berkas atau gambar.');
    return new Blob([bytes],{type:'application/pdf'});
  }
  $('#letter-sign-confirm').addEventListener('click',async event=>{
    const button=event.currentTarget;
    if (!$('#letter-sign-consent').checked) {message('#letter-sign-dialog-message','Centang persetujuan sebelum menandatangani.','error');return;}
    if (!signature || !positions.signature || !pdfDocument || !currentRequest) {message('#letter-sign-dialog-message','Tempatkan tanda tangan pada PDF dahulu.','error');return;}
    button.disabled=true;
    try {
      message('#letter-sign-dialog-message','Menyimpan PDF yang ditandatangani…');
      const signed=await generateSignedPdf();
      try {await upload(pdfBucket,requestPath(currentRequest.id,'signed'),signed);}
      catch(error){
        if (error.status!==409 && !/already exists|duplicate/i.test(error.message)) throw error;
        // A failed RPC may leave the prior artifact. Never silently finalize a different PDF.
        const prior=await download(pdfBucket,requestPath(currentRequest.id,'signed'));
        const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
        if (await digest(prior)!==await digest(signed))
          throw new Error('PDF hasil yang pernah diunggah berbeda. Batalkan pengajuan ini dan buat pengajuan baru.');
      }
      await admin.api('rpc/cssmora_finish_letter_signature_request',{method:'POST',body:{p_request_id:currentRequest.id}});
      $('#letter-sign-dialog').close();
      await loadRequests();
      message('#letter-sign-message','Surat berhasil ditandatangani. PDF hasil siap diunduh.','success');
    } catch(error){message('#letter-sign-dialog-message',error.message,'error');}
    finally {button.disabled=false;}
  });
  function closeViewer() {
    ++signatureDraftVersion;clearTimeout(signaturePreviewTimer);
    ++renderVersion;
    renderTask?.cancel();renderTask=null;
    pdfDocument?.destroy();pdfDocument=null;originalBytes=null;currentRequest=null;
    positions={signature:null,stamp:null};
    $('#letter-sign-pdf-canvas').getContext('2d').clearRect(0,0,$('#letter-sign-pdf-canvas').width,$('#letter-sign-pdf-canvas').height);
  }
  function reset() {
    if ($('#letter-sign-dialog').open) $('#letter-sign-dialog').close();
    closeViewer();letters=[];requests=[];signers=[];signature=null;stamp=null;
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.length=0;
  }
  $('#letter-sign-close').addEventListener('click',()=>$('#letter-sign-dialog').close());
  $('#letter-sign-dialog').addEventListener('close',closeViewer);
  setInterval(()=>{
    if (!document.hidden && !$('#letters-panel').hidden && admin.context().isSecretariatAdmin)
      void loadRequests().catch(()=>{});
  },20000);
})();
