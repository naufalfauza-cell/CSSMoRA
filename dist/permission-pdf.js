const MAX_PERMISSION_PDF = 2 * 1024 * 1024;
const MAX_SOURCE_PDF = 30 * 1024 * 1024;

export async function preparePermissionPdf(file, {maxBytes=MAX_PERMISSION_PDF}={}) {
  if (!file || (file.type && file.type !== 'application/pdf') ||
      await file.slice(0, 5).text() !== '%PDF-') {
    throw new Error('Pilih surat izin dalam format PDF yang valid.');
  }
  if (file.size <= maxBytes) return new Blob([file], { type: 'application/pdf' });
  if (file.size > MAX_SOURCE_PDF) throw new Error('PDF sumber terlalu besar untuk diproses di perangkat ini. Coba pilih PDF yang lebih ringkas.');

  const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  if (!window.PDFLib) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('./vendor/pdf-lib.min.js', import.meta.url).href;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Kompresi PDF belum bisa dimuat. Coba lagi.'));
      document.head.append(script);
    });
  }
  const { PDFDocument } = window.PDFLib;
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  const canvas = document.createElement('canvas');
  try {
    const source = await loading.promise;
    if (source.numPages > 20) throw new Error('PDF memiliki terlalu banyak halaman untuk dikompres otomatis. Pilih PDF yang lebih ringkas.');
    for (const {edge,quality} of [{edge:1700,quality:0.82},{edge:1350,quality:0.72},{edge:1050,quality:0.58}]) {
      const output = await PDFDocument.create();
      let encodedSize = 0;
      for (let index = 1; index <= source.numPages; index++) {
        const page = await source.getPage(index);
        const size = page.getViewport({scale:1});
        const viewport = page.getViewport({scale:edge / Math.max(size.width,size.height)});
        canvas.width = Math.max(1,Math.ceil(viewport.width));
        canvas.height = Math.max(1,Math.ceil(viewport.height));
        try {
          await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'#ffffff'}).promise;
          const image = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',quality));
          if (!image) throw new Error('Halaman PDF gagal dikompres. Coba pilih file lain.');
          encodedSize += image.size;
          if (encodedSize > maxBytes) break;
          const embedded = await output.embedJpg(await image.arrayBuffer());
          output.addPage([size.width,size.height]).drawImage(embedded,{x:0,y:0,width:size.width,height:size.height});
        } finally {
          page.cleanup();
        }
      }
      if (output.getPageCount() !== source.numPages) continue;
      const bytes = await output.save();
      if (bytes.byteLength <= maxBytes) return new Blob([bytes],{type:'application/pdf'});
    }
    throw new Error('PDF belum bisa dikompres tanpa mengurangi keterbacaan. Coba pilih PDF yang lebih ringkas.');
  } finally {
    canvas.width = canvas.height = 0;
    await loading.destroy();
  }
}
