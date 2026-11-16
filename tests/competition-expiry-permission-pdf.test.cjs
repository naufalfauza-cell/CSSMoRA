const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'../dist',file),'utf8');

test('catalog hides expired entries after 72 hours, including direct detail links',()=>{
  const js=read('app.js');
  const rules=js.slice(js.indexOf('const CATALOG_RETENTION_MS'),js.indexOf('const formatDate'));
  const visible=vm.runInNewContext(rules+'\nisCatalogVisible');
  const item={deadline:'2026-11-13T23:59:00+07:00'};
  const end=Date.parse(item.deadline)+72*60*60*1000;
  assert.equal(visible(item,end),true);
  assert.equal(visible(item,end+1),false);
  assert.equal(visible({deadline:'invalid'},end),false);
  assert.match(js,/function detail\(item, updateURL=true\) \{\s*if \(!isCatalogVisible\(item\)\)/);
});

test('small permission PDFs are preserved and invalid files are rejected',async()=>{
  const js=read('permission-pdf.js');
  const prepare=vm.runInNewContext(js.slice(0,js.indexOf('  const pdfjs')) .replace('export async','async')+'}\npreparePermissionPdf',{Blob});
  const original=new Blob(['%PDF-sample'],{type:'application/pdf'});
  assert.equal(await (await prepare(original)).text(),await original.text());
  await assert.rejects(prepare(new Blob(['wrong'],{type:'application/pdf'})),/PDF yang valid/);
  const large=new Blob(['%PDF-',new Uint8Array(30*1024*1024)],{type:'application/pdf'});
  await assert.rejects(prepare(large),/PDF sumber terlalu besar/);
  assert.match(read('absen.js'),/formData\.set\("letter", pdf, file\.name\)/);
});

test('public achievement and subsidy forms compress PDFs and images before upload',()=>{
  for(const file of ['prestasi.js','workflows.js']){
    const js=read(file);
    assert.match(js,/await window.CSSMoRAUpload.compressEvidencePdf\(/);
    assert.match(js,/await window.CSSMoRAUpload.compressImage\(/);
  }
  assert.match(read('absen.html'),/href="\.\/template-surat-izin\.rtf" download/);
  assert.doesNotMatch(read('absen.html')+read('prestasi.html'),/maksimal \d+ (?:MB|KB)|di atas 2 MB/i);
});
