/* Local image compression shared by public forms and admin uploads.
   Proker photos intentionally bypass this helper to preserve originals. */
(function(){
  async function decode(file){
    if(typeof createImageBitmap==="function") return await createImageBitmap(file);
    return await new Promise((resolve,reject)=>{
      const image=new Image(),url=URL.createObjectURL(file);
      image.onload=()=>{URL.revokeObjectURL(url);resolve(image)};
      image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Gambar tidak dapat dibaca."))};
      image.src=url;
    });
  }
  function encode(canvas,quality){
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Gambar gagal dikompres.")),"image/jpeg",quality));
  }
  async function compressImage(file,{maxBytes=2*1024*1024,maxSourceBytes=20*1024*1024}={}){
    if(!file||!/^image\/(jpeg|png|webp)$/i.test(file.type)) return file;
    if(file.size>maxSourceBytes) throw new Error("Ukuran gambar sebelum dikompres maksimal 20 MB.");
    if(file.size<=maxBytes) return file;
    const bitmap=await decode(file);
    try{
      for(const edge of [2200,1800,1500,1200,1000]){
        const scale=Math.min(1,edge/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement("canvas");
        canvas.width=Math.max(1,Math.round(bitmap.width*scale));
        canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const ctx=canvas.getContext("2d",{alpha:false});
        if(!ctx) throw new Error("Peramban tidak dapat mengompres gambar ini.");
        ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
        for(const quality of [.9,.84,.78,.72,.66,.6]){
          const blob=await encode(canvas,quality);
          if(blob.size<=maxBytes){
            const base=file.name.replace(/\.[^.]+$/,"")||"bukti";
            return new File([blob],base+".jpg",{type:"image/jpeg",lastModified:file.lastModified||Date.now()});
          }
        }
      }
    }finally{if(typeof bitmap.close==="function")bitmap.close()}
    throw new Error("Gambar belum bisa dikompres sampai 2 MB. Pilih gambar yang lebih kecil.");
  }
  window.CSSMoRAUpload={compressImage};
})();